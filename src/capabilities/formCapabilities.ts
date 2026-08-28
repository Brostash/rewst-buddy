import { z } from 'zod';
import {
	FormConditionAction,
	FormFieldType,
	type FormCreateInput,
	type FormUpdateInput,
} from '../sessions/graphql/generated/graphql';
import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { readCapability, writeCapability } from './capabilityFactories';
import {
	buildFormSemantics,
	checkDynamicOptionProperties,
	compileTypedFields,
	describeErrors,
	fieldName as readFieldName,
	readEnumSourceWorkflow,
	typedFormFieldSchema,
	type FormSemanticReport,
	type RawFormField,
	type TypedFormField,
} from './formSemantics';
import { applyGeneratorChecks, collectGeneratorReferences, type GeneratorResolution } from './formWorkflowChecks';
import {
	json,
	optionalBooleanField,
	ORG_ID_FIELD,
	parseCapabilityInput,
	rawGraphqlOrThrow,
	requiredStringField,
	requireResourceInOrg,
	toInputSchema,
} from './inputHelpers';
import { orgDisplayName, withMutationApproval } from './mutationApproval';
import { dedupe, mergeIdSet } from './triggerUpdate';

/**
 * First-class form reads and CRUD. The older trigger/form discovery module owns
 * buddy_list_forms; this module adds the complete definition read, semantic
 * validation, and guarded writes needed to build and maintain forms without
 * arbitrary GraphQL.
 *
 * Two rules shape everything here. First, a successful mutation is evidence
 * that Rewst *stored* something, not that the form works — so every write runs
 * the shared semantics from `formSemantics.ts`/`formWorkflowChecks.ts` first and
 * reads the saved form back afterwards. Second, validation and reads never
 * execute a workflow; running an option generator is a separate, explicitly
 * approved capability.
 */

const FORM_BY_ID = `query RewstBuddyMcpFormById($orgId: ID!, $formId: ID!) {
  form(orgContextId: $orgId, where: { orgId: $orgId, id: $formId }) {
    id
    name
    description
    orgId
    createdAt
    updatedAt
    createdById
    updatedById
    isSynchronized
    cloneOverrides
    clonedFromId
    unpackedFromId
    tags { id name color }
    triggers { id name enabled workflowId triggerTypeId formId }
    fields(orgContextId: $orgId) {
      id
      formId
      index
      type
      schema
      conditions {
        action
        actionValue
        conditionType
        fieldId
        index
        requiredValue
        sourceFieldId
      }
    }
  }
}`;

const FORM_OWNER = `query RewstBuddyMcpFormOwner($orgId: ID!, $formId: ID!) {
  forms(where: { orgId: $orgId, id: $formId }, limit: 1) { id name orgId }
}`;

const CREATE_FORM = `mutation RewstBuddyMcpCreateForm($form: FormCreateInput!) {
  createForm(form: $form) { id name description orgId isSynchronized createdAt updatedAt }
}`;

const UPDATE_FORM = `mutation RewstBuddyMcpUpdateForm($form: FormUpdateInput!) {
  updateForm(form: $form) { id name description orgId isSynchronized createdAt updatedAt }
}`;

const DELETE_FORM = `mutation RewstBuddyMcpDeleteForm($id: ID!) {
  deleteForm(id: $id)
}`;

const FORM_TAGS = `query RewstBuddyMcpFormTags($orgId: ID!, $formId: ID!) {
  form(orgContextId: $orgId, where: { orgId: $orgId, id: $formId }) { id name orgId tags { id name } }
}`;

const TAG_OWNERS = `query RewstBuddyMcpFormTagOwners($orgId: ID!, $ids: [ID!], $limit: Int) {
  tags(where: { orgId: $orgId }, search: { id: { _in: $ids } }, limit: $limit) { id orgId }
}`;

const SET_FORM_TAGS = `mutation RewstBuddyMcpSetFormTags($form: SetFormTagsInput!) {
  setFormTags(form: $form) { id name orgId tags { id name color } }
}`;

const optionalAllowEmptyString = z.string().optional();
// The live resolver stores descriptions in varchar(255); GraphQL only says String.
const formDescription = z.string().max(255, 'Form description must be at most 255 characters.').optional();
const optionalNonNegativeInt = z.number().int().nonnegative().nullable().optional();

