/**
 * The live half of form semantics: resolving each workflow a form's dropdowns
 * point at and reporting whether it can actually generate their options.
 *
 * Stored JSON alone cannot answer this. A field can name a workflow id that
 * does not exist, names a STANDARD workflow, belongs to an org the form's org
 * cannot see, does not declare the inputs the field maps into it, never
 * produces an `options` output, or has no usable trigger. Each of those saves
 * cleanly and renders an empty dropdown, so they are checked here against the
 * API and reported through the shared {@link FormSemanticReport} shape from
 * `formSemantics.ts`.
 *
 * Nothing in this module executes a workflow. Actually running a generator is
 * a separate, explicitly approved capability (`buddy_test_form_options`);
 * validation and ordinary reads must never trigger one.
 */

import type { Session } from '@sessions';
import {
	fieldName,
	readEnumSourceWorkflow,
	type FormDiagnostic,
	type FormSemanticReport,
	type RawFormField,
	type SkippedCheck,
} from './formSemantics';
import { rawGraphqlOrThrow } from './inputHelpers';

const GENERATOR_WORKFLOW = `query RewstBuddyMcpGeneratorWorkflow($id: ID!) {
  workflow(where: { id: $id }) {
    id
    name
    orgId
    type
    input
    output
    visibleForOrganizations { id name }
    triggers { id name enabled orgId workflowId triggerTypeId }
  }
}`;

interface WorkflowTriggerRow {
	id?: string;
	name?: string | null;
	enabled?: boolean | null;
	orgId?: string | null;
	workflowId?: string | null;
	triggerTypeId?: string | null;
}

interface GeneratorWorkflowRow {
	id?: string;
	name?: string | null;
	orgId?: string | null;
	type?: string | null;
	input?: unknown;
	output?: unknown;
	visibleForOrganizations?: { id?: string; name?: string }[] | null;
	triggers?: (WorkflowTriggerRow | null)[] | null;
}

export const OPTION_GENERATOR_TYPE = 'OPTION_GENERATOR';
/** Output name a form dropdown reads its choices from. */
export const OPTIONS_OUTPUT_NAME = 'options';

export interface TriggerCandidate {
	id: string;
	name?: string;
	enabled: boolean;
}

/** What the live checks concluded about one referenced generator workflow. */
export interface GeneratorResolution {
	/** Where in the caller's input this generator reference came from. */
	path: string;
	workflowId: string;
	workflowName?: string;
	workflowType?: string;
	workflowOrgId?: string;
	declaredInputs: string[];
	declaredOutputs: string[];
	/** Trigger the field will call, when one could be determined unambiguously. */
	resolvedTriggerId?: string;
	resolvedTriggerName?: string;
	/** Triggers that could have been used, when the choice was ambiguous. */
	triggerCandidates: TriggerCandidate[];
	errors: FormDiagnostic[];
	warnings: FormDiagnostic[];
	passedChecks: string[];
	checksNotRun: SkippedCheck[];
}

export const LIVE_CHECKS = [
	'generator_workflow_exists',
	'generator_workflow_is_option_generator',
	'generator_workflow_visible_to_org',
	'generator_inputs_declared',
	'generator_declares_options_output',
	'generator_trigger_resolved',
] as const;

function asStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/**
 * Output names a workflow declares. `Workflow.output` is a JSON list whose
 * entries are either plain names or single-key objects mapping a name to its
 * Jinja expression, so both shapes are read.
 */
function outputNames(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const names: string[] = [];
	for (const entry of value) {
		if (typeof entry === 'string') names.push(entry);
		else if (entry && typeof entry === 'object' && !Array.isArray(entry)) names.push(...Object.keys(entry));
	}
	return names;
}

/** Loads one workflow with everything the generator checks need. */
async function fetchGeneratorWorkflow(session: Session, workflowId: string): Promise<GeneratorWorkflowRow | undefined> {
	const data = await rawGraphqlOrThrow(session, GENERATOR_WORKFLOW, { id: workflowId });
	return (data as { workflow?: GeneratorWorkflowRow | null } | undefined)?.workflow ?? undefined;
}

function skipRemaining(from: number, reason: string): SkippedCheck[] {
	return LIVE_CHECKS.slice(from).map(check => ({ check, reason }));
}

/**
 * Resolves and checks one referenced generator workflow.
 *
 * `mappedInputs` are the generator input names the field supplies (static and
 * field-sourced together); `requestedTriggerId` is the trigger the field names,
 * if any. `path` anchors every diagnostic back at the caller's input.
 */
