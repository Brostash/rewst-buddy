import { z } from 'zod';
import type { MutationScope } from '../ui/chat/tools/graphqlTool';
import type { ToolSpecDefinition } from '../ui/chat/tools/toolProtocol';
import type { Capability, CapabilityContext } from './Capability';
import { writeCapability } from './capabilityFactories';
import { fieldName as readFieldName, type RawFormField } from './formSemantics';
import { checkGeneratorWorkflow, type GeneratorResolution } from './formWorkflowChecks';
import {
	json,
	optionalBooleanField,
	ORG_ID_FIELD,
	parseCapabilityInput,
	rawGraphqlOrThrow,
	requiredStringField,
	toInputSchema,
} from './inputHelpers';
import { orgDisplayName, withMutationApproval } from './mutationApproval';

/**
 * The only capability that actually runs a Rewst option generator.
 *
 * Saving `enumSourceWorkflow` proves nothing about whether a dropdown will
 * populate: the generator can throw, return nothing, or return objects whose
 * keys are not the `labelKey`/`valueKey` the field reads. This tool executes it
 * once, on purpose, and reports what came back.
 *
 * It is deliberately a write capability even though it changes no Rewst
 * resource: it invokes a workflow, which has side effects the caller must
 * approve. Nothing else in the form surface may execute a generator — reads and
 * `buddy_validate_form` resolve definitions only.
 */

const RUN_WORKFLOW_FOR_OPTIONS = `mutation RewstBuddyMcpRunWorkflowForOptions(
  $input: JSON!
  $inputContext: JSON!
  $orgId: ID!
  $skipCache: Boolean
  $triggerId: ID
  $workflowId: ID!
) {
  runWorkflowForOptions(
    input: $input
    inputContext: $inputContext
    orgId: $orgId
    skipCache: $skipCache
    triggerId: $triggerId
    workflowId: $workflowId
  ) {
    cachedOptions
    executionId
  }
}`;

const FORM_FIELDS = `query RewstBuddyMcpFormFieldsForOptions($orgId: ID!, $formId: ID!) {
  form(orgContextId: $orgId, where: { orgId: $orgId, id: $formId }) {
    id
    name
    orgId
    fields(orgContextId: $orgId) { id index type schema }
  }
}`;

const MAX_REPORTED_OPTION_KEYS = 25;

const testFormOptionsSchema = z.object({
	orgId: ORG_ID_FIELD,
	workflowId: requiredStringField('workflowId').describe(
		'Id of the OPTION_GENERATOR workflow to run. Always required, so the working-workflow scope applies to this call.',
	),
	triggerId: requiredStringField('triggerId')
		.optional()
		.describe("Generator trigger to invoke. Omit to use the workflow's only compatible trigger."),
	formId: requiredStringField('formId')
		.optional()
		.describe('Optional form to take the generator configuration from, together with fieldName.'),
	fieldName: requiredStringField('fieldName')
		.optional()
		.describe('Optional field `name` on that form whose enumSourceWorkflow configuration should be tested.'),
	labelKey: requiredStringField('labelKey')
		.optional()
		.describe(
			'Key each option must carry for its display text. Defaults to the form field\'s labelKey, else "label".',
		),
	valueKey: requiredStringField('valueKey')
		.optional()
		.describe(
			'Key each option must carry for its submitted value. Defaults to the form field\'s valueKey, else "value".',
		),
	values: z
		.record(z.string(), z.unknown())
		.optional()
		.describe(
			'Form values by field `name`, used to fill the generator inputs the field maps from other fields. Values are sent to the generator and are never echoed back in the result.',
		),
	input: z
		.record(z.string(), z.unknown())
		.optional()
		.describe("Generator inputs supplied directly by generator input name. Merged over the field's static input."),
	skipCache: optionalBooleanField('skipCache').describe(
		'Ask Rewst to bypass its cached options and run the generator again (default false).',
	),
});