const formFieldConditionSchema = z.object({
	action: z
		.enum(FormConditionAction, {
			error: `Form condition action must be one of ${Object.values(FormConditionAction).join(', ')}.`,
		})
		.describe('Condition effect: hide, required, set, or show.'),
	actionValue: optionalAllowEmptyString.nullable().describe('Optional value used by a set action.'),
	conditionType: optionalAllowEmptyString
		.nullable()
		.describe(
			'Optional Rewst condition mode. Existing forms use "default" or "jinja"; this is not a comparator such as "equals". Preserve the mode returned by buddy_get_form.',
		),
	fieldId: requiredStringField('fieldId')
		.nullable()
		.optional()
		.describe('Optional id of the field this condition belongs to.'),
	index: optionalNonNegativeInt.describe('Optional zero-based condition order.'),
	requiredValue: z.unknown().optional().describe('Optional JSON value the source field must match.'),
	sourceFieldId: requiredStringField('sourceFieldId')
		.nullable()
		.optional()
		.describe('Optional id of the field this condition reads.'),
});

const formFieldSchema = z.object({
	id: requiredStringField('id').optional().describe('Existing or caller-supplied field id. Omit for a new field.'),
	index: optionalNonNegativeInt.describe('Zero-based field order.'),
	schema: z.unknown().optional().describe('Rewst field schema/configuration JSON.'),
	type: z
		.enum(FormFieldType, {
			error: `Form field type must be one of ${Object.values(FormFieldType).join(', ')}.`,
		})
		.nullable()
		.optional()
		.describe('Rewst form field type.'),
	conditions: z
		.array(formFieldConditionSchema)
		.optional()
		.describe('Conditional visibility/value rules for the field.'),
});

type FormFieldInput = z.infer<typeof formFieldSchema>;

const TYPED_FIELDS_DESCRIPTION =
	'High-level field definitions compiled into canonical Rewst field JSON (schema name/type/label, static options, and enumSourceWorkflow with label/value keys, static input and inputFromFields mappings). Reference other fields by their "name". Mutually exclusive with "fields", which takes raw Rewst field JSON.';

const typedFieldsSchema = z.array(typedFormFieldSchema).describe(TYPED_FIELDS_DESCRIPTION);

interface FormRow {
	id?: string;
	name?: string;
	description?: string | null;
	orgId?: string;
	isSynchronized?: boolean | null;
	createdAt?: string | null;
	updatedAt?: string | null;
	tags?: { id: string; name?: string; color?: string }[] | null;
	triggers?: { id?: string; name?: string; enabled?: boolean; workflowId?: string; formId?: string }[] | null;
	fields?: ({ index?: number | null; [key: string]: unknown } | null)[] | null;
	[key: string]: unknown;
}

async function requireFormInOrg(ctx: CapabilityContext, formId: string, orgId: string): Promise<FormRow> {
	return requireResourceInOrg({
		label: 'Form',
		id: formId,
		orgId,
		fetch: async () => {
			const data = await rawGraphqlOrThrow(ctx.session, FORM_OWNER, { orgId, formId });
			const forms = ((data as { forms?: FormRow[] } | undefined)?.forms ?? []) as FormRow[];
			return forms.find(form => form.id === formId);
		},
	});
}

/** Reads the full form definition, failing closed on an id/org mismatch. */
async function readForm(ctx: CapabilityContext, orgId: string, formId: string): Promise<FormRow> {
	const data = await rawGraphqlOrThrow(ctx.session, FORM_BY_ID, { orgId, formId });
	const form = (data as { form?: FormRow | null } | undefined)?.form;
	if (form?.id !== formId || form.orgId !== orgId) {
		throw new Error(`Form ${formId} is not in org ${orgId}.`);
	}
	return form;
}

/** Stored fields in index order, with nulls dropped. */
function orderedFields(form: FormRow): RawFormField[] {
	return (form.fields ?? [])
		.filter((field): field is Record<string, unknown> => field != null)
		.sort((a, b) => ((a.index as number) ?? 0) - ((b.index as number) ?? 0)) as RawFormField[];
}

/**
 * Narrows a stored field to the properties `FormFieldInput` accepts, so an
 * unrelated field can be written back byte-for-byte during an incremental edit
 * without carrying server-only properties (`createdAt`, `sourceFields`,
 * `__typename`) that the mutation would reject.
 */
function toFieldInput(field: RawFormField, index: number): Record<string, unknown> {
	const input: Record<string, unknown> = { index };
	if (typeof field.id === 'string') input.id = field.id;
	if (typeof field.formId === 'string') input.formId = field.formId;
	if (field.type != null) input.type = field.type;
	if (field.schema !== undefined) input.schema = field.schema;
	if (Array.isArray(field.conditions)) {
		input.conditions = field.conditions.map(raw => {
			const condition = raw as Record<string, unknown>;
			const kept: Record<string, unknown> = { action: condition.action };
			for (const key of ['actionValue', 'conditionType', 'fieldId', 'index', 'requiredValue', 'sourceFieldId']) {
				if (condition[key] !== undefined) kept[key] = condition[key];
			}
			return kept;
		});
	}
	return input;
}

