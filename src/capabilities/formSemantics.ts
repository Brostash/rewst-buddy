/**
 * Shared, side-effect-free semantic layer for Rewst forms.
 *
 * Two things live here and nothing else: a *compiler* that turns typed,
 * high-level field definitions into the canonical Rewst field JSON the
 * resolver stores, and a *validator* that reports what is wrong with a set of
 * fields (typed or raw) without touching the network.
 *
 * Every form surface — the MCP capabilities and Cage-Free Rewsty's in-process
 * Buddy path both go through `src/capabilities/registry.ts` — uses this module,
 * so "does this form make sense" has exactly one answer. A successful
 * `createForm`/`updateForm` mutation is persistence evidence only; these checks
 * are what stand between a caller and a form that stores cleanly but cannot
 * render or generate its options.
 *
 * The module deliberately has no `vscode` or session import: it runs on the
 * fast vitest runner and can be reused anywhere. Checks that need the live API
 * (workflow type, visibility, trigger ownership, actual option execution) live
 * in `formWorkflowChecks.ts` and `formOptionsCapabilities.ts` and are reported
 * through the same {@link FormSemanticReport} shape.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { FormConditionAction, FormFieldType } from '../sessions/graphql/generated/graphql';

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = 'error' | 'warning';

/** One readable semantic finding, anchored to a JSON path in the input. */
export interface FormDiagnostic {
	severity: DiagnosticSeverity;
	/** Stable machine-readable code, e.g. `dynamic_options_obsolete_property`. */
	code: string;
	/** JSON-ish path into the caller's input, e.g. `fields[2].dynamicOptions.labelField`. */
	path: string;
	message: string;
	/** Field `schema.name` when the finding belongs to one field. */
	fieldName?: string;
}

/** A check that could not be evaluated, and why — never silently omitted. */
export interface SkippedCheck {
	check: string;
	reason: string;
}

export interface FormFieldReport {
	index: number;
	id?: string;
	name?: string;
	type?: string;
	/** How this field's options are produced, when it is an option field. */
	optionSource: 'none' | 'static' | 'workflow';
	errors: FormDiagnostic[];
	warnings: FormDiagnostic[];
	passedChecks: string[];
}

export interface FormSemanticReport {
	ok: boolean;
	errors: FormDiagnostic[];
	warnings: FormDiagnostic[];
	passedChecks: string[];
	checksNotRun: SkippedCheck[];
	fields: FormFieldReport[];
}

export function emptyReport(): FormSemanticReport {
	return { ok: true, errors: [], warnings: [], passedChecks: [], checksNotRun: [], fields: [] };
}

/** Recomputes `ok` and rolls per-field findings up into the top-level lists. */
export function finalizeReport(report: FormSemanticReport): FormSemanticReport {
	const errors = [...report.errors, ...report.fields.flatMap(field => field.errors)];
	const warnings = [...report.warnings, ...report.fields.flatMap(field => field.warnings)];
	return { ...report, errors, warnings, ok: errors.length === 0 };
}

/** Renders a report's errors as the single message a throwing capability uses. */
export function describeErrors(report: FormSemanticReport): string {
	return report.errors.map(error => `${error.path}: ${error.message}`).join('; ');
}

// ---------------------------------------------------------------------------
// Canonical Rewst field JSON
// ---------------------------------------------------------------------------

/**
 * A field's `schema.enumSourceWorkflow` block — the stored configuration that
 * makes a dropdown workflow-generated. Property names here are the canonical
 * ones observed in live Rewst forms; {@link OBSOLETE_DYNAMIC_OPTION_PROPERTIES}
 * maps the names callers commonly reach for instead.
 */
export interface EnumSourceWorkflow {
	id: string;
	triggerId?: string;
	labelKey: string;
	valueKey: string;
	input: Record<string, unknown>;
	inputFromFields: Record<string, { fieldId: string; isActive: boolean; isRequired: boolean }>;
}

export interface CanonicalFormField {
	id?: string;
	index: number;
	type: FormFieldType;
	schema: Record<string, unknown>;
	conditions?: unknown[];
}

/** Default label/value keys when a caller does not name the generator's keys. */
export const DEFAULT_LABEL_KEY = 'label';
export const DEFAULT_VALUE_KEY = 'value';

/**
 * Defaults applied to every generated `inputFromFields` entry. A mapping is
 * live by default (`isActive`) and does not block submission when the source
 * field is blank (`isRequired`); a caller opts into the stricter behavior per
 * mapping.
 */
export const INPUT_FROM_FIELD_DEFAULTS = { isActive: true, isRequired: false } as const;

