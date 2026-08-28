import type { Session } from '@sessions';
import * as assert from 'assert';
import { suite, test } from '../test/tdd';
import { validateFormFields, type RawFormField } from './formSemantics';
import { applyGeneratorChecks, checkGeneratorWorkflow, collectGeneratorReferences } from './formWorkflowChecks';

interface WorkflowStub {
	id?: string;
	name?: string;
	orgId?: string;
	type?: string;
	input?: unknown;
	output?: unknown;
	visibleForOrganizations?: { id: string }[];
	triggers?: { id: string; name?: string; enabled?: boolean; orgId?: string; workflowId?: string }[];
}

function sessionFor(workflows: Record<string, WorkflowStub | null>): {
	session: Session;
	calls: { id: unknown }[];
} {
	const calls: { id: unknown }[] = [];
	const session = {
		rawGraphql: async (_query: string, variables?: Record<string, unknown>) => {
			calls.push({ id: variables?.id });
			return { data: { workflow: workflows[String(variables?.id)] ?? null } };
		},
	} as unknown as Session;
	return { session, calls };
}

const generator: WorkflowStub = {
	id: 'wf',
	name: 'Get users',
	orgId: 'org-1',
	type: 'OPTION_GENERATOR',
	input: ['skipCache'],
	output: [{ options: '{{ CTX.users }}' }],
	triggers: [{ id: 'trg', name: 'Options', enabled: true, orgId: 'org-1', workflowId: 'wf' }],
};

const check = (workflows: Record<string, WorkflowStub | null>, overrides: Record<string, unknown> = {}) => {
	const { session, calls } = sessionFor(workflows);
	return {
		calls,
		run: () =>
			checkGeneratorWorkflow({
				session,
				orgId: 'org-1',
				workflowId: 'wf',
				mappedInputs: ['skipCache'],
				path: 'fields[0].schema.enumSourceWorkflow',
				...overrides,
			}),
	};
};

const codes = (diagnostics: { code: string }[]): string[] => diagnostics.map(diagnostic => diagnostic.code);