/** Existing field `name` → stored field id, so new fields can reference them. */
function idsByName(fields: readonly RawFormField[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const field of fields) {
		const name = readFieldName(field);
		if (name && typeof field.id === 'string' && !map.has(name)) map.set(name, field.id);
	}
	return map;
}

// ---------------------------------------------------------------------------
// Shared semantic pass
// ---------------------------------------------------------------------------

/**
 * The one validation path every form surface uses: compile typed fields when
 * supplied, run the pure checks, then the live generator checks. Never executes
 * a workflow.
 */
async function analyzeFields(
	ctx: CapabilityContext,
	orgId: string,
	input: { typedFields?: TypedFormField[]; fields?: RawFormField[]; existingIdsByName?: ReadonlyMap<string, string> },
): Promise<{ fields: RawFormField[]; report: FormSemanticReport; resolutions: GeneratorResolution[] }> {
	const built = buildFormSemantics(input);
	const { report, resolutions } = await applyGeneratorChecks({
		session: ctx.session,
		orgId,
		fields: built.fields,
		report: built.report,
		path: input.typedFields?.length ? 'typedFields' : 'fields',
	});
	return { fields: built.fields, report, resolutions };
}

/** Rejects raw dynamic-options property mistakes before Zod's generic message. */
function assertTypedFieldsUsable(raw: unknown): void {
	if (!Array.isArray(raw)) return;
	const diagnostics = raw.flatMap((field, index) =>
		field && typeof field === 'object'
			? checkDynamicOptionProperties(
					(field as Record<string, unknown>).dynamicOptions,
					`typedFields[${index}].dynamicOptions`,
				)
			: [],
	);
	if (diagnostics.length) {
		throw new Error(diagnostics.map(diagnostic => `${diagnostic.path}: ${diagnostic.message}`).join('; '));
	}
}

/** Throws with every semantic error when a write would persist a broken form. */
function assertSemanticsOk(report: FormSemanticReport): void {
	if (report.ok) return;
	throw new Error(
		`The form definition has ${report.errors.length} semantic error(s) and was not saved: ${describeErrors(report)}. Run buddy_validate_form for the full report.`,
	);
}

// ---------------------------------------------------------------------------
// Read-back verification
// ---------------------------------------------------------------------------

interface VerificationResult {
	status: 'verified' | 'mismatch' | 'unverified';
	message: string;
	differences?: string[];
}

function describeIntendedField(field: RawFormField, index: number): string {
	const source = readEnumSourceWorkflow(field);
	return JSON.stringify({
		index,
		name: readFieldName(field) ?? null,
		type: field.type ?? null,
		generator: source ? { id: source.id ?? null, triggerId: source.triggerId ?? null } : null,
	});
}

/**
 * Re-reads the saved form and compares what was persisted with what was
 * intended. This is the difference between "the mutation returned an id" and
 * "the form is what the caller asked for": Rewst can normalize, reorder, drop
 * an unknown property, or apply an org-level field instance.
 *
 * A failure here never means the write was rolled back — the form exists and
 * carries the returned id.
 */
async function verifySavedForm(
	ctx: CapabilityContext,
	orgId: string,
	formId: string,
	intended: readonly RawFormField[] | undefined,
): Promise<VerificationResult> {
	let saved: FormRow;
	try {
		saved = await readForm(ctx, orgId, formId);
	} catch (error) {
		return {
			status: 'unverified',
			message: `The form was saved as ${formId}, but reading it back failed: ${
				error instanceof Error ? error.message : String(error)
			}. The write was not rolled back — read the form with buddy_get_form rather than creating it again.`,
		};
	}
	if (intended === undefined) {
		return { status: 'verified', message: `Form ${formId} was read back after the write.` };
	}
	const persisted = orderedFields(saved);
	const differences: string[] = [];
	if (persisted.length !== intended.length) {
		differences.push(`expected ${intended.length} field(s), the saved form has ${persisted.length}`);
	}
	const compared = Math.min(persisted.length, intended.length);
	for (let index = 0; index < compared; index++) {
		const want = describeIntendedField(intended[index], index);
		const got = describeIntendedField(persisted[index], index);
		if (want !== got) differences.push(`field ${index}: expected ${want}, saved ${got}`);
	}
	return differences.length
		? {
				status: 'mismatch',
				message: `Form ${formId} was saved, but the stored definition differs from what was requested. The write was not rolled back; correct it with another update rather than creating a second form.`,
				differences,
			}
		: { status: 'verified', message: `Form ${formId} was read back and matches the requested definition.` };
}

