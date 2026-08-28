import { z } from 'zod';
import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { writeCapability } from './capabilityFactories';
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

/**
 * buddy_create_trigger: the missing half of "a form that can actually be
 * submitted". A form definition is inert until a trigger connects it to a
 * workflow, and an option generator is unreachable until it has a trigger of
 * its own.
 *
 * Three things make this safe enough to expose. The trigger *type* is resolved
 * against the live catalogue rather than guessed from a string. The workflow is
 * re-verified to belong to the requested org (a session can manage several, and
 * `workflowId` is a required argument so the working-workflow scope gate in the
 * MCP boundary sees it). And a new trigger is created **disabled** unless the
 * caller explicitly asks for it to be live, which the approval summary says out
 * loud — creating a trigger is what turns a passive form into an execution
 * entry point.
 *
 * Editing an existing trigger stays with the dedicated tools built on
 * `triggerUpdate.ts` (`buddy_set_trigger_tags`, `buddy_set_trigger_activation`,
 * `buddy_set_trigger_enabled`), which carry the patch/diff safeguards from #181
 * and #184. This capability only creates.
 */

const CREATE_TRIGGER = `mutation RewstBuddyMcpCreateTrigger($trigger: TriggerCreateInput!) {
  createTrigger(createPatch: true, trigger: $trigger) {
    id
    name
    enabled
    orgId
    workflowId
    triggerTypeId
    formId
  }
}`;

const TRIGGER_TYPES = `query RewstBuddyMcpTriggerTypes($limit: Int) {
  triggerTypes(limit: $limit, order: [["name"]]) { id name ref enabled isWebhook isPoll }
}`;

const WORKFLOW_OWNER = `query RewstBuddyMcpTriggerWorkflowOwner($id: ID!) {
  workflow(where: { id: $id }) { id name orgId type }
}`;

const FORM_OWNER = `query RewstBuddyMcpTriggerFormOwner($orgId: ID!, $formId: ID!) {
  forms(where: { orgId: $orgId, id: $formId }, limit: 1) { id name orgId }
}`;

const SAVED_TRIGGER = `query RewstBuddyMcpSavedTrigger($orgId: ID!, $id: ID!) {
  triggers(where: { orgId: $orgId, id: $id }, includeUnlisted: true) {
    id
    name
    enabled
    orgId
    workflowId
    triggerTypeId
    formId
    parameters
    criteria
    form { id name }
  }
}`;

const TRIGGER_TYPE_LIMIT = 500;
/** Parameter key a Rewst form-submission trigger uses to name its form. */
export const FORM_PARAMETER_KEY = 'form_id';

interface TriggerTypeRow {
	id?: string;
	name?: string | null;
	ref?: string | null;
	enabled?: boolean | null;
	isWebhook?: boolean | null;
	isPoll?: boolean | null;
}

interface TriggerRow {
	id?: string;
	name?: string | null;
	enabled?: boolean | null;
	orgId?: string | null;
	workflowId?: string | null;
	triggerTypeId?: string | null;
	formId?: string | null;
	parameters?: unknown;
	criteria?: unknown;
	form?: { id?: string; name?: string } | null;
}

function describeTriggerType(type: TriggerTypeRow): string {
	return `${type.id} (ref "${type.ref ?? 'unknown'}", "${type.name ?? 'unnamed'}")`;
}

/** Whether a trigger type looks like the one a submitted form fires. */
function isFormSubmissionType(type: TriggerTypeRow): boolean {
	return /form/i.test(`${type.ref ?? ''} ${type.name ?? ''}`);
}

/**
 * Resolves the trigger type against the live catalogue. An id must exist; a ref
 * is matched exactly; with neither, a form trigger is inferred only when exactly
 * one form-submission type exists, and otherwise the candidates are returned so
 * the caller can choose.
 */