export async function checkGeneratorWorkflow(opts: {
	session: Session;
	orgId: string;
	workflowId: string;
	mappedInputs?: readonly string[];
	requestedTriggerId?: string;
	path: string;
	fieldName?: string;
}): Promise<GeneratorResolution> {
	const { orgId, workflowId, path } = opts;
	const errors: FormDiagnostic[] = [];
	const warnings: FormDiagnostic[] = [];
	const passedChecks: string[] = [];
	const resolution: GeneratorResolution = {
		path,
		workflowId,
		declaredInputs: [],
		declaredOutputs: [],
		triggerCandidates: [],
		errors,
		warnings,
		passedChecks,
		checksNotRun: [],
	};
	const fail = (code: string, message: string, at = path): void => {
		errors.push({
			severity: 'error',
			code,
			path: at,
			message,
			...(opts.fieldName ? { fieldName: opts.fieldName } : {}),
		});
	};
	const warn = (code: string, message: string, at = path): void => {
		warnings.push({
			severity: 'warning',
			code,
			path: at,
			message,
			...(opts.fieldName ? { fieldName: opts.fieldName } : {}),
		});
	};

	const workflow = await fetchGeneratorWorkflow(opts.session, workflowId);
	if (!workflow?.id) {
		fail(
			'generator_workflow_not_found',
			`Workflow ${workflowId} does not exist or is not readable from org ${orgId}.`,
		);
		resolution.checksNotRun = skipRemaining(1, `workflow ${workflowId} could not be read`);
		return resolution;
	}
	passedChecks.push('generator_workflow_exists');
	resolution.workflowName = workflow.name ?? undefined;
	resolution.workflowType = workflow.type ?? undefined;
	resolution.workflowOrgId = workflow.orgId ?? undefined;
	resolution.declaredInputs = asStringList(workflow.input);
	resolution.declaredOutputs = outputNames(workflow.output);

	if (workflow.type !== OPTION_GENERATOR_TYPE) {
		fail(
			'generator_workflow_wrong_type',
			`Workflow "${workflow.name ?? workflowId}" is ${workflow.type ?? 'of unknown type'}, not ${OPTION_GENERATOR_TYPE}. A form dropdown can only read options from an ${OPTION_GENERATOR_TYPE} workflow.`,
		);
	} else {
		passedChecks.push('generator_workflow_is_option_generator');
	}

	// Visibility is an explicit grant. Being a descendant of the workflow's org
	// does not by itself make a workflow usable from this org, so parent-org
	// membership is deliberately not accepted as evidence here.
	const visibleOrgIds = new Set((workflow.visibleForOrganizations ?? []).map(org => org?.id).filter(Boolean));
	if (workflow.orgId === orgId || visibleOrgIds.has(orgId)) {
		passedChecks.push('generator_workflow_visible_to_org');
	} else {
		fail(
			'generator_workflow_not_visible',
			`Workflow "${workflow.name ?? workflowId}" is owned by org ${workflow.orgId ?? 'unknown'} and is not shared with org ${orgId}. Share it with this org before a form here can use it.`,
		);
	}

	const mapped = [...new Set(opts.mappedInputs ?? [])];
	const undeclared = mapped.filter(input => !resolution.declaredInputs.includes(input));
	if (undeclared.length) {
		fail(
			'generator_input_not_declared',
			`Workflow "${workflow.name ?? workflowId}" does not declare the input(s) ${undeclared.join(', ')}. It declares: ${resolution.declaredInputs.join(', ') || '(none)'}.`,
		);
	} else {
		passedChecks.push('generator_inputs_declared');
	}
	const unsupplied = resolution.declaredInputs.filter(input => !mapped.includes(input));
	if (unsupplied.length) {
		warn(
			'generator_input_not_supplied',
			`Workflow "${workflow.name ?? workflowId}" declares input(s) ${unsupplied.join(', ')} that this field does not supply; the generator receives no value for them.`,
		);
	}

	if (resolution.declaredOutputs.includes(OPTIONS_OUTPUT_NAME)) {
		passedChecks.push('generator_declares_options_output');
	} else {
		fail(
			'generator_missing_options_output',
			`Workflow "${workflow.name ?? workflowId}" does not declare an "${OPTIONS_OUTPUT_NAME}" output, so the field has nothing to read. It declares: ${resolution.declaredOutputs.join(', ') || '(none)'}.`,
		);
	}

	// A compatible trigger belongs to this workflow and to the workflow's own
	// org — a trigger row that names another workflow or another owner cannot
	// invoke this generator, however it was configured.
	const compatible: TriggerCandidate[] = (workflow.triggers ?? [])
		.filter((trigger): trigger is WorkflowTriggerRow => trigger != null && typeof trigger.id === 'string')
		.filter(trigger => (trigger.workflowId ?? workflowId) === workflowId)
		.filter(trigger => trigger.orgId == null || trigger.orgId === workflow.orgId)
		.map(trigger => ({
			id: trigger.id as string,
			name: trigger.name ?? undefined,
			enabled: trigger.enabled === true,
		}));
	resolution.triggerCandidates = compatible;

	const triggerPath = `${path}.triggerId`;
	if (opts.requestedTriggerId) {
		const match = compatible.find(candidate => candidate.id === opts.requestedTriggerId);
		if (!match) {
			fail(
				'generator_trigger_not_on_workflow',
				`Trigger ${opts.requestedTriggerId} does not belong to workflow "${workflow.name ?? workflowId}". Compatible triggers: ${describeCandidates(compatible)}.`,
				triggerPath,
			);
		} else {
			resolution.resolvedTriggerId = match.id;
			resolution.resolvedTriggerName = match.name;
			passedChecks.push('generator_trigger_resolved');
			if (!match.enabled) {
				warn(
					'generator_trigger_disabled',
					`Trigger "${match.name ?? match.id}" is disabled, so the generator will not run until it is enabled.`,
					triggerPath,
				);
			}
		}
		return resolution;
	}

	// An omitted trigger is only filled in when the choice cannot be wrong.
	const enabled = compatible.filter(candidate => candidate.enabled);
	const choice = enabled.length === 1 ? enabled : compatible;
	if (choice.length === 1) {
		resolution.resolvedTriggerId = choice[0].id;
		resolution.resolvedTriggerName = choice[0].name;
		passedChecks.push('generator_trigger_resolved');
		if (!choice[0].enabled) {
			warn(
				'generator_trigger_disabled',
				`Trigger "${choice[0].name ?? choice[0].id}" is disabled, so the generator will not run until it is enabled.`,
				triggerPath,
			);
		}
	} else if (choice.length === 0) {
		fail(
			'generator_trigger_missing',
			`Workflow "${workflow.name ?? workflowId}" has no trigger, so a form field cannot invoke it. Create one with buddy_create_trigger.`,
			triggerPath,
		);
	} else {
		fail(
			'generator_trigger_ambiguous',
			`Workflow "${workflow.name ?? workflowId}" has more than one compatible trigger, so triggerId cannot be inferred. Choose one: ${describeCandidates(choice)}.`,
			triggerPath,
		);
	}
	return resolution;
}