const testFormOptionsSpec: ToolSpecDefinition = {
	name: 'buddy_test_form_options',
	description:
		'Actually run a Rewst option-generator workflow and report the options it produced, so a workflow-generated dropdown can be verified rather than assumed. Resolves the generator configuration from a form field (formId + fieldName) or from explicit input, validates the workflow and trigger first, then executes it once. Reports how many options came back, which keys they carry, and whether every option has the expected label and value keys; an empty result is reported as inconclusive rather than a pass. This is the only form tool that executes anything: it requires write tools, the org and workflow to be in working scope, and fresh VS Code approval on every call.',
	inputSchema: toInputSchema(testFormOptionsSchema),
};

interface GeneratorConfig {
	workflowId: string;
	triggerId?: string;
	labelKey: string;
	valueKey: string;
	staticInput: Record<string, unknown>;
	/** Generator input name → source field `name` on the form. */
	inputFromFieldNames: Record<string, string>;
	origin: string;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Reads the generator configuration off one named field of a stored form. */
async function configFromForm(
	ctx: CapabilityContext,
	orgId: string,
	formId: string,
	fieldName: string,
): Promise<GeneratorConfig> {
	const data = await rawGraphqlOrThrow(ctx.session, FORM_FIELDS, { orgId, formId });
	const form = (
		data as { form?: { id?: string; orgId?: string; fields?: (RawFormField | null)[] } | null } | undefined
	)?.form;
	if (form?.id !== formId || form.orgId !== orgId) throw new Error(`Form ${formId} is not in org ${orgId}.`);
	const fields = (form.fields ?? []).filter((field): field is RawFormField => field != null);
	const field = fields.find(candidate => readFieldName(candidate) === fieldName);
	if (!field) {
		throw new Error(
			`Form ${formId} has no field named "${fieldName}". Known fields: ${
				fields.map(candidate => readFieldName(candidate) ?? candidate.id).join(', ') || '(none)'
			}.`,
		);
	}
	const source = asRecord(asRecord(field.schema).enumSourceWorkflow);
	if (typeof source.id !== 'string' || !source.id) {
		throw new Error(
			`Field "${fieldName}" on form ${formId} does not source its options from a workflow, so there is nothing to run.`,
		);
	}
	const nameById = new Map<string, string>();
	for (const candidate of fields) {
		const name = readFieldName(candidate);
		if (name && typeof candidate.id === 'string') nameById.set(candidate.id, name);
	}
	const inputFromFieldNames: Record<string, string> = {};
	for (const [inputName, mapping] of Object.entries(asRecord(source.inputFromFields))) {
		const fieldId = asRecord(mapping).fieldId;
		if (typeof fieldId !== 'string') continue;
		const sourceName = nameById.get(fieldId);
		if (sourceName) inputFromFieldNames[inputName] = sourceName;
	}
	return {
		workflowId: source.id,
		triggerId: typeof source.triggerId === 'string' && source.triggerId ? source.triggerId : undefined,
		labelKey: typeof source.labelKey === 'string' && source.labelKey ? source.labelKey : 'label',
		valueKey: typeof source.valueKey === 'string' && source.valueKey ? source.valueKey : 'value',
		staticInput: asRecord(source.input),
		inputFromFieldNames,
		origin: `form ${formId} field "${fieldName}"`,
	};
}

interface OptionCheck {
	status: 'passed' | 'failed' | 'inconclusive';
	message: string;
}

/**
 * Checks the produced options carry the keys the field reads. Only key names
 * and counts are reported: option labels and values are frequently user names,
 * mailboxes or tenant identifiers, and this result goes back to a model.
 */
function checkOptions(
	options: readonly unknown[],
	labelKey: string,
	valueKey: string,
): {
	optionCount: number;
	observedKeys: string[];
	labelKeyCheck: OptionCheck;
	valueKeyCheck: OptionCheck;
} {
	const observed = new Set<string>();
	let missingLabel = 0;
	let missingValue = 0;
	let nonObjects = 0;
	for (const option of options) {
		if (option == null || typeof option !== 'object' || Array.isArray(option)) {
			nonObjects++;
			continue;
		}
		const record = option as Record<string, unknown>;
		for (const key of Object.keys(record)) observed.add(key);
		if (!(labelKey in record)) missingLabel++;
		if (!(valueKey in record)) missingValue++;
	}
	const inconclusive = (key: string): OptionCheck => ({
		status: 'inconclusive',
		message: `The generator returned no options, so whether every option carries "${key}" could not be determined. Supply inputs that produce results, or check the generator's logic.`,
	});
	if (!options.length) {
		return {
			optionCount: 0,
			observedKeys: [],
			labelKeyCheck: inconclusive(labelKey),
			valueKeyCheck: inconclusive(valueKey),
		};
	}
	const verdict = (missing: number, key: string): OptionCheck =>
		missing === 0
			? { status: 'passed', message: `Every one of the ${options.length} option(s) carries "${key}".` }
			: {
					status: 'failed',
					message: `${missing} of ${options.length} option(s) have no "${key}" key, so the dropdown cannot read them. Observed keys: ${[...observed].slice(0, MAX_REPORTED_OPTION_KEYS).join(', ') || '(none)'}.`,
				};
	const result = {
		optionCount: options.length,
		observedKeys: [...observed].slice(0, MAX_REPORTED_OPTION_KEYS),
		labelKeyCheck: verdict(missingLabel, labelKey),
		valueKeyCheck: verdict(missingValue, valueKey),
	};
	if (nonObjects) {
		const notObjects: OptionCheck = {
			status: 'failed',
			message: `${nonObjects} of ${options.length} returned option(s) are not objects, so they have no keys to read. A form dropdown needs objects with "${labelKey}" and "${valueKey}".`,
		};
		result.labelKeyCheck = notObjects;
		result.valueKeyCheck = notObjects;
	}
	return result;
}

async function runTestFormOptions(input: Record<string, unknown>, ctx: CapabilityContext): Promise<string> {
	const parsed = parseCapabilityInput(testFormOptionsSchema, input);
	const { orgId, workflowId } = parsed;
	if ((parsed.formId === undefined) !== (parsed.fieldName === undefined)) {
		throw new Error('Pass formId and fieldName together, or neither.');
	}

	const config: GeneratorConfig =
		parsed.formId && parsed.fieldName
			? await configFromForm(ctx, orgId, parsed.formId, parsed.fieldName)
			: {
					workflowId,
					triggerId: parsed.triggerId,
					labelKey: parsed.labelKey ?? 'label',
					valueKey: parsed.valueKey ?? 'value',
					staticInput: {},
					inputFromFieldNames: {},
					origin: 'explicit input',
				};
	// The workflow id is a required argument so the working-workflow scope gate in
	// the MCP boundary sees it. A form field that points somewhere else is a
	// mismatch the caller must resolve, not something to silently follow.
	if (config.workflowId !== workflowId) {
		throw new Error(
			`${config.origin} generates its options from workflow ${config.workflowId}, but workflowId ${workflowId} was requested. Re-run with workflowId ${config.workflowId} so the working-scope check applies to the workflow that will actually run.`,
		);
	}
	const labelKey = parsed.labelKey ?? config.labelKey;
	const valueKey = parsed.valueKey ?? config.valueKey;
	const triggerId = parsed.triggerId ?? config.triggerId;

	// Build the generator inputs: the field's stored static input, then values
	// taken from the supplied form values through the field's mappings, then any
	// input the caller named directly.
	const values = parsed.values ?? {};
	const generatorInput: Record<string, unknown> = { ...config.staticInput };
	const inputsFromValues: string[] = [];
	const unsuppliedMappings: string[] = [];
	for (const [inputName, sourceField] of Object.entries(config.inputFromFieldNames)) {
		if (Object.prototype.hasOwnProperty.call(values, sourceField)) {
			generatorInput[inputName] = values[sourceField];
			inputsFromValues.push(`${inputName} <- ${sourceField}`);
		} else {
			unsuppliedMappings.push(`${inputName} <- ${sourceField}`);
		}
	}
	for (const [inputName, value] of Object.entries(parsed.input ?? {})) generatorInput[inputName] = value;

	const resolution: GeneratorResolution = await checkGeneratorWorkflow({
		session: ctx.session,
		orgId,
		workflowId,
		mappedInputs: Object.keys(generatorInput),
		requestedTriggerId: triggerId,
		path: 'workflowId',
	});
	if (resolution.errors.length) {
		throw new Error(
			`The generator was not run: ${resolution.errors.map(error => error.message).join(' ')} Fix the workflow or the field configuration, then retry.`,
		);
	}

	const orgName = orgDisplayName(ctx);
	const scope: MutationScope = {
		scopeId: workflowId,
		scopeName: resolution.workflowName ?? workflowId,
		orgId,
		orgName,
	};
	const summary = `Run option generator "${resolution.workflowName ?? workflowId}" (${workflowId}) once in org "${orgName}" (${orgId}) to test the options for ${config.origin}. This executes the workflow.`;
	return withMutationApproval(
		scope,
		summary,
		async () => {
			const data = await rawGraphqlOrThrow(ctx.session, RUN_WORKFLOW_FOR_OPTIONS, {
				input: generatorInput,
				inputContext: values,
				orgId,
				skipCache: parsed.skipCache ?? false,
				triggerId: resolution.resolvedTriggerId ?? triggerId ?? null,
				workflowId,
			});
			const response = (
				data as { runWorkflowForOptions?: { cachedOptions?: unknown; executionId?: unknown } | null }
			)?.runWorkflowForOptions;
			const tested = {
				origin: config.origin,
				workflowId,
				workflowName: resolution.workflowName ?? null,
				triggerId: resolution.resolvedTriggerId ?? triggerId ?? null,
				// Input names only — never the values, which routinely carry tenant
				// ids, mailboxes and user names.
				generatorInputsSent: Object.keys(generatorInput).sort(),
				inputsTakenFromFormValues: inputsFromValues.sort(),
				mappedInputsWithNoSuppliedValue: unsuppliedMappings.sort(),
				labelKey,
				valueKey,
				skipCache: parsed.skipCache ?? false,
			};
			if (!response) {
				return json({
					status: 'inconclusive',
					executed: true,
					tested,
					message:
						'runWorkflowForOptions returned no response body, so the generator produced neither options nor an execution id. Check the trigger and the workflow in Rewst.',
				});
			}
			const cached = response.cachedOptions;
			if (!Array.isArray(cached)) {
				if (!response.executionId) {
					return json({
						status: 'inconclusive',
						executed: true,
						tested,
						message:
							'The generator returned neither cached options nor an execution id, so nothing could be checked.',
					});
				}
				const stillRunning = 'the generator is still running; no options were returned yet';
				return json({
					status: 'running',
					executed: true,
					tested,
					executionId: response.executionId,
					checksNotRun: [
						{ check: 'option_label_key_present', reason: stillRunning },
						{ check: 'option_value_key_present', reason: stillRunning },
					],
					message:
						'The generator was started asynchronously and returned no cached options yet. Inspect the run with buddy_execution_logs, then re-run this test to read the cached options.',
				});
			}
			const checks = checkOptions(cached, labelKey, valueKey);
			const failed = checks.labelKeyCheck.status === 'failed' || checks.valueKeyCheck.status === 'failed';
			const inconclusive =
				checks.labelKeyCheck.status === 'inconclusive' || checks.valueKeyCheck.status === 'inconclusive';
			return json({
				status: failed ? 'failed' : inconclusive ? 'inconclusive' : 'passed',
				executed: true,
				tested,
				executionId: response.executionId ?? null,
				optionCount: checks.optionCount,
				observedOptionKeys: checks.observedKeys,
				labelKeyCheck: checks.labelKeyCheck,
				valueKeyCheck: checks.valueKeyCheck,
				message:
					'Option labels and values are not included in this result; only their key names and counts are reported.',
			});
		},
		{ alwaysPrompt: true },
	);
}

export const FORM_OPTIONS_CAPABILITIES: Capability[] = [writeCapability(testFormOptionsSpec, runTestFormOptions)];