async function resolveTriggerType(
	ctx: CapabilityContext,
	opts: { triggerTypeId?: string; triggerTypeRef?: string; forForm: boolean },
): Promise<TriggerTypeRow> {
	const data = await rawGraphqlOrThrow(ctx.session, TRIGGER_TYPES, { limit: TRIGGER_TYPE_LIMIT });
	const types = ((data as { triggerTypes?: TriggerTypeRow[] } | undefined)?.triggerTypes ?? []).filter(
		type => typeof type?.id === 'string',
	);
	if (opts.triggerTypeId) {
		const match = types.find(type => type.id === opts.triggerTypeId);
		if (!match) {
			throw new Error(
				`Trigger type ${opts.triggerTypeId} does not exist. List the available types with buddy_graphql_query on triggerTypes, or pass triggerTypeRef instead.`,
			);
		}
		return match;
	}
	if (opts.triggerTypeRef) {
		const matches = types.filter(type => type.ref === opts.triggerTypeRef);
		if (matches.length === 1) return matches[0];
		if (!matches.length) {
			throw new Error(
				`No trigger type has ref "${opts.triggerTypeRef}". Refs available in this org: ${
					types
						.map(type => type.ref)
						.filter(Boolean)
						.sort()
						.slice(0, 40)
						.join(', ') || '(none)'
				}.`,
			);
		}
		throw new Error(
			`Ref "${opts.triggerTypeRef}" matches more than one trigger type: ${matches.map(describeTriggerType).join(', ')}. Pass triggerTypeId.`,
		);
	}
	if (!opts.forForm) {
		throw new Error(
			'Pass triggerTypeId or triggerTypeRef. A trigger type is only inferred when formId is supplied.',
		);
	}
	const candidates = types.filter(isFormSubmissionType);
	if (candidates.length === 1) return candidates[0];
	throw new Error(
		candidates.length
			? `More than one trigger type could fire a form submission: ${candidates.map(describeTriggerType).join(', ')}. Pass triggerTypeId or triggerTypeRef to choose.`
			: 'No form-submission trigger type was found in this catalogue. Pass triggerTypeId or triggerTypeRef explicitly.',
	);
}

const createTriggerSchema = z.object({
	orgId: ORG_ID_FIELD,
	workflowId: requiredStringField('workflowId').describe(
		'Id of the workflow this trigger invokes. Required, so the working-workflow scope applies to this call.',
	),
	name: requiredStringField('name').describe('Name for the new trigger.'),
	triggerTypeId: requiredStringField('triggerTypeId')
		.optional()
		.describe('Id of the trigger type. Resolved against the live catalogue.'),
	triggerTypeRef: requiredStringField('triggerTypeRef')
		.optional()
		.describe('Ref of the trigger type, as an alternative to triggerTypeId.'),
	formId: requiredStringField('formId')
		.optional()
		.describe(
			"Id of the form this trigger submits. Sets both the trigger's formId and parameters.form_id, and lets the form-submission trigger type be inferred when it is unambiguous.",
		),
	description: z.string().max(255, 'Trigger description must be at most 255 characters.').optional(),
	parameters: z
		.record(z.string(), z.unknown())
		.optional()
		.describe('Trigger-type parameters. With formId, form_id is filled in and must not conflict.'),
	criteria: z
		.record(z.string(), z.unknown())
		.optional()
		.describe('Trigger criteria. Defaults to an empty object so the trigger stores an evaluable criteria value.'),
	enabled: optionalBooleanField('enabled').describe(
		'Whether the trigger fires immediately. Defaults to false: a new trigger is created disabled, and enabling it is stated in the approval prompt.',
	),
});

const createTriggerSpec: ToolSpecDefinition = {
	name: 'buddy_create_trigger',
	description:
		'Create a Rewst trigger that invokes one workflow, optionally as the submission trigger for a form. The trigger type is resolved against the live catalogue by id or ref (and inferred only when a form is named and exactly one form-submission type exists), the workflow and form are verified to belong to the requested org, and the saved trigger is read back to confirm its workflow and form association. New triggers are created disabled unless enabled:true is passed, because a trigger is what turns a passive form into an execution entry point. Editing existing triggers uses buddy_set_trigger_enabled, buddy_set_trigger_tags and buddy_set_trigger_activation. Requires write tools, org and workflow working scope, and fresh VS Code approval.',
	inputSchema: toInputSchema(createTriggerSchema),
};