/** Field types whose options Rewst can source from an option-generator workflow. */
export const OPTION_FIELD_TYPES: readonly FormFieldType[] = [
	FormFieldType.Select,
	FormFieldType.Multiselect,
	FormFieldType.Radio,
];

/** JSON type stored in `schema.type` for each Rewst field type. */
const SCHEMA_TYPE_BY_FIELD_TYPE: Record<FormFieldType, string> = {
	[FormFieldType.Checkbox]: 'boolean',
	[FormFieldType.Date]: 'string',
	[FormFieldType.FileInput]: 'string',
	[FormFieldType.MultilineInput]: 'string',
	[FormFieldType.Multiselect]: 'array',
	[FormFieldType.NumberInput]: 'number',
	[FormFieldType.Radio]: 'string',
	[FormFieldType.Select]: 'string',
	[FormFieldType.Text]: 'string',
	[FormFieldType.TextInput]: 'string',
};

/**
 * Rewst field names become workflow input names, so they follow the same rule
 * as an identifier: letters, digits and underscores, not starting with a digit.
 */
const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------------------
// Typed field input schema
// ---------------------------------------------------------------------------

const staticOptionSchema = z.strictObject({
	label: z.string().min(1, 'A static option needs a non-empty label.').describe('Text shown in the dropdown.'),
	value: z.union([z.string(), z.number(), z.boolean()]).describe('Value submitted when the option is chosen.'),
});

/**
 * Property names callers reach for that Rewst does not read, mapped to the
 * canonical property. Rejecting these is the difference between a form that
 * saves and a dropdown that silently never populates.
 */
export const OBSOLETE_DYNAMIC_OPTION_PROPERTIES: Record<string, string> = {
	id: 'workflowId',
	enumSourceWorkflowId: 'workflowId',
	optionGeneratorId: 'workflowId',
	sourceWorkflowId: 'workflowId',
	workflow: 'workflowId',
	generatorId: 'workflowId',
	trigger: 'triggerId',
	triggerName: 'triggerId',
	labelField: 'labelKey',
	labelProperty: 'labelKey',
	displayKey: 'labelKey',
	optionLabel: 'labelKey',
	valueField: 'valueKey',
	valueProperty: 'valueKey',
	optionValue: 'valueKey',
	inputs: 'input',
	staticInput: 'input',
	parameters: 'input',
	inputFromField: 'inputFromFields',
	fieldInputs: 'inputFromFields',
	inputMapping: 'inputFromFields',
	mapFromFields: 'inputFromFields',
	dependsOn: 'inputFromFields',
};

const inputFromFieldSchema = z.union([
	z.string().min(1, 'An input mapping must name the source field.'),
	z.strictObject({
		fieldName: z
			.string()
			.min(1, 'An input mapping must name the source field.')
			.describe('`name` of the field supplying this generator input.'),
		isActive: z
			.boolean()
			.optional()
			.describe(`Whether the mapping is live (default ${INPUT_FROM_FIELD_DEFAULTS.isActive}).`),
		isRequired: z
			.boolean()
			.optional()
			.describe(
				`Whether the generator refuses to run until the source field has a value (default ${INPUT_FROM_FIELD_DEFAULTS.isRequired}).`,
			),
	}),
]);

const dynamicOptionsSchema = z.strictObject({
	workflowId: z
		.string()
		.min(1, 'dynamicOptions.workflowId is required.')
		.describe('Id of the OPTION_GENERATOR workflow that produces the options.'),
	triggerId: z
		.string()
		.min(1)
		.optional()
		.describe(
			'Id of the generator trigger to call. Omit only when the workflow has exactly one compatible trigger.',
		),
	labelKey: z
		.string()
		.min(1)
		.optional()
		.describe(`Key on each produced option holding its display text (default "${DEFAULT_LABEL_KEY}").`),
	valueKey: z
		.string()
		.min(1)
		.optional()
		.describe(`Key on each produced option holding its submitted value (default "${DEFAULT_VALUE_KEY}").`),
	input: z.record(z.string(), z.unknown()).optional().describe('Static generator inputs, by generator input name.'),
	inputFromFields: z
		.record(z.string(), inputFromFieldSchema)
		.optional()
		.describe(
			'Generator inputs taken from other fields on this form, keyed by generator input name; the value is the source field `name`.',
		),
});

const typedConditionSchema = z.strictObject({
	action: z.enum(FormConditionAction, {
		error: `Condition action must be one of ${Object.values(FormConditionAction).join(', ')}.`,
	}),
	sourceFieldName: z.string().min(1).describe('`name` of the field this condition reads.'),
	requiredValue: z.unknown().optional().describe('Value the source field must hold for the action to apply.'),
	actionValue: z.string().optional().describe('Value applied by a `set` action.'),
	conditionType: z
		.string()
		.optional()
		.describe('Rewst condition mode, such as "default" or "jinja". Not a comparator.'),
});