suite('Unit: formWorkflowChecks generator resolution', () => {
	test('accepts a visible option generator with declared inputs, options output and one trigger', async () => {
		const resolution = await check({ wf: generator }).run();
		assert.deepStrictEqual(resolution.errors, []);
		assert.deepStrictEqual(resolution.warnings, []);
		assert.strictEqual(resolution.resolvedTriggerId, 'trg');
		assert.strictEqual(resolution.resolvedTriggerName, 'Options');
		assert.deepStrictEqual(resolution.declaredInputs, ['skipCache']);
		assert.deepStrictEqual(resolution.declaredOutputs, ['options']);
		assert.deepStrictEqual(resolution.passedChecks, [
			'generator_workflow_exists',
			'generator_workflow_is_option_generator',
			'generator_workflow_visible_to_org',
			'generator_inputs_declared',
			'generator_declares_options_output',
			'generator_trigger_resolved',
		]);
	});

	test('reports a missing workflow and does not claim the later checks ran', async () => {
		const resolution = await check({ wf: null }).run();
		assert.deepStrictEqual(codes(resolution.errors), ['generator_workflow_not_found']);
		assert.deepStrictEqual(
			resolution.checksNotRun.map(skipped => skipped.check),
			[
				'generator_workflow_is_option_generator',
				'generator_workflow_visible_to_org',
				'generator_inputs_declared',
				'generator_declares_options_output',
				'generator_trigger_resolved',
			],
		);
	});

	test('rejects a workflow that is not an option generator', async () => {
		const resolution = await check({ wf: { ...generator, type: 'STANDARD' } }).run();
		assert.ok(codes(resolution.errors).includes('generator_workflow_wrong_type'));
		assert.match(resolution.errors[0].message, /STANDARD, not OPTION_GENERATOR/);
	});

	test('accepts an explicit cross-org share but never infers visibility from a parent org', async () => {
		const inParent = {
			...generator,
			orgId: 'parent-org',
			triggers: [{ id: 'trg', name: 'Options', enabled: true, orgId: 'parent-org', workflowId: 'wf' }],
		};
		const ok = await check({ wf: { ...inParent, visibleForOrganizations: [{ id: 'org-1' }] } }).run();
		assert.ok(ok.passedChecks.includes('generator_workflow_visible_to_org'));

		const unshared = await check({ wf: { ...inParent, visibleForOrganizations: [] } }).run();
		assert.deepStrictEqual(codes(unshared.errors), ['generator_workflow_not_visible']);
		assert.match(unshared.errors[0].message, /owned by org parent-org and is not shared with org org-1/);
	});

	test('rejects an input the generator does not declare and warns about one it never receives', async () => {
		const resolution = await check({ wf: { ...generator, input: ['tenant_id'] } }).run();
		assert.deepStrictEqual(codes(resolution.errors), ['generator_input_not_declared']);
		assert.match(resolution.errors[0].message, /does not declare the input\(s\) skipCache/);
		assert.deepStrictEqual(codes(resolution.warnings), ['generator_input_not_supplied']);
		assert.match(resolution.warnings[0].message, /tenant_id/);
	});

	test('rejects a generator with no options output', async () => {
		const resolution = await check({ wf: { ...generator, output: ['users'] } }).run();
		assert.deepStrictEqual(codes(resolution.errors), ['generator_missing_options_output']);
		assert.match(resolution.errors[0].message, /It declares: users/);
	});

	test('resolves an omitted trigger only when the compatible choice is unambiguous', async () => {
		const none = await check({ wf: { ...generator, triggers: [] } }).run();
		assert.deepStrictEqual(codes(none.errors), ['generator_trigger_missing']);

		const many = await check({
			wf: {
				...generator,
				triggers: [
					{ id: 't1', name: 'A', enabled: true, orgId: 'org-1', workflowId: 'wf' },
					{ id: 't2', name: 'B', enabled: true, orgId: 'org-1', workflowId: 'wf' },
				],
			},
		}).run();
		assert.deepStrictEqual(codes(many.errors), ['generator_trigger_ambiguous']);
		assert.match(many.errors[0].message, /t1 \("A"\), t2 \("B"\)/);
		assert.deepStrictEqual(
			many.triggerCandidates.map(candidate => candidate.id),
			['t1', 't2'],
		);

		const oneEnabled = await check({
			wf: {
				...generator,
				triggers: [
					{ id: 't1', name: 'A', enabled: true, orgId: 'org-1', workflowId: 'wf' },
					{ id: 't2', name: 'B', enabled: false, orgId: 'org-1', workflowId: 'wf' },
				],
			},
		}).run();
		assert.strictEqual(oneEnabled.resolvedTriggerId, 't1');
	});

	test('resolves a single disabled trigger but warns that it will not run', async () => {
		const resolution = await check({
			wf: {
				...generator,
				triggers: [{ id: 'trg', name: 'Options', enabled: false, orgId: 'org-1', workflowId: 'wf' }],
			},
		}).run();
		assert.strictEqual(resolution.resolvedTriggerId, 'trg');
		assert.deepStrictEqual(codes(resolution.warnings), ['generator_trigger_disabled']);
	});

	test('rejects a named trigger that belongs to another workflow or owner', async () => {
		const wrongWorkflow = await check({ wf: generator }, { requestedTriggerId: 'other' }).run();
		assert.deepStrictEqual(codes(wrongWorkflow.errors), ['generator_trigger_not_on_workflow']);
		assert.match(wrongWorkflow.errors[0].message, /Compatible triggers: trg \("Options"\)/);

		const foreignOwner = await check(
			{ wf: { ...generator, triggers: [{ id: 'trg', enabled: true, orgId: 'other-org', workflowId: 'wf' }] } },
			{ requestedTriggerId: 'trg' },
		).run();
		assert.deepStrictEqual(codes(foreignOwner.errors), ['generator_trigger_not_on_workflow']);
	});
});

/** Deterministic, valid UUIDs so fixtures read like real Rewst field ids. */
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

