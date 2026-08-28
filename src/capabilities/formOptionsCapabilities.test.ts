import type { Session } from '@sessions';
import { createCapabilityTestHarness, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { _resetApprovedMutationScopes } from '../ui/chat/tools/graphqlTool';
import { FORM_OPTIONS_CAPABILITIES } from './formOptionsCapabilities';
import { _resetMcpMutationApproverForTesting, setMcpMutationApprover } from './graphqlMutateCapability';

const { suite, test, setup, teardown } = Mocha;
const { cap } = createCapabilityTestHarness(FORM_OPTIONS_CAPABILITIES);

function sequencedCtx(responses: unknown[]) {
	const calls: { query: string; variables?: Record<string, unknown> }[] = [];
	let index = 0;
	const session = {
		rawGraphql: async (query: string, variables?: Record<string, unknown>) => {
			calls.push({ query, variables });
			return responses[index++] as { data?: unknown; errors?: unknown };
		},
		profile: { org: { id: 'org-1', name: 'Sandbox' }, allManagedOrgs: [{ id: 'org-1', name: 'Sandbox' }] },
	} as unknown as Session;
	return { calls, ctx: { session, orgId: 'org-1', sessions: [session] } };
}

const generatorWorkflow = {
	data: {
		workflow: {
			id: 'wf',
			name: 'Get users',
			orgId: 'org-1',
			type: 'OPTION_GENERATOR',
			input: ['tenant_id', 'skipCache'],
			output: [{ options: '{{ CTX.users }}' }],
			visibleForOrganizations: [],
			triggers: [{ id: 'trg', name: 'Options', enabled: true, orgId: 'org-1', workflowId: 'wf' }],
		},
	},
};

const formWithGenerator = {
	data: {
		form: {
			id: 'form-1',
			name: 'Offboarding',
			orgId: 'org-1',
			fields: [
				{ id: 'tenant', index: 0, type: 'TEXT_INPUT', schema: { name: 'tenant' } },
				{
					id: 'user',
					index: 1,
					type: 'SELECT',
					schema: {
						name: 'user_to_offboard',
						enumSourceWorkflow: {
							id: 'wf',
							triggerId: 'trg',
							labelKey: 'displayName',
							valueKey: 'id',
							input: { skipCache: '' },
							inputFromFields: { tenant_id: { fieldId: 'tenant', isActive: true, isRequired: false } },
						},
					},
				},
			],
		},
	},
};

const options = (rows: unknown[]) => ({
	data: { runWorkflowForOptions: { cachedOptions: rows, executionId: 'exec-1' } },
});

suite('Unit: formOptionsCapabilities', () => {
	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	teardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	test('exposes one write capability that names its workflow so working scope applies', () => {
		assert.deepStrictEqual(
			FORM_OPTIONS_CAPABILITIES.map(capability => capability.spec.name),
			['buddy_test_form_options'],
		);
		const capability = cap('buddy_test_form_options');
		assert.strictEqual(capability.access, 'write', 'running a generator executes a workflow');
		const schema = capability.spec.inputSchema as { required?: string[] };
		assert.ok(schema.required?.includes('workflowId'), 'workflowId is required for the workflow scope gate');
	});

	test('runs the generator from a form field, reporting keys and counts but not values', async () => {
		let summaryText = '';
		setMcpMutationApprover(async (_scope, summary) => {
			summaryText = summary;
			return true;
		});
		const { ctx, calls } = sequencedCtx([
			formWithGenerator,
			generatorWorkflow,
			options([
				{ displayName: 'Ada Lovelace', id: 'u1' },
				{ displayName: 'Alan Turing', id: 'u2' },
			]),
		]);

		const output = JSON.parse(
			await cap('buddy_test_form_options').run(
				{
					orgId: 'org-1',
					workflowId: 'wf',
					formId: 'form-1',
					fieldName: 'user_to_offboard',
					values: { tenant: 'contoso.example' },
				},
				ctx,
			),
		);

		assert.strictEqual(output.status, 'passed');
		assert.strictEqual(output.executed, true);
		assert.strictEqual(output.optionCount, 2);
		assert.deepStrictEqual(output.observedOptionKeys.sort(), ['displayName', 'id']);
		assert.strictEqual(output.labelKeyCheck.status, 'passed');
		assert.strictEqual(output.valueKeyCheck.status, 'passed');
		assert.deepStrictEqual(output.tested.generatorInputsSent, ['skipCache', 'tenant_id']);
		assert.deepStrictEqual(output.tested.inputsTakenFromFormValues, ['tenant_id <- tenant']);
		assert.strictEqual(output.tested.labelKey, 'displayName');
		assert.match(summaryText, /This executes the workflow/);

		const serialized = JSON.stringify(output);
		assert.ok(!serialized.includes('Ada Lovelace'), 'option labels are never echoed back');
		assert.ok(!serialized.includes('contoso.example'), 'supplied form values are never echoed back');

		const run = calls[2];
		assert.ok(run.query.includes('runWorkflowForOptions'));
		assert.deepStrictEqual(run.variables, {
			input: { skipCache: '', tenant_id: 'contoso.example' },
			inputContext: { tenant: 'contoso.example' },
			orgId: 'org-1',
			skipCache: false,
			triggerId: 'trg',
			workflowId: 'wf',
		});
	});

	test('reports an empty result as inconclusive rather than a pass', async () => {
		setMcpMutationApprover(async () => true);
		const { ctx } = sequencedCtx([generatorWorkflow, options([])]);
		const output = JSON.parse(
			await cap('buddy_test_form_options').run(
				{ orgId: 'org-1', workflowId: 'wf', input: { tenant_id: 'x' } },
				ctx,
			),
		);
		assert.strictEqual(output.status, 'inconclusive');
		assert.strictEqual(output.optionCount, 0);
		assert.strictEqual(output.labelKeyCheck.status, 'inconclusive');
		assert.match(output.labelKeyCheck.message, /could not be determined/);
	});

	test('fails when the produced options do not carry the label or value key', async () => {
		setMcpMutationApprover(async () => true);
		const { ctx } = sequencedCtx([generatorWorkflow, options([{ name: 'Ada', id: 'u1' }])]);
		const output = JSON.parse(
			await cap('buddy_test_form_options').run(
				{ orgId: 'org-1', workflowId: 'wf', input: { tenant_id: 'x' } },
				ctx,
			),
		);
		assert.strictEqual(output.status, 'failed');
		assert.strictEqual(output.labelKeyCheck.status, 'failed');
		assert.match(output.labelKeyCheck.message, /1 of 1 option\(s\) have no "label" key/);
		assert.strictEqual(output.valueKeyCheck.status, 'failed');
	});

	test('fails both key checks when cached options include non-object rows', async () => {
		setMcpMutationApprover(async () => true);
		const { ctx } = sequencedCtx([generatorWorkflow, options([null, 'user', ['label', 'value']])]);
		const output = JSON.parse(
			await cap('buddy_test_form_options').run(
				{ orgId: 'org-1', workflowId: 'wf', input: { tenant_id: 'x' } },
				ctx,
			),
		);
		assert.strictEqual(output.status, 'failed');
		assert.strictEqual(output.labelKeyCheck.status, 'failed');
		assert.strictEqual(output.valueKeyCheck.status, 'failed');
		assert.match(output.labelKeyCheck.message, /3 of 3 returned option\(s\) are not objects/);
	});

	test('reports an asynchronous run as running with the key checks not run', async () => {
		setMcpMutationApprover(async () => true);
		const { ctx } = sequencedCtx([
			generatorWorkflow,
			{ data: { runWorkflowForOptions: { cachedOptions: null, executionId: 'exec-9' } } },
		]);
		const output = JSON.parse(
			await cap('buddy_test_form_options').run(
				{ orgId: 'org-1', workflowId: 'wf', input: { tenant_id: 'x' } },
				ctx,
			),
		);
		assert.strictEqual(output.status, 'running');
		assert.strictEqual(output.executionId, 'exec-9');
		assert.deepStrictEqual(
			output.checksNotRun.map((skipped: { check: string }) => skipped.check),
			['option_label_key_present', 'option_value_key_present'],
		);
	});

	test('surfaces a generator execution failure instead of reporting a pass', async () => {
		setMcpMutationApprover(async () => true);
		const { ctx } = sequencedCtx([generatorWorkflow, { errors: [{ message: 'generator task failed' }] }]);
		await assert.rejects(
			() =>
				cap('buddy_test_form_options').run(
					{ orgId: 'org-1', workflowId: 'wf', input: { tenant_id: 'x' } },
					ctx,
				),
			/GraphQL error:.*generator task failed/,
		);
	});

	test('refuses to run a workflow that is not a valid generator, before approval', async () => {
		setMcpMutationApprover(async () => assert.fail('an invalid generator must not reach approval'));
		const { ctx, calls } = sequencedCtx([
			{ data: { workflow: { id: 'wf', name: 'Nope', orgId: 'org-1', type: 'STANDARD', input: [], output: [] } } },
		]);
		await assert.rejects(
			() => cap('buddy_test_form_options').run({ orgId: 'org-1', workflowId: 'wf' }, ctx),
			/The generator was not run:.*not OPTION_GENERATOR/s,
		);
		assert.ok(calls.every(call => !call.query.includes('runWorkflowForOptions')));
	});

	test('refuses when the named field generates from a different workflow than the one in scope', async () => {
		const { ctx, calls } = sequencedCtx([formWithGenerator]);
		await assert.rejects(
			() =>
				cap('buddy_test_form_options').run(
					{ orgId: 'org-1', workflowId: 'other-wf', formId: 'form-1', fieldName: 'user_to_offboard' },
					ctx,
				),
			/generates its options from workflow wf, but workflowId other-wf was requested/,
		);
		assert.strictEqual(calls.length, 1);
	});

	test('rejects a field that has no workflow-generated options and a form outside the org', async () => {
		const noGenerator = sequencedCtx([
			{ data: { form: { id: 'form-1', orgId: 'org-1', fields: [{ id: 'a', schema: { name: 'a' } }] } } },
		]);
		await assert.rejects(
			() =>
				cap('buddy_test_form_options').run(
					{ orgId: 'org-1', workflowId: 'wf', formId: 'form-1', fieldName: 'a' },
					noGenerator.ctx,
				),
			/does not source its options from a workflow/,
		);

		const foreign = sequencedCtx([{ data: { form: { id: 'form-1', orgId: 'other-org' } } }]);
		await assert.rejects(
			() =>
				cap('buddy_test_form_options').run(
					{ orgId: 'org-1', workflowId: 'wf', formId: 'form-1', fieldName: 'a' },
					foreign.ctx,
				),
			/Form form-1 is not in org org-1/,
		);
	});

	test('never executes on denial and requires formId and fieldName together', async () => {
		setMcpMutationApprover(async () => false);
		const { ctx, calls } = sequencedCtx([generatorWorkflow]);
		const output = JSON.parse(
			await cap('buddy_test_form_options').run(
				{ orgId: 'org-1', workflowId: 'wf', input: { tenant_id: 'x' } },
				ctx,
			),
		);
		assert.strictEqual(output.status, 'approval_required');
		assert.ok(calls.every(call => !call.query.includes('runWorkflowForOptions')));

		const { ctx: partial } = sequencedCtx([]);
		await assert.rejects(
			() => cap('buddy_test_form_options').run({ orgId: 'org-1', workflowId: 'wf', formId: 'form-1' }, partial),
			/Pass formId and fieldName together/,
		);
	});

	test('every call prompts again, so one approval never authorises a second run', async () => {
		let approvals = 0;
		setMcpMutationApprover(async () => {
			approvals++;
			return true;
		});
		for (let attempt = 0; attempt < 2; attempt++) {
			const { ctx } = sequencedCtx([generatorWorkflow, options([{ label: 'a', value: 'b' }])]);
			await cap('buddy_test_form_options').run(
				{ orgId: 'org-1', workflowId: 'wf', input: { tenant_id: 'x' } },
				ctx,
			);
		}
		assert.strictEqual(approvals, 2);
	});
});