async function runCreateTrigger(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const parsed = parseCapabilityInput(createTriggerSchema, input);
	const { orgId, workflowId, name } = parsed;

	const workflow = await requireResourceInOrg({
		label: 'Workflow',
		id: workflowId,
		orgId,
		fetch: async () => {
			const data = await rawGraphqlOrThrow(ctx.session, WORKFLOW_OWNER, { id: workflowId });
			return (data as { workflow?: { id?: string; name?: string; orgId?: string; type?: string } } | undefined)
				?.workflow;
		},
	});

	if (parsed.formId) {
		await requireResourceInOrg({
			label: 'Form',
			id: parsed.formId,
			orgId,
			fetch: async () => {
				const data = await rawGraphqlOrThrow(ctx.session, FORM_OWNER, { orgId, formId: parsed.formId });
				const forms = (data as { forms?: { id?: string; orgId?: string }[] } | undefined)?.forms ?? [];
				return forms.find(form => form.id === parsed.formId);
			},
		});
	}

	const triggerType = await resolveTriggerType(ctx, {
		triggerTypeId: parsed.triggerTypeId,
		triggerTypeRef: parsed.triggerTypeRef,
		forForm: parsed.formId !== undefined,
	});
	if (parsed.formId && !isFormSubmissionType(triggerType)) {
		throw new Error(
			`Trigger type ${describeTriggerType(triggerType)} is not a form submission trigger type and cannot be used with formId.`,
		);
	}

	// A form trigger stores its form twice: as the relation (`formId`) and inside
	// the type's parameters (`form_id`). Rewst reads them in different places, so
	// they must agree — a caller-supplied mismatch is an error, never a silent
	// overwrite.
	const parameters: Record<string, unknown> = { ...(parsed.parameters ?? {}) };
	if (parsed.formId) {
		const supplied = parameters[FORM_PARAMETER_KEY];
		if (supplied !== undefined && supplied !== parsed.formId) {
			throw new Error(
				`parameters.${FORM_PARAMETER_KEY} is "${String(supplied)}" but formId is "${parsed.formId}". They address the same form and must match.`,
			);
		}
		parameters[FORM_PARAMETER_KEY] = parsed.formId;
	}
	const criteria = parsed.criteria ?? {};
	const enabled = parsed.enabled ?? false;

	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = { scopeId: workflowId, scopeName: workflow.name ?? workflowId, orgId, orgName };
	const summary = [
		`Create trigger "${name}" of type ${describeTriggerType(triggerType)} in org "${orgName}" (${orgId})`,
		`invoking workflow "${workflow.name ?? workflowId}" (${workflowId})`,
		parsed.formId ? `as the submission trigger for form ${parsed.formId}` : undefined,
		enabled
			? 'ENABLED on creation: it will fire as soon as it is saved'
			: 'disabled on creation; enable it later with buddy_set_trigger_enabled',
	]
		.filter(Boolean)
		.join('; ');

	return withMutationApproval(
		scope,
		summary,
		async () => {
			const trigger: Record<string, unknown> = {
				orgId,
				workflowId,
				name,
				triggerTypeId: triggerType.id,
				enabled,
				criteria,
			};
			if (Object.keys(parameters).length) trigger.parameters = parameters;
			if (parsed.description !== undefined) trigger.description = parsed.description;
			if (parsed.formId) trigger.formId = parsed.formId;

			const data = await rawGraphqlOrThrow(ctx.session, CREATE_TRIGGER, { trigger });
			const created = (data as { createTrigger?: TriggerRow | null } | undefined)?.createTrigger;
			if (!created?.id) throw new Error('createTrigger returned no trigger; the mutation may have failed.');

			const verification = await verifySavedTrigger(ctx, orgId, created.id, {
				workflowId,
				formId: parsed.formId,
				enabled,
				triggerTypeId: triggerType.id,
			});
			return json({
				status: verification.status === 'verified' ? 'created' : 'created_unverified',
				id: created.id,
				name: created.name ?? name,
				enabled: created.enabled ?? enabled,
				workflowId: created.workflowId ?? workflowId,
				triggerTypeId: created.triggerTypeId ?? triggerType.id,
				triggerTypeRef: triggerType.ref ?? null,
				formId: created.formId ?? parsed.formId ?? null,
				verification,
			});
		},
		{ alwaysPrompt: true },
	);
}