export const typedFormFieldSchema = z.strictObject({
	name: z
		.string()
		.min(1, 'Each typed field needs a "name".')
		.describe('Field name; also the workflow input name. Letters, digits and underscores.'),
	type: z.enum(FormFieldType, {
		error: `Field type must be one of ${Object.values(FormFieldType).join(', ')}.`,
	}),
	id: z.string().min(1).optional().describe('Existing field id when editing. Omit for a new field.'),
	label: z.string().optional().describe('Label shown above the field.'),
	description: z.string().optional().describe('Helper text shown with the field.'),
	required: z.boolean().optional().describe('Whether submission requires a value.'),
	default: z.unknown().optional().describe('Default value.'),
	placeholder: z.string().optional().describe('Placeholder text.'),
	content: z.string().optional().describe('Markdown body for a display-only TEXT field.'),
	options: z.array(staticOptionSchema).optional().describe('Static options for SELECT, MULTISELECT or RADIO.'),
	dynamicOptions: dynamicOptionsSchema
		.optional()
		.describe('Workflow-generated options for SELECT, MULTISELECT or RADIO.'),
	conditions: z.array(typedConditionSchema).optional().describe('Conditional show/hide/require/set rules.'),
});

export type TypedFormField = z.infer<typeof typedFormFieldSchema>;

/**
 * Pre-parse guard that turns an obsolete or misspelled `dynamicOptions`
 * property into an actionable message. Zod's strict-object error names the key
 * but cannot say what to use instead, and "unrecognized key" is exactly the
 * failure mode that sends a caller round the loop again.
 */