// ---------------------------------------------------------------------------
// buddy_get_form
// ---------------------------------------------------------------------------

const getFormSchema = z.object({
	orgId: ORG_ID_FIELD,
	formId: requiredStringField('formId').describe('Id of the form to read (from buddy_list_forms).'),
	interpret: optionalBooleanField('interpret').describe(
		'Also resolve each workflow-generated dropdown to its workflow and trigger (default true). Resolution reads definitions only; it never runs a generator.',
	),
});

const getFormSpec: ToolSpecDefinition = {
	name: 'buddy_get_form',
	description:
		'Get one Rewst form definition by org and form id: metadata, ordered fields with their raw schema/conditions, tags, and connected triggers. Unless interpret:false, it also returns an "interpreted" view naming each field\'s option source and resolving referenced generator workflows and triggers. The raw "fields" are always returned unchanged so they can be edited losslessly. Reading never runs an option generator. Use buddy_list_forms to find ids.',
	inputSchema: toInputSchema(getFormSchema),
};

/** Human-readable per-field option-source summary, alongside the raw fields. */
function interpretFields(fields: readonly RawFormField[], resolutions: readonly GeneratorResolution[]): unknown[] {
	const references = collectGeneratorReferences(fields);
	return fields.map((field, index) => {
		const reference = references.find(candidate => candidate.fieldIndex === index);
		const resolution = reference ? resolutions.find(candidate => candidate.path === reference.path) : undefined;
		return {
			index,
			id: field.id ?? null,
			name: readFieldName(field) ?? null,
			type: field.type ?? null,
			optionSource: reference ? 'workflow' : 'static-or-none',
			...(reference
				? {
						generator: {
							workflowId: reference.workflowId,
							workflowName: resolution?.workflowName ?? null,
							workflowType: resolution?.workflowType ?? null,
							requestedTriggerId: reference.triggerId ?? null,
							resolvedTriggerId: resolution?.resolvedTriggerId ?? null,
							resolvedTriggerName: resolution?.resolvedTriggerName ?? null,
							labelKey: reference.labelKey,
							valueKey: reference.valueKey,
							mappedInputs: reference.mappedInputs,
							declaredInputs: resolution?.declaredInputs ?? null,
							declaredOutputs: resolution?.declaredOutputs ?? null,
							problems: resolution?.errors.map(error => error.message) ?? [],
						},
					}
				: {}),
		};
	});
}

async function runGetForm(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, formId, interpret } = parseCapabilityInput(getFormSchema, input);
	const form = await readForm(ctx, orgId, formId);
	const fields = orderedFields(form);
	const base = { ...form, fields, tags: form.tags ?? [], triggers: form.triggers ?? [] };
	if (interpret === false) return json(base);
	const { report, resolutions } = await analyzeFields(ctx, orgId, { fields });
	return json({
		...base,
		interpreted: {
			note: 'Interpretation is read-only: no option generator was executed. Use buddy_test_form_options to actually run one.',
			fields: interpretFields(fields, resolutions),
			validation: summarizeReport(report),
		},
	});
}

/** The report shape every form tool returns, trimmed of internal duplication. */
function summarizeReport(report: FormSemanticReport): unknown {
	return {
		ok: report.ok,
		errors: report.errors,
		warnings: report.warnings,
		passedChecks: report.passedChecks,
		checksNotRun: report.checksNotRun,
		fields: report.fields,
	};
}

// ---------------------------------------------------------------------------
// buddy_validate_form
// ---------------------------------------------------------------------------

const validateFormSchema = z
	.object({
		orgId: ORG_ID_FIELD,
		formId: requiredStringField('formId')
			.optional()
			.describe('Validate the stored definition of this form. Mutually exclusive with fields/typedFields.'),
		fields: z.array(formFieldSchema).optional().describe('Raw Rewst field JSON to validate before saving it.'),
		typedFields: typedFieldsSchema.optional(),
	})
	.refine(value => [value.formId, value.fields, value.typedFields].filter(part => part !== undefined).length === 1, {
		message: 'buddy_validate_form takes exactly one of formId, fields, or typedFields.',
	});

