import type { Session } from '@sessions';
import { createCapabilityTestHarness, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { _resetApprovedMutationScopes } from '../ui/chat/tools/graphqlTool';
import { _resetMcpMutationApproverForTesting, setMcpMutationApprover } from './graphqlMutateCapability';
import { TRIGGER_CREATE_CAPABILITIES } from './triggerCreateCapability';

const { suite, test, setup, teardown } = Mocha;
const { cap } = createCapabilityTestHarness(TRIGGER_CREATE_CAPABILITIES);

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

const workflowOwner = { data: { workflow: { id: 'wf', name: 'Offboard user', orgId: 'org-1', type: 'STANDARD' } } };
const formOwner = { data: { forms: [{ id: 'form-1', name: 'Offboarding', orgId: 'org-1' }] } };
const triggerTypes = (types: unknown[]) => ({ data: { triggerTypes: types } });
const formType = { id: 'tt-form', name: 'Form Submission', ref: 'rewst:form_submission', enabled: true };
const webhookType = { id: 'tt-hook', name: 'Webhook', ref: 'rewst:webhook', enabled: true };

function savedTrigger(overrides: Record<string, unknown> = {}) {
	return {
		data: {
			triggers: [
				{
					id: 'trg-1',
					name: 'Submit offboarding',
					enabled: false,
					orgId: 'org-1',
					workflowId: 'wf',
					triggerTypeId: 'tt-form',
					formId: 'form-1',
					parameters: { form_id: 'form-1' },
					criteria: {},
					form: { id: 'form-1', name: 'Offboarding' },
					...overrides,
				},
			],
		},
	};
}

const created = (overrides: Record<string, unknown> = {}) => ({
	data: {
		createTrigger: {
			id: 'trg-1',
			name: 'Submit offboarding',
			enabled: false,
			orgId: 'org-1',
			workflowId: 'wf',
			triggerTypeId: 'tt-form',
			formId: 'form-1',
			...overrides,
		},
	},
});

suite('Unit: triggerCreateCapability', () => {
	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	teardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	test('registers one write capability that names its workflow for the scope gate', () => {
		assert.deepStrictEqual(
			TRIGGER_CREATE_CAPABILITIES.map(capability => capability.spec.name),
			['buddy_create_trigger'],
		);
		const capability = cap('buddy_create_trigger');
		assert.strictEqual(capability.access, 'write');
		assert.strictEqual(capability.spec.args, JSON.stringify(capability.spec.inputSchema));
		const schema = capability.spec.inputSchema as { required?: string[] };
		assert.ok(schema.required?.includes('workflowId'));
	});

	test('creates a disabled form-submission trigger with a consistent formId and parameters.form_id', async () => {
		let summaryText = '';
		setMcpMutationApprover(async (_scope, summary) => {
			summaryText = summary;
			return true;
		});
		const { ctx, calls } = sequencedCtx([
			workflowOwner,
			formOwner,
			triggerTypes([formType, webhookType]),
			created(),
			savedTrigger(),
		]);

		const output = JSON.parse(
			await cap('buddy_create_trigger').run(
				{ orgId: 'org-1', workflowId: 'wf', name: 'Submit offboarding', formId: 'form-1' },
				ctx,
			),
		);

		assert.strictEqual(output.status, 'created');
		assert.strictEqual(output.enabled, false);
		assert.strictEqual(output.triggerTypeRef, 'rewst:form_submission');
		assert.strictEqual(output.verification.status, 'verified');
		assert.match(summaryText, /disabled on creation/);
		assert.deepStrictEqual(calls[3].variables, {
			trigger: {
				orgId: 'org-1',
				workflowId: 'wf',
				name: 'Submit offboarding',
				triggerTypeId: 'tt-form',
				enabled: false,
				criteria: {},
				parameters: { form_id: 'form-1' },
				formId: 'form-1',
			},
		});
		assert.ok(calls[3].query.includes('createPatch: true'));
	});

	test('states enablement in the approval summary when the caller asks for a live trigger', async () => {
		let summaryText = '';
		setMcpMutationApprover(async (_scope, summary) => {
			summaryText = summary;
			return true;
		});
		const { ctx, calls } = sequencedCtx([
			workflowOwner,
			triggerTypes([webhookType]),
			created({ enabled: true, triggerTypeId: 'tt-hook', formId: null }),
			savedTrigger({ enabled: true, triggerTypeId: 'tt-hook', formId: null, form: null, parameters: null }),
		]);
		const output = JSON.parse(
			await cap('buddy_create_trigger').run(
				{ orgId: 'org-1', workflowId: 'wf', name: 'Hook', triggerTypeRef: 'rewst:webhook', enabled: true },
				ctx,
			),
		);
		assert.strictEqual(output.status, 'created');
		assert.match(summaryText, /ENABLED on creation/);
		assert.strictEqual((calls[2].variables?.trigger as { enabled: boolean }).enabled, true);
	});

	test('rejects a form_id parameter that contradicts formId', async () => {
		setMcpMutationApprover(async () => assert.fail('a contradictory form target must not reach approval'));
		const { ctx } = sequencedCtx([workflowOwner, formOwner, triggerTypes([formType])]);
		await assert.rejects(
			() =>
				cap('buddy_create_trigger').run(
					{
						orgId: 'org-1',
						workflowId: 'wf',
						name: 'Submit',
						formId: 'form-1',
						parameters: { form_id: 'form-other' },
					},
					ctx,
				),
			/They address the same form and must match/,
		);
	});

	test('refuses a workflow or form from another org before approval', async () => {
		setMcpMutationApprover(async () => assert.fail('cross-org targets must not reach approval'));
		const foreignWorkflow = sequencedCtx([{ data: { workflow: { id: 'wf', orgId: 'other-org' } } }]);
		await assert.rejects(
			() => cap('buddy_create_trigger').run({ orgId: 'org-1', workflowId: 'wf', name: 'x' }, foreignWorkflow.ctx),
			/Workflow wf is not in org org-1/,
		);

		const foreignForm = sequencedCtx([workflowOwner, { data: { forms: [] } }]);
		await assert.rejects(
			() =>
				cap('buddy_create_trigger').run(
					{ orgId: 'org-1', workflowId: 'wf', name: 'x', formId: 'form-1' },
					foreignForm.ctx,
				),
			/Form form-1 is not in org org-1/,
		);
	});

	test('resolves the trigger type against the live catalogue rather than trusting the caller', async () => {
		setMcpMutationApprover(async () => assert.fail('an unresolved trigger type must not reach approval'));
		const unknownId = sequencedCtx([workflowOwner, triggerTypes([formType])]);
		await assert.rejects(
			() =>
				cap('buddy_create_trigger').run(
					{ orgId: 'org-1', workflowId: 'wf', name: 'x', triggerTypeId: 'made-up' },
					unknownId.ctx,
				),
			/Trigger type made-up does not exist/,
		);

		const unknownRef = sequencedCtx([workflowOwner, triggerTypes([formType])]);
		await assert.rejects(
			() =>
				cap('buddy_create_trigger').run(
					{ orgId: 'org-1', workflowId: 'wf', name: 'x', triggerTypeRef: 'rewst:nope' },
					unknownRef.ctx,
				),
			/No trigger type has ref "rewst:nope"/,
		);

		const noHint = sequencedCtx([workflowOwner, triggerTypes([formType, webhookType])]);
		await assert.rejects(
			() => cap('buddy_create_trigger').run({ orgId: 'org-1', workflowId: 'wf', name: 'x' }, noHint.ctx),
			/Pass triggerTypeId or triggerTypeRef/,
		);
	});

	test('only infers the form trigger type when exactly one candidate exists', async () => {
		setMcpMutationApprover(async () => assert.fail('an ambiguous trigger type must not reach approval'));
		const ambiguous = sequencedCtx([
			workflowOwner,
			formOwner,
			triggerTypes([formType, { id: 'tt-form2', name: 'Form Page Submit', ref: 'rewst:form_page' }]),
		]);
		await assert.rejects(
			() =>
				cap('buddy_create_trigger').run(
					{ orgId: 'org-1', workflowId: 'wf', name: 'x', formId: 'form-1' },
					ambiguous.ctx,
				),
			/More than one trigger type could fire a form submission/,
		);
	});

	for (const [field, value] of [
		['triggerTypeId', 'tt-hook'],
		['triggerTypeRef', 'rewst:webhook'],
	] as const) {
		test(`rejects an explicit non-form ${field} when formId is supplied`, async () => {
			setMcpMutationApprover(async () =>
				assert.fail('an incompatible form trigger type must not reach approval'),
			);
			const { ctx, calls } = sequencedCtx([workflowOwner, formOwner, triggerTypes([formType, webhookType])]);
			await assert.rejects(
				() =>
					cap('buddy_create_trigger').run(
						{
							orgId: 'org-1',
							workflowId: 'wf',
							name: 'Submit',
							formId: 'form-1',
							[field]: value,
						},
						ctx,
					),
				/form submission trigger type/,
			);
			assert.ok(calls.every(call => !call.query.startsWith('mutation')));
		});
	}

	test('reports a saved trigger whose form association did not persist, without implying a rollback', async () => {
		setMcpMutationApprover(async () => true);
		const { ctx } = sequencedCtx([
			workflowOwner,
			formOwner,
			triggerTypes([formType]),
			created(),
			savedTrigger({ formId: null, form: null, parameters: {} }),
		]);
		const output = JSON.parse(
			await cap('buddy_create_trigger').run(
				{ orgId: 'org-1', workflowId: 'wf', name: 'Submit offboarding', formId: 'form-1' },
				ctx,
			),
		);
		assert.strictEqual(output.status, 'created_unverified');
		assert.strictEqual(output.verification.status, 'mismatch');
		assert.strictEqual(output.id, 'trg-1');
		assert.match(output.verification.message, /not rolled back/);
		assert.ok(output.verification.differences.some((line: string) => line.startsWith('formId:')));
		assert.ok(output.verification.differences.some((line: string) => line.startsWith('form association:')));
		assert.ok(output.verification.differences.some((line: string) => line.startsWith('parameters.form_id:')));
	});

	test('reports an unreadable trigger as unverified rather than failed', async () => {
		setMcpMutationApprover(async () => true);
		const { ctx } = sequencedCtx([
			workflowOwner,
			triggerTypes([webhookType]),
			created({ triggerTypeId: 'tt-hook', formId: null }),
			{ errors: [{ message: 'read failed' }] },
		]);
		const output = JSON.parse(
			await cap('buddy_create_trigger').run(
				{ orgId: 'org-1', workflowId: 'wf', name: 'Hook', triggerTypeRef: 'rewst:webhook' },
				ctx,
			),
		);
		assert.strictEqual(output.status, 'created_unverified');
		assert.strictEqual(output.verification.status, 'unverified');
		assert.match(output.verification.message, /read failed/);
	});

	test('always prompts and never writes on denial', async () => {
		let approvals = 0;
		setMcpMutationApprover(async () => {
			approvals++;
			return false;
		});
		const { ctx, calls } = sequencedCtx([workflowOwner, triggerTypes([webhookType])]);
		const output = JSON.parse(
			await cap('buddy_create_trigger').run(
				{ orgId: 'org-1', workflowId: 'wf', name: 'Hook', triggerTypeRef: 'rewst:webhook' },
				ctx,
			),
		);
		assert.strictEqual(output.status, 'approval_required');
		assert.strictEqual(approvals, 1);
		assert.ok(calls.every(call => !call.query.startsWith('mutation')));
	});
});