interface TriggerVerification {
	status: 'verified' | 'mismatch' | 'unverified';
	message: string;
	differences?: string[];
}

/**
 * Reads the saved trigger back and confirms it points at the intended workflow,
 * form and enabled state. As with forms, a failure here does not mean the write
 * was rolled back.
 */
async function verifySavedTrigger(
	ctx: CapabilityContext,
	orgId: string,
	triggerId: string,
	intended: { workflowId: string; formId?: string; enabled: boolean; triggerTypeId?: string },
): Promise<TriggerVerification> {
	let saved: TriggerRow | undefined;
	try {
		const data = await rawGraphqlOrThrow(ctx.session, SAVED_TRIGGER, { orgId, id: triggerId });
		saved = ((data as { triggers?: TriggerRow[] } | undefined)?.triggers ?? []).find(row => row.id === triggerId);
	} catch (error) {
		return {
			status: 'unverified',
			message: `The trigger was created as ${triggerId}, but reading it back failed: ${
				error instanceof Error ? error.message : String(error)
			}. The write was not rolled back — inspect it with buddy_get_trigger rather than creating it again.`,
		};
	}
	if (!saved) {
		return {
			status: 'unverified',
			message: `The trigger was created as ${triggerId}, but it could not be read back in org ${orgId}. The write was not rolled back — inspect it with buddy_get_trigger rather than creating it again.`,
		};
	}
	const differences: string[] = [];
	if (saved.workflowId !== intended.workflowId) {
		differences.push(`workflowId: expected ${intended.workflowId}, saved ${saved.workflowId ?? 'null'}`);
	}
	if (intended.triggerTypeId && saved.triggerTypeId !== intended.triggerTypeId) {
		differences.push(`triggerTypeId: expected ${intended.triggerTypeId}, saved ${saved.triggerTypeId ?? 'null'}`);
	}
	if ((saved.enabled ?? false) !== intended.enabled) {
		differences.push(`enabled: expected ${intended.enabled}, saved ${saved.enabled ?? false}`);
	}
	if (intended.formId) {
		const parameters = saved.parameters as Record<string, unknown> | null | undefined;
		if (saved.formId !== intended.formId) {
			differences.push(`formId: expected ${intended.formId}, saved ${saved.formId ?? 'null'}`);
		}
		if (saved.form?.id !== intended.formId) {
			differences.push(`form association: expected form ${intended.formId}, saved ${saved.form?.id ?? 'none'}`);
		}
		if (parameters?.[FORM_PARAMETER_KEY] !== intended.formId) {
			differences.push(
				`parameters.${FORM_PARAMETER_KEY}: expected ${intended.formId}, saved ${String(parameters?.[FORM_PARAMETER_KEY] ?? 'null')}`,
			);
		}
	}
	return differences.length
		? {
				status: 'mismatch',
				message: `Trigger ${triggerId} was created, but the saved trigger differs from what was requested. The write was not rolled back; correct it rather than creating a second trigger.`,
				differences,
			}
		: {
				status: 'verified',
				message: `Trigger ${triggerId} was read back and matches the requested workflow${intended.formId ? ', form association' : ''} and enabled state.`,
			};
}

export const TRIGGER_CREATE_CAPABILITIES: Capability[] = [writeCapability(createTriggerSpec, runCreateTrigger)];