function describeCandidates(candidates: readonly TriggerCandidate[]): string {
	if (!candidates.length) return '(none)';
	return candidates
		.map(candidate => `${candidate.id} ("${candidate.name ?? 'unnamed'}"${candidate.enabled ? '' : ', disabled'})`)
		.join(', ');
}

/** One field's workflow-generated option source, as read off stored field JSON. */
export interface GeneratorReference {
	fieldIndex: number;
	fieldName?: string;
	fieldId?: string;
	workflowId: string;
	triggerId?: string;
	labelKey: string;
	valueKey: string;
	mappedInputs: string[];
	path: string;
}

/** Collects every `enumSourceWorkflow` reference in a field list. */
export function collectGeneratorReferences(fields: readonly RawFormField[], path = 'fields'): GeneratorReference[] {
	const references: GeneratorReference[] = [];
	fields.forEach((field, index) => {
		const source = readEnumSourceWorkflow(field);
		if (!source || typeof source.id !== 'string' || !source.id) return;
		const input = source.input && typeof source.input === 'object' ? Object.keys(source.input as object) : [];
		const fromFields =
			source.inputFromFields && typeof source.inputFromFields === 'object'
				? Object.keys(source.inputFromFields as object)
				: [];
		references.push({
			fieldIndex: index,
			fieldName: fieldName(field),
			fieldId: typeof field.id === 'string' ? field.id : undefined,
			workflowId: source.id,
			triggerId: typeof source.triggerId === 'string' && source.triggerId ? source.triggerId : undefined,
			labelKey: typeof source.labelKey === 'string' && source.labelKey ? source.labelKey : 'label',
			valueKey: typeof source.valueKey === 'string' && source.valueKey ? source.valueKey : 'value',
			mappedInputs: [...new Set([...input, ...fromFields])],
			path: `${path}[${index}].schema.enumSourceWorkflow`,
		});
	});
	return references;
}

/**
 * Runs the live generator checks for every workflow-sourced field and folds the
 * results into an existing pure report. Each workflow is fetched once even when
 * several fields point at it.
 */