const validateFormSpec: ToolSpecDefinition = {
	name: 'buddy_validate_form',
	description:
		'Check a Rewst form definition semantically without saving or running anything. Validates field names, ids, types, conditions, generator references and dependency cycles, then resolves each referenced option-generator workflow (type, visibility to the org, declared inputs, options output, trigger). Returns errors, warnings, the checks that passed, and the checks that could not be run, per field and overall. Pass formId to check a stored form, or fields/typedFields to check a definition before writing it. This tool never executes an option generator.',
	inputSchema: toInputSchema(validateFormSchema),
};

async function runValidateForm(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	assertTypedFieldsUsable(input.typedFields);
	const parsed = parseCapabilityInput(validateFormSchema, input);
	const { orgId } = parsed;
	let fields: RawFormField[];
	let source: string;
	if (parsed.formId) {
		fields = orderedFields(await readForm(ctx, orgId, parsed.formId));
		source = `stored form ${parsed.formId}`;
	} else if (parsed.typedFields) {
		fields = [];
		source = 'supplied typedFields';
	} else {
		fields = (parsed.fields ?? []) as RawFormField[];
		source = 'supplied fields';
	}
	const analysis = await analyzeFields(ctx, orgId, {
		...(parsed.typedFields ? { typedFields: parsed.typedFields } : { fields }),
	});
	return json({
		source,
		executed: false,
		note: 'Semantic validation only. No workflow was executed and nothing was written.',
		...(parsed.typedFields ? { compiledFields: analysis.fields } : {}),
		validation: summarizeReport(analysis.report),
	});
}

// ---------------------------------------------------------------------------
// buddy_create_form / buddy_update_form
// ---------------------------------------------------------------------------

const createFormSchema = z
	.object({
		orgId: ORG_ID_FIELD,
		name: requiredStringField('name').describe('Form name.'),
		description: formDescription.describe(
			'Optional form description, at most 255 characters; an empty string is allowed.',
		),
		isSynchronized: optionalBooleanField('isSynchronized').describe('Optional Rewst synchronization marker.'),
		fields: z.array(formFieldSchema).optional().describe('Optional ordered raw Rewst form fields to create.'),
		typedFields: typedFieldsSchema.optional(),
	})
	.refine(value => !(value.fields && value.typedFields), {
		message: 'Pass either fields (raw Rewst JSON) or typedFields (high-level definitions), not both.',
	});

const createFormSpec: ToolSpecDefinition = {
	name: 'buddy_create_form',
	description:
		'Create a Rewst form in one organization. Pass typedFields for high-level field definitions (types, labels, static options, and dynamicOptions for workflow-generated dropdowns) which are compiled into canonical Rewst field JSON, or fields for raw Rewst JSON. The definition is validated semantically — including resolving every referenced option-generator workflow and trigger — before anything is written, and the saved form is read back and compared afterwards. Requires write tools to be enabled, the org to be in working scope, and approval in VS Code.',
	inputSchema: toInputSchema(createFormSchema),
};

function formWriteInput(input: {
	name?: string;
	description?: string;
	isSynchronized?: boolean;
	fields?: FormFieldInput[] | RawFormField[];
}): Pick<FormUpdateInput, 'name' | 'description' | 'isSynchronized' | 'fields'> {
	const form: Pick<FormUpdateInput, 'name' | 'description' | 'isSynchronized' | 'fields'> = {};
	if (input.name !== undefined) form.name = input.name;
	if (input.description !== undefined) form.description = input.description;
	if (input.isSynchronized !== undefined) form.isSynchronized = input.isSynchronized;
	if (input.fields !== undefined) form.fields = input.fields as FormUpdateInput['fields'];
	return form;
}

async function runCreateForm(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	assertTypedFieldsUsable(input.typedFields);
	const parsed = parseCapabilityInput(createFormSchema, input);
	const { orgId, name } = parsed;
	const wantsFields = parsed.fields !== undefined || parsed.typedFields !== undefined;
	const analysis = wantsFields
		? await analyzeFields(ctx, orgId, {
				...(parsed.typedFields
					? { typedFields: parsed.typedFields }
					: { fields: (parsed.fields ?? []) as RawFormField[] }),
			})
		: undefined;
	if (analysis) assertSemanticsOk(analysis.report);

	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = { scopeId: orgId, scopeName: `new form "${name}"`, orgId, orgName };
	const summary = `Create form "${name}" in org "${orgName}" (${orgId})${
		analysis ? ` with ${analysis.fields.length} field(s)` : ''
	}`;
	return withMutationApproval(scope, summary, async () => {
		const form = {
			orgId,
			...formWriteInput({ ...parsed, fields: analysis?.fields }),
			name,
		} satisfies FormCreateInput;
		const data = await rawGraphqlOrThrow(ctx.session, CREATE_FORM, { form });
		const created = (data as { createForm?: FormRow | null } | undefined)?.createForm;
		if (!created?.id) throw new Error('createForm returned no form; the mutation may have failed.');
		const verification = await verifySavedForm(ctx, orgId, created.id, analysis?.fields);
		return json({
			status: verification.status === 'verified' ? 'created' : 'created_unverified',
			...created,
			verification,
			...(analysis ? { validation: summarizeReport(analysis.report) } : {}),
		});
	});
}