export function checkDynamicOptionProperties(raw: unknown, path: string): FormDiagnostic[] {
	if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return [];
	const allowed = new Set(Object.keys(dynamicOptionsSchema.shape));
	const diagnostics: FormDiagnostic[] = [];
	for (const key of Object.keys(raw as Record<string, unknown>)) {
		if (allowed.has(key)) continue;
		const replacement = OBSOLETE_DYNAMIC_OPTION_PROPERTIES[key];
		diagnostics.push({
			severity: 'error',
			code: replacement ? 'dynamic_options_obsolete_property' : 'dynamic_options_unknown_property',
			path: `${path}.${key}`,
			message: replacement
				? `"${key}" is not read by Rewst; use "${replacement}" instead.`
				: `"${key}" is not a dynamicOptions property. Supported: ${[...allowed].sort().join(', ')}.`,
		});
	}
	return diagnostics;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

function normalizeInputFromFields(
	dynamic: NonNullable<TypedFormField['dynamicOptions']>,
	fieldIdByName: ReadonlyMap<string, string>,
): { mappings: EnumSourceWorkflow['inputFromFields']; unresolved: string[] } {
	const mappings: EnumSourceWorkflow['inputFromFields'] = {};
	const unresolved: string[] = [];
	for (const [inputName, mapping] of Object.entries(dynamic.inputFromFields ?? {})) {
		const sourceName = typeof mapping === 'string' ? mapping : mapping.fieldName;
		const fieldId = fieldIdByName.get(sourceName);
		if (!fieldId) {
			unresolved.push(inputName);
			continue;
		}
		mappings[inputName] = {
			fieldId,
			isActive:
				typeof mapping === 'string'
					? INPUT_FROM_FIELD_DEFAULTS.isActive
					: (mapping.isActive ?? INPUT_FROM_FIELD_DEFAULTS.isActive),
			isRequired:
				typeof mapping === 'string'
					? INPUT_FROM_FIELD_DEFAULTS.isRequired
					: (mapping.isRequired ?? INPUT_FROM_FIELD_DEFAULTS.isRequired),
		};
	}
	return { mappings, unresolved };
}

/**
 * A fresh id for a typed field that has none.
 *
 * This MUST be a real UUID: Rewst stores `FormField.id` in a uuid column and
 * inserts a caller-supplied value directly, so anything else fails the write
 * with `invalid input syntax for type uuid`. It is random rather than derived
 * from the field name, because ids are unique across forms — two forms with a
 * field called `first_name` must not compile to the same id.
 */
export function newFormFieldId(): string {
	return randomUUID();
}

/** True when `value` is a UUID Rewst's uuid columns will accept. */
export function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Names that another typed field addresses — through a generator input mapping
 * or a condition. Only these fields need an id assigned at compile time: a
 * reference is stored as a field *id*, so the referenced field cannot wait for
 * the server to invent one. Everything else is left without an id so Rewst
 * assigns it, which keeps the number of client-chosen ids as small as possible.
 */
function referencedFieldNames(fields: readonly TypedFormField[]): Set<string> {
	const referenced = new Set<string>();
	for (const field of fields) {
		for (const mapping of Object.values(field.dynamicOptions?.inputFromFields ?? {})) {
			referenced.add(typeof mapping === 'string' ? mapping : mapping.fieldName);
		}
		for (const condition of field.conditions ?? []) referenced.add(condition.sourceFieldName);
	}
	return referenced;
}

/** Compiles one typed field into the canonical Rewst field JSON. */
function compileTypedField(
	field: TypedFormField,
	index: number,
	fieldIdByName: ReadonlyMap<string, string>,
): { canonical: CanonicalFormField; diagnostics: FormDiagnostic[] } {
	const diagnostics: FormDiagnostic[] = [];
	const path = `typedFields[${index}]`;
	const schema: Record<string, unknown> = {
		name: field.name,
		type: SCHEMA_TYPE_BY_FIELD_TYPE[field.type],
	};
	if (field.label !== undefined) schema.label = field.label;
	if (field.description !== undefined) schema.description = field.description;
	if (field.required !== undefined) schema.required = field.required;
	if (field.default !== undefined) schema.default = field.default;
	if (field.placeholder !== undefined) schema.placeholder = field.placeholder;
	if (field.content !== undefined) schema.content = field.content;

	const isOptionField = OPTION_FIELD_TYPES.includes(field.type);
	if (!isOptionField && (field.options || field.dynamicOptions)) {
		diagnostics.push({
			severity: 'error',
			code: 'options_on_non_option_field',
			path,
			fieldName: field.name,
			message: `Options are only supported on ${OPTION_FIELD_TYPES.join(', ')}; "${field.name}" is ${field.type}.`,
		});
	}
	if (field.options && field.dynamicOptions) {
		diagnostics.push({
			severity: 'error',
			code: 'options_and_dynamic_options',
			path,
			fieldName: field.name,
			message: `"${field.name}" declares both static options and dynamicOptions; choose one.`,
		});
	}
	if (field.content !== undefined && field.type !== FormFieldType.Text) {
		diagnostics.push({
			severity: 'warning',
			code: 'content_on_input_field',
			path: `${path}.content`,
			fieldName: field.name,
			message: `"content" is display markdown for a TEXT field; ${field.type} renders an input instead.`,
		});
	}

	if (isOptionField && field.options?.length) {
		const values = field.options.map(option => option.value);
		const labels = field.options.map(option => option.label);
		if (field.type === FormFieldType.Multiselect) {
			schema.items = { type: 'string', enum: values, enumNames: labels };
			schema.uniqueItems = true;
		} else {
			schema.enum = values;
			schema.enumNames = labels;
		}
	}

	if (isOptionField && field.dynamicOptions) {
		const dynamic = field.dynamicOptions;
		const { mappings, unresolved } = normalizeInputFromFields(dynamic, fieldIdByName);
		for (const inputName of unresolved) {
			const mapping = dynamic.inputFromFields?.[inputName];
			const sourceName = typeof mapping === 'string' ? mapping : mapping?.fieldName;
			diagnostics.push({
				severity: 'error',
				code: 'input_from_field_unknown_source',
				path: `${path}.dynamicOptions.inputFromFields.${inputName}`,
				fieldName: field.name,
				message: `Generator input "${inputName}" reads field "${sourceName}", which is not a field on this form.`,
			});
		}
		const enumSourceWorkflow: EnumSourceWorkflow = {
			id: dynamic.workflowId,
			labelKey: dynamic.labelKey ?? DEFAULT_LABEL_KEY,
			valueKey: dynamic.valueKey ?? DEFAULT_VALUE_KEY,
			input: { ...(dynamic.input ?? {}) },
			inputFromFields: mappings,
		};
		if (dynamic.triggerId !== undefined) enumSourceWorkflow.triggerId = dynamic.triggerId;
		// Every mapped input also needs a key in `input`: the stored static value
		// is the slot the field's runtime value is written into.
		for (const inputName of Object.keys(mappings)) {
			if (!(inputName in enumSourceWorkflow.input)) enumSourceWorkflow.input[inputName] = '';
		}
		if (field.type === FormFieldType.Multiselect) schema.items = { type: 'string', ...(schema.items as object) };
		schema.enumSourceWorkflow = enumSourceWorkflow;
	}

	const canonical: CanonicalFormField = {
		index,
		type: field.type,
		schema,
	};
	const id = field.id ?? fieldIdByName.get(field.name);
	if (id) canonical.id = id;

	if (field.conditions?.length) {
		const conditions: Record<string, unknown>[] = [];
		field.conditions.forEach((condition, conditionIndex) => {
			const sourceFieldId = fieldIdByName.get(condition.sourceFieldName);
			if (!sourceFieldId) {
				diagnostics.push({
					severity: 'error',
					code: 'condition_unknown_source_field',
					path: `${path}.conditions[${conditionIndex}].sourceFieldName`,
					fieldName: field.name,
					message: `Condition reads field "${condition.sourceFieldName}", which is not a field on this form.`,
				});
				return;
			}
			const compiled: Record<string, unknown> = {
				action: condition.action,
				index: conditionIndex,
				sourceFieldId,
			};
			if (id) compiled.fieldId = id;
			if (condition.requiredValue !== undefined) compiled.requiredValue = condition.requiredValue;
			if (condition.actionValue !== undefined) compiled.actionValue = condition.actionValue;
			if (condition.conditionType !== undefined) compiled.conditionType = condition.conditionType;
			conditions.push(compiled);
		});
		canonical.conditions = conditions;
	}

	return { canonical, diagnostics };
}

/**
 * Compiles a whole typed field list. Ids are assigned first so a field can be
 * referenced by a mapping or condition declared on an earlier field.
 */
export function compileTypedFields(
	fields: readonly TypedFormField[],
	existingIdsByName: ReadonlyMap<string, string> = new Map(),
): {
	fields: CanonicalFormField[];
	diagnostics: FormDiagnostic[];
} {
	// Fields already on the form are addressable too, so an incrementally added
	// field can map an input from — or be conditioned on — one of them.
	const fieldIdByName = new Map<string, string>(existingIdsByName);
	const referenced = referencedFieldNames(fields);
	for (const field of fields) {
		if (field.id !== undefined) {
			fieldIdByName.set(field.name, field.id);
			continue;
		}
		// Mint an id only for a field something points at; the rest are created
		// without one so Rewst assigns their ids.
		if (!fieldIdByName.has(field.name) && referenced.has(field.name)) {
			fieldIdByName.set(field.name, newFormFieldId());
		}
	}
	const diagnostics: FormDiagnostic[] = [];
	const compiled: CanonicalFormField[] = [];
	fields.forEach((field, index) => {
		const result = compileTypedField(field, index, fieldIdByName);
		diagnostics.push(...result.diagnostics);
		compiled.push(result.canonical);
	});
	return { fields: compiled, diagnostics };
}

// ---------------------------------------------------------------------------
// Validator (works on canonical/raw fields, whatever produced them)
// ---------------------------------------------------------------------------

/** The loose shape a raw (caller-supplied or server-returned) field arrives in. */
export interface RawFormField {
	id?: string | null;
	index?: number | null;
	type?: string | null;
	schema?: unknown;
	conditions?: unknown;
	[key: string]: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** Reads a field's `schema.enumSourceWorkflow` block if it has a usable one. */
export function readEnumSourceWorkflow(field: RawFormField): Record<string, unknown> | undefined {
	return asRecord(asRecord(field.schema)?.enumSourceWorkflow);
}

/** Field `schema.name`, the identity everything else refers to. */
export function fieldName(field: RawFormField): string | undefined {
	const name = asRecord(field.schema)?.name;
	return typeof name === 'string' ? name : undefined;
}

const VALID_FIELD_TYPES = new Set<string>(Object.values(FormFieldType));

/**
 * Every check the pure validator performs, so a report can state which ones
 * passed rather than only what failed.
 */
const PURE_CHECKS = [
	'field_names_valid_and_unique',
	'field_ids_unique',
	'field_ids_are_uuids',
	'field_types_supported',
	'conditions_reference_known_fields',
	'option_fields_have_a_source',
	'generator_mappings_reference_known_fields',
	'no_field_dependency_cycles',
] as const;

interface FieldContext {
	field: RawFormField;
	index: number;
	report: FormFieldReport;
}

function detectCycles(edges: ReadonlyMap<string, Set<string>>): string[][] {
	const cycles: string[][] = [];
	const state = new Map<string, 'visiting' | 'done'>();
	const stack: string[] = [];
	const visit = (node: string): void => {
		const current = state.get(node);
		if (current === 'done') return;
		if (current === 'visiting') {
			cycles.push([...stack.slice(stack.indexOf(node)), node]);
			return;
		}
		state.set(node, 'visiting');
		stack.push(node);
		for (const next of edges.get(node) ?? []) visit(next);
		stack.pop();
		state.set(node, 'done');
	};
	for (const node of edges.keys()) visit(node);
	return cycles;
}

/**
 * Validates a field list without contacting Rewst: names, ids, types,
 * conditions, generator references and dependency cycles.
 *
 * Raw fields are validated, never rewritten — a stored field carries Rewst
 * metadata this module does not model, and dropping it on the way through
 * would be a silent edit. Anything the validator does not understand is left
 * exactly as it arrived.
 */
export function validateFormFields(fields: readonly RawFormField[], path = 'fields'): FormSemanticReport {
	const report = emptyReport();
	const contexts: FieldContext[] = fields.map((field, index) => {
		const name = fieldName(field);
		const enumSource = readEnumSourceWorkflow(field);
		return {
			field,
			index,
			report: {
				index: typeof field.index === 'number' ? field.index : index,
				...(field.id ? { id: field.id } : {}),
				...(name ? { name } : {}),
				...(field.type ? { type: field.type } : {}),
				optionSource: enumSource ? 'workflow' : hasStaticOptions(field) ? 'static' : 'none',
				errors: [],
				warnings: [],
				passedChecks: [],
			},
		};
	});

	const idByName = new Map<string, string>();
	const knownIds = new Set<string>();
	const seenNames = new Map<string, number>();
	const seenIds = new Map<string, number>();

	for (const context of contexts) {
		const { field, index } = context;
		const at = `${path}[${index}]`;
		const name = fieldName(field);
		if (!name) {
			context.report.errors.push({
				severity: 'error',
				code: 'field_name_missing',
				path: `${at}.schema.name`,
				message: 'Every field needs a non-empty schema.name; it is the workflow input name.',
			});
		} else if (!FIELD_NAME_PATTERN.test(name)) {
			context.report.errors.push({
				severity: 'error',
				code: 'field_name_invalid',
				path: `${at}.schema.name`,
				fieldName: name,
				message: `"${name}" is not a usable field name. Use letters, digits and underscores, not starting with a digit.`,
			});
		} else if (seenNames.has(name)) {
			context.report.errors.push({
				severity: 'error',
				code: 'field_name_duplicate',
				path: `${at}.schema.name`,
				fieldName: name,
				message: `Field name "${name}" is already used by field index ${seenNames.get(name)}.`,
			});
		} else {
			seenNames.set(name, index);
			if (field.id) idByName.set(name, field.id);
		}

		if (field.id) {
			// Rewst stores field ids in a uuid column and inserts a supplied value
			// directly, so a readable slug fails the write rather than being
			// normalized. Catch it here instead of at the database.
			if (!isUuid(field.id)) {
				context.report.errors.push({
					severity: 'error',
					code: 'field_id_not_uuid',
					path: `${at}.id`,
					fieldName: name,
					message: `Field id "${field.id}" is not a UUID. Rewst field ids are UUIDs — omit the id to have one assigned, or use the id returned by buddy_get_form.`,
				});
			}
			if (seenIds.has(field.id)) {
				context.report.errors.push({
					severity: 'error',
					code: 'field_id_duplicate',
					path: `${at}.id`,
					fieldName: name,
					message: `Field id "${field.id}" is already used by field index ${seenIds.get(field.id)}.`,
				});
			} else {
				seenIds.set(field.id, index);
				knownIds.add(field.id);
			}
		}

		if (field.type != null && !VALID_FIELD_TYPES.has(field.type)) {
			context.report.errors.push({
				severity: 'error',
				code: 'field_type_invalid',
				path: `${at}.type`,
				fieldName: name,
				message: `"${field.type}" is not a Rewst form field type. Supported: ${[...VALID_FIELD_TYPES].sort().join(', ')}.`,
			});
		} else if (field.type == null) {
			context.report.warnings.push({
				severity: 'warning',
				code: 'field_type_missing',
				path: `${at}.type`,
				fieldName: name,
				message: 'Field has no type; Rewst cannot decide how to render it.',
			});
		}
	}

	const dependencies = new Map<string, Set<string>>();
	const dependencyNameById = new Map<string, string>();
	for (const context of contexts) {
		if (context.field.id) dependencyNameById.set(context.field.id, fieldName(context.field) ?? context.field.id);
	}
	const edgeKey = (context: FieldContext): string =>
		context.field.id ?? fieldName(context.field) ?? `index:${context.index}`;

	for (const context of contexts) {
		const { field, index } = context;
		const at = `${path}[${index}]`;
		const name = fieldName(field);
		const edges = dependencies.get(edgeKey(context)) ?? new Set<string>();
		dependencies.set(edgeKey(context), edges);

		if (Array.isArray(field.conditions)) {
			field.conditions.forEach((rawCondition, conditionIndex) => {
				const condition = asRecord(rawCondition);
				if (!condition) return;
				const conditionPath = `${at}.conditions[${conditionIndex}]`;
				const action = condition.action;
				if (
					typeof action !== 'string' ||
					!Object.values(FormConditionAction).includes(action as FormConditionAction)
				) {
					context.report.errors.push({
						severity: 'error',
						code: 'condition_action_invalid',
						path: `${conditionPath}.action`,
						fieldName: name,
						message: `Condition action must be one of ${Object.values(FormConditionAction).join(', ')}.`,
					});
				}
				const sourceFieldId = condition.sourceFieldId;
				if (typeof sourceFieldId === 'string' && sourceFieldId.length > 0) {
					if (!knownIds.has(sourceFieldId)) {
						context.report.errors.push({
							severity: 'error',
							code: 'condition_unknown_source_field',
							path: `${conditionPath}.sourceFieldId`,
							fieldName: name,
							message: `Condition reads field id "${sourceFieldId}", which is not a field on this form.`,
						});
					} else if (sourceFieldId === field.id) {
						// A condition reading its own field is inert rather than a
						// generation cycle, so it is reported here and kept out of the
						// dependency graph.
						context.report.warnings.push({
							severity: 'warning',
							code: 'condition_self_reference',
							path: `${conditionPath}.sourceFieldId`,
							fieldName: name,
							message: 'Condition reads the field it belongs to, so it can never change that field.',
						});
					} else {
						edges.add(sourceFieldId);
					}
				}
				const ownerId = condition.fieldId;
				if (typeof ownerId === 'string' && field.id && ownerId !== field.id) {
					context.report.errors.push({
						severity: 'error',
						code: 'condition_field_id_mismatch',
						path: `${conditionPath}.fieldId`,
						fieldName: name,
						message: `Condition fieldId "${ownerId}" does not match its own field id "${field.id}".`,
					});
				}
			});
		}

		const enumSource = readEnumSourceWorkflow(field);
		const isOptionField = field.type != null && OPTION_FIELD_TYPES.includes(field.type as FormFieldType);
		if (enumSource) {
			if (!isOptionField) {
				context.report.errors.push({
					severity: 'error',
					code: 'generator_on_non_option_field',
					path: `${at}.schema.enumSourceWorkflow`,
					fieldName: name,
					message: `Workflow-generated options need ${OPTION_FIELD_TYPES.join(', ')}; this field is ${field.type ?? 'untyped'}.`,
				});
			}
			if (typeof enumSource.id !== 'string' || enumSource.id.length === 0) {
				context.report.errors.push({
					severity: 'error',
					code: 'generator_workflow_id_missing',
					path: `${at}.schema.enumSourceWorkflow.id`,
					fieldName: name,
					message: 'enumSourceWorkflow.id must be the option-generator workflow id.',
				});
			}
			for (const key of ['labelKey', 'valueKey'] as const) {
				if (enumSource[key] !== undefined && (typeof enumSource[key] !== 'string' || !enumSource[key])) {
					context.report.errors.push({
						severity: 'error',
						code: 'generator_key_invalid',
						path: `${at}.schema.enumSourceWorkflow.${key}`,
						fieldName: name,
						message: `enumSourceWorkflow.${key} must be a non-empty string naming a key on each produced option.`,
					});
				}
			}
			const mappings = asRecord(enumSource.inputFromFields) ?? {};
			for (const [inputName, rawMapping] of Object.entries(mappings)) {
				const mapping = asRecord(rawMapping);
				const sourceFieldId = mapping?.fieldId;
				const mappingPath = `${at}.schema.enumSourceWorkflow.inputFromFields.${inputName}`;
				if (typeof sourceFieldId !== 'string' || !sourceFieldId) {
					context.report.errors.push({
						severity: 'error',
						code: 'input_from_field_missing_field_id',
						path: `${mappingPath}.fieldId`,
						fieldName: name,
						message: `Generator input "${inputName}" has no source fieldId.`,
					});
					continue;
				}
				if (!knownIds.has(sourceFieldId)) {
					context.report.errors.push({
						severity: 'error',
						code: 'input_from_field_unknown_source',
						path: `${mappingPath}.fieldId`,
						fieldName: name,
						message: `Generator input "${inputName}" reads field id "${sourceFieldId}", which is not a field on this form.`,
					});
					continue;
				}
				edges.add(sourceFieldId);
			}
		} else if (isOptionField && !hasStaticOptions(field)) {
			context.report.warnings.push({
				severity: 'warning',
				code: 'option_field_without_options',
				path: `${at}.schema`,
				fieldName: name,
				message: `${field.type} field "${name ?? field.id ?? index}" has neither static options nor enumSourceWorkflow, so it renders empty.`,
			});
		}
	}

	for (const cycle of detectCycles(dependencies)) {
		const readable = cycle.map(id => dependencyNameById.get(id) ?? id).join(' -> ');
		report.errors.push({
			severity: 'error',
			code: 'field_dependency_cycle',
			path,
			message: `Fields depend on each other in a cycle: ${readable}. Rewst cannot resolve which to evaluate first.`,
		});
	}

	for (const context of contexts) {
		const failedCodes = new Set(context.report.errors.map(error => error.code));
		for (const check of PURE_CHECKS) {
			if (!CHECK_CODES[check].some(code => failedCodes.has(code))) context.report.passedChecks.push(check);
		}
	}
	report.fields = contexts.map(context => context.report);
	const finalized = finalizeReport(report);
	finalized.passedChecks = PURE_CHECKS.filter(
		check => !finalized.errors.some(error => CHECK_CODES[check].includes(error.code)),
	);
	return finalized;
}

/** Which diagnostic codes mean a named check failed. */
const CHECK_CODES: Record<(typeof PURE_CHECKS)[number], string[]> = {
	field_names_valid_and_unique: ['field_name_missing', 'field_name_invalid', 'field_name_duplicate'],
	field_ids_unique: ['field_id_duplicate'],
	field_ids_are_uuids: ['field_id_not_uuid'],
	field_types_supported: ['field_type_invalid'],
	conditions_reference_known_fields: [
		'condition_unknown_source_field',
		'condition_field_id_mismatch',
		'condition_action_invalid',
	],
	option_fields_have_a_source: [
		'options_on_non_option_field',
		'generator_on_non_option_field',
		'options_and_dynamic_options',
	],
	generator_mappings_reference_known_fields: [
		'input_from_field_unknown_source',
		'input_from_field_missing_field_id',
		'generator_workflow_id_missing',
		'generator_key_invalid',
	],
	no_field_dependency_cycles: ['field_dependency_cycle'],
};

function hasStaticOptions(field: RawFormField): boolean {
	const schema = asRecord(field.schema);
	if (!schema) return false;
	if (Array.isArray(schema.enum) && schema.enum.length > 0) return true;
	const items = asRecord(schema.items);
	return Array.isArray(items?.enum) && (items.enum as unknown[]).length > 0;
}

/**
 * The whole pure pass: compile typed fields when supplied, validate whatever
 * field list results, and merge compiler diagnostics into the report. Callers
 * that also need the live checks feed this report into `formWorkflowChecks`.
 */
export function buildFormSemantics(input: {
	typedFields?: readonly TypedFormField[];
	fields?: readonly RawFormField[];
	existingIdsByName?: ReadonlyMap<string, string>;
}): { fields: RawFormField[]; report: FormSemanticReport } {
	const compilerDiagnostics: FormDiagnostic[] = [];
	let fields: RawFormField[] = [];
	if (input.typedFields?.length) {
		const compiled = compileTypedFields(input.typedFields, input.existingIdsByName);
		compilerDiagnostics.push(...compiled.diagnostics);
		fields = compiled.fields as unknown as RawFormField[];
	} else if (input.fields) {
		fields = [...input.fields];
	}
	const report = validateFormFields(fields, input.typedFields?.length ? 'typedFields' : 'fields');
	// Compiler findings belong to the field that produced them, so they show up
	// in the per-field results as well as the top-level lists.
	for (const diagnostic of compilerDiagnostics) {
		const fieldReport = report.fields.find(candidate => candidate.name === diagnostic.fieldName);
		if (fieldReport) (diagnostic.severity === 'error' ? fieldReport.errors : fieldReport.warnings).push(diagnostic);
	}
	report.errors = [...compilerDiagnostics.filter(d => d.severity === 'error'), ...report.errors];
	report.warnings = [...compilerDiagnostics.filter(d => d.severity === 'warning'), ...report.warnings];
	// The pure validator calculated these before compiler diagnostics were
	// attached. Remove checks whose compiler errors now prove they did not pass.
	for (const fieldReport of report.fields) {
		const failedCodes = new Set(fieldReport.errors.map(error => error.code));
		fieldReport.passedChecks = fieldReport.passedChecks.filter(
			check => !CHECK_CODES[check as (typeof PURE_CHECKS)[number]].some(code => failedCodes.has(code)),
		);
	}
	const failedCodes = new Set(report.errors.map(error => error.code));
	report.passedChecks = report.passedChecks.filter(
		check => !CHECK_CODES[check as (typeof PURE_CHECKS)[number]].some(code => failedCodes.has(code)),
	);
	report.ok = report.errors.length === 0;
	return { fields, report };
}