suite('Unit: formWorkflowChecks over a field list', () => {
	let nextId = 0;
	const dynamicField = (name: string, workflowId: string, triggerId?: string): RawFormField => ({
		id: uuid(++nextId),
		type: 'SELECT',
		schema: {
			name,
			enumSourceWorkflow: {
				id: workflowId,
				...(triggerId ? { triggerId } : {}),
				labelKey: 'label',
				valueKey: 'value',
				input: { skipCache: '' },
			},
		},
	});

	test('collects each generator reference with its keys and mapped inputs', () => {
		const field = dynamicField('a', 'wf', 'trg');
		const references = collectGeneratorReferences([field]);
		assert.deepStrictEqual(references, [
			{
				fieldIndex: 0,
				fieldName: 'a',
				fieldId: field.id,
				workflowId: 'wf',
				triggerId: 'trg',
				labelKey: 'label',
				valueKey: 'value',
				mappedInputs: ['skipCache'],
				path: 'fields[0].schema.enumSourceWorkflow',
			},
		]);
	});

	test('attaches live findings to the field that caused them and fetches each workflow once', async () => {
		const fields = [dynamicField('a', 'wf'), dynamicField('b', 'wf')];
		const { session, calls } = sessionFor({ wf: generator });
		const { report, resolutions } = await applyGeneratorChecks({
			session,
			orgId: 'org-1',
			fields,
			report: validateFormFields(fields),
		});
		assert.strictEqual(report.ok, true);
		assert.strictEqual(calls.length, 1, 'the same reference shape is only fetched once');
		assert.strictEqual(resolutions.length, 2);
		assert.ok(report.fields[0].passedChecks.includes('generator_workflow_is_option_generator'));
		assert.ok(report.passedChecks.includes('generator_trigger_resolved'));
	});

	test('checks distinct generators concurrently and preserves reference-order diagnostics', async () => {
		const fields = [dynamicField('first', 'wf-first'), dynamicField('second', 'wf-second')];
		let releaseFirst: (() => void) | undefined;
		const firstStarted = new Promise<void>(resolve => {
			releaseFirst = resolve;
		});
		let secondStarted!: () => void;
		const secondCallStarted = new Promise<void>(resolve => {
			secondStarted = resolve;
		});
		let calls = 0;
		const session = {
			rawGraphql: async (_query: string, variables?: Record<string, unknown>) => {
				calls++;
				if (variables?.id === 'wf-first') await firstStarted;
				if (variables?.id === 'wf-second') secondStarted();
				return { data: { workflow: null } };
			},
		} as unknown as Session;
		const checking = applyGeneratorChecks({
			session,
			orgId: 'org-1',
			fields,
			report: validateFormFields(fields),
		});
		await secondCallStarted;
		assert.strictEqual(calls, 2, 'both distinct generator checks begin before either completes');
		releaseFirst?.();
		const { report } = await checking;
		assert.deepStrictEqual(
			report.errors.map(error => error.path),
			['fields[0].schema.enumSourceWorkflow', 'fields[1].schema.enumSourceWorkflow'],
		);
	});

	test('rebases cached warnings onto each later field, including a triggerId suffix', async () => {
		const fields = [dynamicField('first', 'wf', 'trg'), dynamicField('second', 'wf', 'trg')];
		delete (fields[1].schema as Record<string, unknown>).name;
		const { session, calls } = sessionFor({
			wf: {
				...generator,
				input: ['tenant_id'],
				triggers: [{ id: 'trg', name: 'Options', enabled: false, orgId: 'org-1', workflowId: 'wf' }],
			},
		});
		const { report } = await applyGeneratorChecks({
			session,
			orgId: 'org-1',
			fields,
			report: validateFormFields(fields),
		});
		assert.strictEqual(calls.length, 1);
		assert.deepStrictEqual(
			report.fields[1].warnings.map(warning => [warning.code, warning.path, warning.fieldName]),
			[
				['generator_input_not_supplied', 'fields[1].schema.enumSourceWorkflow', undefined],
				['generator_trigger_disabled', 'fields[1].schema.enumSourceWorkflow.triggerId', undefined],
			],
		);
	});

	test('a broken generator fails the form report and names the offending field', async () => {
		const fields = [dynamicField('a', 'missing')];
		const { session } = sessionFor({});
		const { report } = await applyGeneratorChecks({
			session,
			orgId: 'org-1',
			fields,
			report: validateFormFields(fields),
		});
		assert.strictEqual(report.ok, false);
		assert.deepStrictEqual(codes(report.errors), ['generator_workflow_not_found']);
		assert.strictEqual(report.fields[0].errors[0].fieldName, 'a');
		assert.ok(!report.passedChecks.includes('generator_workflow_exists'));
	});

	test('records the live checks as not run when no field sources options from a workflow', async () => {
		const fields: RawFormField[] = [{ id: uuid(99), type: 'TEXT_INPUT', schema: { name: 'a' } }];
		const { session, calls } = sessionFor({});
		const { report, resolutions } = await applyGeneratorChecks({
			session,
			orgId: 'org-1',
			fields,
			report: validateFormFields(fields),
		});
		assert.strictEqual(calls.length, 0, 'validation never contacts a workflow it does not need');
		assert.deepStrictEqual(resolutions, []);
		assert.deepStrictEqual(
			report.checksNotRun.map(skipped => skipped.check),
			[
				'generator_workflow_exists',
				'generator_workflow_is_option_generator',
				'generator_workflow_visible_to_org',
				'generator_inputs_declared',
				'generator_declares_options_output',
				'generator_trigger_resolved',
			],
		);
	});
});