const updateFormSchema = z
	.object({
		orgId: ORG_ID_FIELD,
		formId: requiredStringField('formId').describe('Id of the form to update.'),
		name: requiredStringField('name').optional().describe('Optional new form name.'),
		description: formDescription.describe(
			'Optional new description, at most 255 characters; pass an empty string to clear it.',
		),
		isSynchronized: optionalBooleanField('isSynchronized').describe('Optional new synchronization marker.'),
		fields: z
			.array(formFieldSchema)
			.optional()
			.describe(
				'Optional complete replacement list of raw Rewst fields. Omitted fields remain unchanged; [] removes every field.',
			),
		typedFields: typedFieldsSchema.optional(),
	})
	.refine(value => !(value.fields && value.typedFields), {
		message: 'Pass either fields (raw Rewst JSON) or typedFields (high-level definitions), not both.',
	})
	.refine(
		value =>
			value.name !== undefined ||
			value.description !== undefined ||
			value.isSynchronized !== undefined ||
			value.fields !== undefined ||
			value.typedFields !== undefined,
		{ message: 'buddy_update_form requires at least one of name, description, isSynchronized, or fields.' },
	);

const updateFormSpec: ToolSpecDefinition = {
	name: 'buddy_update_form',
	description:
		'Update one Rewst form by org and form id. Omitted properties remain unchanged. When fields or typedFields is supplied it is the complete replacement field list (use existing field ids to update them, omit an id to add a field, and pass fields:[] to remove all fields) — to add one field without rebuilding the list, use buddy_add_form_field instead. The definition is validated semantically before the write and the saved form is read back and compared afterwards. Requires write tools, working scope, org ownership verification, and VS Code approval.',
	inputSchema: toInputSchema(updateFormSchema),
};

async function runUpdateForm(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	assertTypedFieldsUsable(input.typedFields);
	const parsed = parseCapabilityInput(updateFormSchema, input);
	const { orgId, formId } = parsed;
	const current = await requireFormInOrg(ctx, formId, orgId);
	const currentName = current.name ?? '(unnamed)';
	const wantsFields = parsed.fields !== undefined || parsed.typedFields !== undefined;
	const analysis = wantsFields
		? await analyzeFields(ctx, orgId, {
				...(parsed.typedFields
					? { typedFields: parsed.typedFields }
					: { fields: (parsed.fields ?? []) as RawFormField[] }),
			})
		: undefined;
	if (analysis) assertSemanticsOk(analysis.report);

	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = { scopeId: formId, scopeName: currentName, orgId, orgName };
	const fieldSummary = analysis
		? `; replace fields with ${analysis.fields.length} definitions (omitted fields are removed)`
		: '';
	const summary = `Update form "${currentName}" (${formId}) in org "${orgName}" (${orgId})${fieldSummary}`;
	return withMutationApproval(
		scope,
		summary,
		async () => {
			const form = {
				id: formId,
				orgId,
				...formWriteInput({ ...parsed, fields: analysis?.fields }),
			} satisfies FormUpdateInput;
			const data = await rawGraphqlOrThrow(ctx.session, UPDATE_FORM, { form });
			const updated = (data as { updateForm?: FormRow | null } | undefined)?.updateForm;
			if (!updated?.id) throw new Error('updateForm returned no form; the mutation may have failed.');
			const verification = await verifySavedForm(ctx, orgId, formId, analysis?.fields);
			return json({
				status: verification.status === 'verified' ? 'updated' : 'updated_unverified',
				...updated,
				verification,
				...(analysis ? { validation: summarizeReport(analysis.report) } : {}),
			});
		},
		{ alwaysPrompt: true },
	);
}

// ---------------------------------------------------------------------------
// buddy_add_form_field
// ---------------------------------------------------------------------------