export async function applyGeneratorChecks(opts: {
	session: Session;
	orgId: string;
	fields: readonly RawFormField[];
	report: FormSemanticReport;
	path?: string;
}): Promise<{ report: FormSemanticReport; resolutions: GeneratorResolution[] }> {
	const references = collectGeneratorReferences(opts.fields, opts.path ?? 'fields');
	const report = opts.report;
	if (!references.length) {
		report.checksNotRun = [
			...report.checksNotRun,
			...LIVE_CHECKS.map(check => ({ check, reason: 'no field sources its options from a workflow' })),
		];
		return { report, resolutions: [] };
	}

	const resolutions: GeneratorResolution[] = [];
	const referencesByKey = new Map<string, GeneratorReference>();
	for (const reference of references) {
		// One fetch per (workflow, trigger, mapped-input) shape: the same workflow
		// referenced identically twice cannot produce different findings.
		const key = `${reference.workflowId}|${reference.triggerId ?? ''}|${[...reference.mappedInputs].sort().join(',')}`;
		if (!referencesByKey.has(key)) referencesByKey.set(key, reference);
	}
	const checked = await Promise.all(
		[...referencesByKey.entries()].map(
			async ([key, reference]) =>
				[
					key,
					await checkGeneratorWorkflow({
						session: opts.session,
						orgId: opts.orgId,
						workflowId: reference.workflowId,
						mappedInputs: reference.mappedInputs,
						requestedTriggerId: reference.triggerId,
						path: reference.path,
						fieldName: reference.fieldName,
					}),
				] as const,
		),
	);
	const byWorkflow = new Map(checked);
	const rebasePath = (
		diagnostic: FormDiagnostic,
		resolution: GeneratorResolution,
		reference: GeneratorReference,
	): string =>
		diagnostic.path === resolution.path || diagnostic.path.startsWith(`${resolution.path}.`)
			? `${reference.path}${diagnostic.path.slice(resolution.path.length)}`
			: reference.path;
	for (const reference of references) {
		const key = `${reference.workflowId}|${reference.triggerId ?? ''}|${[...reference.mappedInputs].sort().join(',')}`;
		const resolution = byWorkflow.get(key)!;
		const rebaseDiagnostic = (diagnostic: FormDiagnostic): FormDiagnostic => ({
			...diagnostic,
			path: rebasePath(diagnostic, resolution, reference),
			fieldName: reference.fieldName,
		});
		const rebased = {
			...resolution,
			path: reference.path,
			errors: resolution.errors.map(rebaseDiagnostic),
			warnings: resolution.warnings.map(rebaseDiagnostic),
		};
		resolutions.push(rebased);
		const fieldReport = report.fields[reference.fieldIndex];
		if (fieldReport) {
			fieldReport.errors.push(...rebased.errors);
			fieldReport.warnings.push(...rebased.warnings);
			for (const check of resolution.passedChecks) {
				if (!fieldReport.passedChecks.includes(check)) fieldReport.passedChecks.push(check);
			}
		} else {
			report.errors.push(...rebased.errors);
			report.warnings.push(...rebased.warnings);
		}
		report.checksNotRun = [...report.checksNotRun, ...resolution.checksNotRun];
	}

	const failedCodes = new Set(resolutions.flatMap(resolution => resolution.errors.map(error => error.code)));
	for (const check of LIVE_CHECKS) {
		const failing = LIVE_CHECK_CODES[check];
		if (!failing.some(code => failedCodes.has(code)) && !report.passedChecks.includes(check)) {
			report.passedChecks.push(check);
		}
	}
	const errors = [...report.errors, ...report.fields.flatMap(field => field.errors)];
	const warnings = [...report.warnings, ...report.fields.flatMap(field => field.warnings)];
	return {
		report: {
			...report,
			errors: dedupeDiagnostics(errors),
			warnings: dedupeDiagnostics(warnings),
			ok: errors.length === 0,
		},
		resolutions,
	};
}

const LIVE_CHECK_CODES: Record<(typeof LIVE_CHECKS)[number], string[]> = {
	generator_workflow_exists: ['generator_workflow_not_found'],
	generator_workflow_is_option_generator: ['generator_workflow_wrong_type'],
	generator_workflow_visible_to_org: ['generator_workflow_not_visible'],
	generator_inputs_declared: ['generator_input_not_declared'],
	generator_declares_options_output: ['generator_missing_options_output'],
	generator_trigger_resolved: [
		'generator_trigger_not_on_workflow',
		'generator_trigger_missing',
		'generator_trigger_ambiguous',
	],
};

function dedupeDiagnostics(diagnostics: readonly FormDiagnostic[]): FormDiagnostic[] {
	const seen = new Set<string>();
	const result: FormDiagnostic[] = [];
	for (const diagnostic of diagnostics) {
		const key = `${diagnostic.code}|${diagnostic.path}|${diagnostic.message}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(diagnostic);
	}
	return result;
}