const addFormFieldSchema = z.object({
	orgId: ORG_ID_FIELD,
	formId: requiredStringField('formId').describe('Id of the form to add the field to.'),
	field: typedFormFieldSchema.describe(
		'The single field to add. Its dynamicOptions.inputFromFields and conditions may reference fields already on the form by their "name".',
	),
	index: z
		.number()
		.int()
		.nonnegative()
		.optional()
		.describe('Zero-based position to insert at. Omit to append to the end of the form.'),
});

const addFormFieldSpec: ToolSpecDefinition = {
	name: 'buddy_add_form_field',
	description:
		'Add one field to an existing Rewst form without rebuilding its field list. Existing fields, their ids, schemas and conditions are written back unchanged; only the new field is added, at the end or at an explicit index. The new field may reference existing fields by name in its conditions and in dynamicOptions.inputFromFields. The whole resulting form is validated semantically (including the referenced option-generator workflow and trigger) before the write, and read back and compared afterwards. Requires write tools, working scope, and fresh VS Code approval.',
	inputSchema: toInputSchema(addFormFieldSchema),
};

async function runAddFormField(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	assertTypedFieldsUsable(input.field === undefined ? undefined : [input.field]);
	const parsed = parseCapabilityInput(addFormFieldSchema, input);
	const { orgId, formId } = parsed;
	const current = await readForm(ctx, orgId, formId);
	const existing = orderedFields(current);
	const existingIds = idsByName(existing);
	if (existingIds.has(parsed.field.name)) {
		throw new Error(
			`Form ${formId} already has a field named "${parsed.field.name}". Use buddy_update_form to change it rather than adding a second field with the same name.`,
		);
	}

	// The new field is compiled against the existing fields' ids so a mapping or
	// condition can point at a field that is already on the form — that is what
	// makes adding a workflow-generated dropdown incremental instead of a rebuild.
	// Only the compiler runs here: validating the one field in isolation would
	// report every reference to an existing field as unknown. The merged list is
	// what gets validated, below.
	const compiled = compileTypedFields([parsed.field], existingIds);
	const addition = compiled.fields[0] as RawFormField;
	const position = Math.min(parsed.index ?? existing.length, existing.length);
	const merged: RawFormField[] = [...existing];
	merged.splice(position, 0, addition);
	const reindexed = merged.map((field, index) => ({ ...field, index }));

	const { report, resolutions: _resolutions } = await applyGeneratorChecks({
		session: ctx.session,
		orgId,
		fields: reindexed,
		report: buildFormSemantics({ fields: reindexed }).report,
	});
	for (const diagnostic of compiled.diagnostics) {
		(diagnostic.severity === 'error' ? report.errors : report.warnings).push(diagnostic);
	}
	report.ok = report.errors.length === 0;
	assertSemanticsOk(report);

	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = { scopeId: formId, scopeName: current.name ?? formId, orgId, orgName };
	const summary = `Add field "${parsed.field.name}" (${parsed.field.type}) at position ${position} to form "${
		current.name ?? formId
	}" (${formId}) in org "${orgName}" (${orgId}); ${existing.length} existing field(s) are written back unchanged`;
	return withMutationApproval(
		scope,
		summary,
		async () => {
			const fields = reindexed.map((field, index) => toFieldInput(field, index));
			const form = { id: formId, orgId, fields } satisfies FormUpdateInput;
			const data = await rawGraphqlOrThrow(ctx.session, UPDATE_FORM, { form });
			const updated = (data as { updateForm?: FormRow | null } | undefined)?.updateForm;
			if (!updated?.id) throw new Error('updateForm returned no form; the mutation may have failed.');
			const verification = await verifySavedForm(ctx, orgId, formId, reindexed);
			return json({
				status: verification.status === 'verified' ? 'field_added' : 'field_added_unverified',
				id: formId,
				addedField: {
					name: parsed.field.name,
					type: parsed.field.type,
					index: position,
					id: addition.id ?? null,
				},
				fieldCount: { before: existing.length, after: reindexed.length },
				verification,
				validation: summarizeReport(report),
			});
		},
		{ alwaysPrompt: true },
	);
}

// ---------------------------------------------------------------------------
// buddy_delete_form / buddy_set_form_tags
// ---------------------------------------------------------------------------

const deleteFormSchema = z.object({
	orgId: ORG_ID_FIELD,
	formId: requiredStringField('formId').describe('Id of the form to permanently delete.'),
});

const deleteFormSpec: ToolSpecDefinition = {
	name: 'buddy_delete_form',
	description:
		'Permanently delete one Rewst form by org and form id. The form must belong to the requested org. This cannot be undone and always requires fresh approval in VS Code.',
	inputSchema: toInputSchema(deleteFormSchema),
};

async function runDeleteForm(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, formId } = parseCapabilityInput(deleteFormSchema, input);
	const current = await requireFormInOrg(ctx, formId, orgId);
	const name = current.name ?? '(unnamed)';
	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = { scopeId: formId, scopeName: name, orgId, orgName };
	const summary = `Delete form "${name}" (${formId}) in org "${orgName}" (${orgId})`;
	return withMutationApproval(
		scope,
		summary,
		async () => {
			const data = await rawGraphqlOrThrow(ctx.session, DELETE_FORM, { id: formId });
			// deleteForm returns the Void scalar (normally null), not an id.
			// GraphQL errors were checked above; a missing response field is still invalid.
			if (!data || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(data, 'deleteForm')) {
				throw new Error('deleteForm returned no response field; deletion could not be confirmed.');
			}
			return json({ status: 'deleted', id: formId, name });
		},
		{ alwaysPrompt: true },
	);
}

const setFormTagsSchema = z.object({
	orgId: ORG_ID_FIELD,
	formId: requiredStringField('formId').describe('Id of the form whose tags to edit.'),
	operation: z
		.enum(['add', 'remove', 'replace'])
		.describe('Add/remove preserve other tags; replace sets the exact tag set.'),
	tagIds: z
		.array(requiredStringField('tagIds'))
		.max(200)
		.describe('Tag ids in this org. An empty list with replace clears all tags.'),
});

const setFormTagsSpec: ToolSpecDefinition = {
	name: 'buddy_set_form_tags',
	description:
		'Add, remove, or replace tags on one Rewst form. Reads the current tags after approval so add/remove preserve unrelated tags. Verifies the form and requested tags belong to the org. Requires write tools, working scope, and fresh VS Code approval. Pass operation:"replace", tagIds:[] to clear tags.',
	inputSchema: toInputSchema(setFormTagsSchema),
};

async function runSetFormTags(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const { orgId, formId, operation, tagIds } = parseCapabilityInput(setFormTagsSchema, input);
	const fetchForm = async () =>
		requireResourceInOrg({
			label: 'Form',
			id: formId,
			orgId,
			fetch: async () => {
				const data = await rawGraphqlOrThrow(ctx.session, FORM_TAGS, { orgId, formId });
				const form = (data as { form?: FormRow | null } | undefined)?.form;
				return form?.id === formId ? form : undefined;
			},
		});
	const preview = await fetchForm();
	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = { scopeId: formId, scopeName: preview.name ?? formId, orgId, orgName };
	return withMutationApproval(
		scope,
		`${operation} tags on form "${scope.scopeName}" (${formId}) in org "${orgName}" (${orgId})`,
		async () => {
			const current = await fetchForm();
			const requested = dedupe(tagIds);
			if (requested.length) {
				const data = await rawGraphqlOrThrow(ctx.session, TAG_OWNERS, {
					orgId,
					ids: requested,
					limit: requested.length,
				});
				const tags = (data as { tags?: { id: string; orgId: string }[] } | undefined)?.tags ?? [];
				for (const id of requested) {
					if (!tags.some(tag => tag.id === id && tag.orgId === orgId))
						throw new Error(`Tag ${id} is not in org ${orgId}.`);
				}
			}
			const before = dedupe((current.tags ?? []).map(tag => tag.id));
			const next = mergeIdSet(operation, before, requested);
			const data = await rawGraphqlOrThrow(ctx.session, SET_FORM_TAGS, { form: { id: formId, tagIds: next } });
			const updated = (data as { setFormTags?: FormRow | null } | undefined)?.setFormTags;
			if (updated?.id !== formId || updated.orgId !== orgId || !Array.isArray(updated.tags)) {
				throw new Error('setFormTags returned no matching form; the update could not be confirmed.');
			}
			return json({
				status: 'updated',
				id: formId,
				operation,
				tagIds: { before, after: updated.tags.map(tag => tag.id) },
			});
		},
		{ alwaysPrompt: true },
	);
}

export const FORM_CAPABILITIES: Capability[] = [
	readCapability(getFormSpec, runGetForm),
	readCapability(validateFormSpec, runValidateForm),
	writeCapability(createFormSpec, runCreateForm),
	writeCapability(updateFormSpec, runUpdateForm),
	writeCapability(addFormFieldSpec, runAddFormField),
	writeCapability(deleteFormSpec, runDeleteForm),
	writeCapability(setFormTagsSpec, runSetFormTags),
];
