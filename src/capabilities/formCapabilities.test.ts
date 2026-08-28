import type { Session } from '@sessions';
import { createCapabilityTestHarness, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { _resetApprovedMutationScopes } from '../ui/chat/tools/graphqlTool';
import { _resetMcpMutationApproverForTesting, setMcpMutationApprover } from './graphqlMutateCapability';
import { FORM_CAPABILITIES } from './formCapabilities';

const { suite, test, setup, teardown } = Mocha;
const { fakeCtx, cap } = createCapabilityTestHarness(FORM_CAPABILITIES);

function sequencedCtx(responses: unknown[]) {
	const calls: { query: string; variables?: Record<string, unknown> }[] = [];
	let index = 0;
	const session = {
		rawGraphql: async (query: string, variables?: Record<string, unknown>) => {
			calls.push({ query, variables });
			if (index >= responses.length) {
				throw new Error(`Unexpected extra GraphQL call ${index + 1}: ${query}`);
			}
			return responses[index++] as { data?: unknown; errors?: unknown };
		},
		profile: {
			org: { id: 'org-1', name: 'Sandbox' },
			allManagedOrgs: [{ id: 'org-1', name: 'Sandbox' }],
		},
	} as unknown as Session;
	return { calls, ctx: { session, orgId: 'org-1', sessions: [session] } };
}

/** Deterministic, valid UUIDs so fixtures read like real Rewst field ids. */
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A `form` read-back response carrying exactly the fields a write intended. */
function savedForm(fields: unknown[] = [], extra: Record<string, unknown> = {}) {
	return { data: { form: { id: 'form-1', name: 'Client intake', orgId: 'org-1', fields, ...extra } } };
}

/** A generator workflow the live checks accept. */
const generatorWorkflow = {
	data: {
		workflow: {
			id: 'generator',
			name: 'Get users',
			orgId: 'org-1',
			type: 'OPTION_GENERATOR',
			input: ['skipCache', 'tenant_id'],
			output: [{ options: '{{ CTX.users }}' }],
			visibleForOrganizations: [],
			triggers: [
				{ id: 'generator-trigger', name: 'Options', enabled: true, orgId: 'org-1', workflowId: 'generator' },
			],
		},
	},
};

suite('Unit: formCapabilities', () => {
	setup(() => {
		initTestEnvironment();
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	teardown(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
	});

	test('registers dedicated get/validate/create/update/add-field/delete form tools with derived schemas', () => {
		assert.deepStrictEqual(
			FORM_CAPABILITIES.map(capability => capability.spec.name),
			[
				'buddy_get_form',
				'buddy_validate_form',
				'buddy_create_form',
				'buddy_update_form',
				'buddy_add_form_field',
				'buddy_delete_form',
				'buddy_set_form_tags',
			],
		);
		for (const capability of FORM_CAPABILITIES) {
			assert.strictEqual(capability.spec.args, JSON.stringify(capability.spec.inputSchema));
		}
		assert.strictEqual(cap('buddy_get_form').access, 'read');
		assert.strictEqual(cap('buddy_validate_form').access, 'read');
		assert.strictEqual(cap('buddy_create_form').access, 'write');
		assert.strictEqual(cap('buddy_update_form').access, 'write');
		assert.strictEqual(cap('buddy_add_form_field').access, 'write');
		assert.strictEqual(cap('buddy_delete_form').access, 'write');
		assert.strictEqual(cap('buddy_set_form_tags').access, 'write');
	});

	test('buddy_get_form returns metadata, fields, conditions, tags, and triggers', async () => {
		const { ctx, calls } = fakeCtx({
			data: {
				form: {
					id: 'form-1',
					name: 'Client intake',
					description: 'Collect client details',
					orgId: 'org-1',
					isSynchronized: false,
					tags: [{ id: 'tag-1', name: 'Intake', color: '#123456' }],
					triggers: [{ id: 'trigger-1', name: 'Submit', enabled: true, workflowId: 'wf-1' }],
					fields: [
						{
							id: 'field-1',
							index: 0,
							type: 'TEXT_INPUT',
							schema: { name: 'company' },
							conditions: [{ action: 'required', fieldId: 'field-1', sourceFieldId: null }],
						},
					],
				},
			},
		});

		const output = JSON.parse(await cap('buddy_get_form').run({ orgId: 'org-1', formId: 'form-1' }, ctx));

		assert.ok(calls[0].query.includes('form('));
		assert.deepStrictEqual(calls[0].variables, { orgId: 'org-1', formId: 'form-1' });
		assert.strictEqual(output.name, 'Client intake');
		assert.strictEqual(output.fields[0].type, 'TEXT_INPUT');
		assert.strictEqual(output.fields[0].conditions[0].action, 'required');
		assert.strictEqual(output.tags[0].id, 'tag-1');
		assert.strictEqual(output.triggers[0].workflowId, 'wf-1');
	});

	test('buddy_get_form fails closed when the form is not in the requested org', async () => {
		const { ctx } = fakeCtx({ data: { form: null } });
		await assert.rejects(
			() => cap('buddy_get_form').run({ orgId: 'org-1', formId: 'form-other' }, ctx),
			/Form form-other is not in org org-1/,
		);
	});

	test('buddy_create_form sends form fields only after approval', async () => {
		setMcpMutationApprover(async (scope, summary) => {
			assert.strictEqual(scope.orgId, 'org-1');
			assert.match(summary, /Create form "Client intake"/);
			return true;
		});
		const fields = [{ index: 0, type: 'TEXT_INPUT', schema: { name: 'company', label: 'Company' } }];
		const { ctx, calls } = sequencedCtx([
			{
				data: { createForm: { id: 'form-1', name: 'Client intake', orgId: 'org-1', description: 'Details' } },
			},
			savedForm(fields),
		]);

		const output = JSON.parse(
			await cap('buddy_create_form').run(
				{ orgId: 'org-1', name: ' Client intake ', description: 'Details', fields },
				ctx,
			),
		);

		assert.strictEqual(output.status, 'created');
		assert.strictEqual(output.verification.status, 'verified');
		assert.ok(calls[0].query.includes('createForm'));
		assert.deepStrictEqual(calls[0].variables, {
			form: { orgId: 'org-1', name: 'Client intake', description: 'Details', fields },
		});
		assert.ok(calls[1].query.includes('form('), 'the saved form is read back after the write');
	});

	test('buddy_create_form rejects unsupported field types before approval or GraphQL', async () => {
		let approved = false;
		setMcpMutationApprover(async () => {
			approved = true;
			return true;
		});
		const { ctx, calls } = sequencedCtx([{ data: {} }]);

		await assert.rejects(
			() =>
				cap('buddy_create_form').run(
					{ orgId: 'org-1', name: 'Bad form', fields: [{ type: 'NOT_A_FORM_FIELD' }] },
					ctx,
				),
			/Form field type/,
		);
		assert.strictEqual(approved, false);
		assert.strictEqual(calls.length, 0);
	});

	for (const tool of ['buddy_create_form', 'buddy_update_form']) {
		test(`${tool} rejects descriptions beyond the live database limit before any request`, async () => {
			setMcpMutationApprover(async () => assert.fail('invalid input must not prompt'));
			const { ctx, calls } = fakeCtx({ data: {} });
			await assert.rejects(
				() =>
					cap(tool).run(
						{ orgId: 'org-1', formId: 'form-1', name: 'Offboarding', description: 'x'.repeat(256) },
						ctx,
					),
				/255/,
			);
			assert.strictEqual(calls.length, 0);
		});
	}

	test('preserves option generator inputs and cross-field mappings on create and update', async () => {
		setMcpMutationApprover(async () => true);
		const fields = [
			{
				id: uuid(1),
				index: 0,
				type: 'CHECKBOX',
				schema: { name: 'refresh_options', type: 'boolean', default: false },
			},
			{
				id: uuid(2),
				index: 1,
				type: 'SELECT',
				schema: {
					name: 'user_to_offboard',
					type: 'string',
					required: true,
					enumSourceWorkflow: {
						id: 'generator',
						triggerId: 'generator-trigger',
						labelKey: 'label',
						valueKey: 'id',
						input: { skipCache: '{{ false }}', tenant_id: '' },
						inputFromFields: { skipCache: { fieldId: uuid(1), isActive: true, isRequired: false } },
					},
				},
				conditions: [],
			},
		];
		for (const tool of ['buddy_create_form', 'buddy_update_form']) {
			const mutation = tool === 'buddy_create_form' ? 'createForm' : 'updateForm';
			const { ctx, calls } = sequencedCtx([
				...(mutation === 'updateForm' ? [{ data: { forms: [{ id: 'form-1', orgId: 'org-1' }] } }] : []),
				generatorWorkflow,
				{ data: { [mutation]: { id: 'form-1', orgId: 'org-1' } } },
				savedForm(fields),
			]);
			await cap(tool).run(
				{ orgId: 'org-1', formId: 'form-1', name: 'Offboarding', description: 'x'.repeat(255), fields },
				ctx,
			);
			const sent = calls[calls.length - 2]?.variables?.form as { fields: unknown; description: string };
			assert.deepStrictEqual(sent.fields, fields);
			assert.strictEqual(sent.description.length, 255);
		}
	});

	test('buddy_create_form returns approval_required without sending GraphQL', async () => {
		setMcpMutationApprover(async () => false);
		const { ctx, calls } = sequencedCtx([{ data: {} }]);

		const output = JSON.parse(await cap('buddy_create_form').run({ orgId: 'org-1', name: 'Nope' }, ctx));

		assert.strictEqual(output.status, 'approval_required');
		assert.strictEqual(calls.length, 0);
	});

	test('buddy_update_form verifies ownership, preserves omitted fields, and accepts an empty description', async () => {
		setMcpMutationApprover(async () => true);
		const { ctx, calls } = sequencedCtx([
			{ data: { forms: [{ id: 'form-1', name: 'Old name', orgId: 'org-1' }] } },
			{ data: { updateForm: { id: 'form-1', name: 'New name', description: '', orgId: 'org-1' } } },
			savedForm(),
		]);

		const output = JSON.parse(
			await cap('buddy_update_form').run(
				{ orgId: 'org-1', formId: 'form-1', name: 'New name', description: '' },
				ctx,
			),
		);

		assert.strictEqual(output.status, 'updated');
		assert.strictEqual(output.verification.status, 'verified');
		assert.ok(calls[0].query.includes('forms('));
		assert.ok(calls[1].query.includes('updateForm'));
		assert.deepStrictEqual(calls[1].variables, {
			form: { id: 'form-1', orgId: 'org-1', name: 'New name', description: '' },
		});
	});

	test('buddy_update_form requires at least one changed field before GraphQL', async () => {
		const { ctx, calls } = fakeCtx({ data: {} });
		await assert.rejects(
			() => cap('buddy_update_form').run({ orgId: 'org-1', formId: 'form-1' }, ctx),
			/at least one of name, description, isSynchronized, or fields/,
		);
		assert.strictEqual(calls.length, 0);
	});

	test('buddy_update_form refuses a form outside the requested org before approval', async () => {
		let approved = false;
		setMcpMutationApprover(async () => {
			approved = true;
			return true;
		});
		const { ctx, calls } = sequencedCtx([{ data: { forms: [] } }]);

		await assert.rejects(
			() => cap('buddy_update_form').run({ orgId: 'org-1', formId: 'form-2', name: 'Nope' }, ctx),
			/Form form-2 is not in org org-1/,
		);
		assert.strictEqual(approved, false);
		assert.strictEqual(calls.length, 1);
	});

	test('buddy_delete_form always prompts, verifies ownership, and deletes the form', async () => {
		let approvals = 0;
		setMcpMutationApprover(async (_scope, summary) => {
			approvals++;
			assert.match(summary, /Delete form "Client intake"/);
			return true;
		});
		const run = () =>
			sequencedCtx([
				{ data: { forms: [{ id: 'form-1', name: 'Client intake', orgId: 'org-1' }] } },
				{ data: { deleteForm: null } },
			]);

		let harness = run();
		const first = JSON.parse(await cap('buddy_delete_form').run({ orgId: 'org-1', formId: 'form-1' }, harness.ctx));
		assert.strictEqual(first.status, 'deleted');
		assert.strictEqual(first.id, 'form-1', 'Void deletion returns the verified input id');
		assert.ok(harness.calls[1].query.includes('deleteForm'));

		harness = run();
		await cap('buddy_delete_form').run({ orgId: 'org-1', formId: 'form-1' }, harness.ctx);
		assert.strictEqual(approvals, 2, 'delete approval is never reused');
	});

	test('rejects a returned form from another org even when the list resolver ignores its filter', async () => {
		const { ctx, calls } = fakeCtx({ data: { forms: [{ id: 'form-1', orgId: 'other-org' }] } });
		setMcpMutationApprover(async () => assert.fail('must reject before approval'));
		await assert.rejects(
			() => cap('buddy_delete_form').run({ orgId: 'org-1', formId: 'form-1' }, ctx),
			/not in org/,
		);
		assert.strictEqual(calls.length, 1);
	});

	test('delete rejects a malformed response instead of treating absent data as Void success', async () => {
		setMcpMutationApprover(async () => true);
		const { ctx } = sequencedCtx([{ data: { forms: [{ id: 'form-1', orgId: 'org-1' }] } }, { data: {} }]);
		await assert.rejects(
			() => cap('buddy_delete_form').run({ orgId: 'org-1', formId: 'form-1' }, ctx),
			/deleteForm/,
		);
	});

	test('round-trips nullable field condition properties without silently dropping them', async () => {
		setMcpMutationApprover(async () => true);
		const { ctx, calls } = sequencedCtx([
			{ data: { forms: [{ id: 'form-1', orgId: 'org-1' }] } },
			{ data: { updateForm: { id: 'form-1', orgId: 'org-1' } } },
			savedForm([{ id: uuid(1), index: 0, type: 'TEXT_INPUT', schema: { name: 'company', required: true } }]),
		]);
		const fields = [
			{
				id: uuid(1),
				index: 0,
				type: 'TEXT_INPUT',
				schema: { name: 'company', required: true },
				conditions: [
					{
						action: 'required',
						actionValue: null,
						conditionType: null,
						index: null,
						requiredValue: null,
						sourceFieldId: null,
					},
				],
			},
		];
		await cap('buddy_update_form').run({ orgId: 'org-1', formId: 'form-1', fields }, ctx);
		assert.deepStrictEqual((calls[1].variables?.form as { fields: unknown }).fields, fields);
	});

	test('field replacement always requests fresh approval, even after a metadata update', async () => {
		let approvals = 0;
		const summaries: string[] = [];
		setMcpMutationApprover(async (_scope, summary) => {
			approvals++;
			summaries.push(summary);
			return true;
		});
		for (const change of [{ name: 'Renamed' }, { fields: [] }]) {
			const { ctx } = sequencedCtx([
				{ data: { forms: [{ id: 'form-1', orgId: 'org-1' }] } },
				{ data: { updateForm: { id: 'form-1', orgId: 'org-1' } } },
				savedForm(),
			]);
			await cap('buddy_update_form').run({ orgId: 'org-1', formId: 'form-1', ...change }, ctx);
		}
		assert.strictEqual(approvals, 2);
		assert.match(summaries[1], /replace fields with 0 definitions/);
	});

	test('sequenced contexts identify an unexpected extra GraphQL call', async () => {
		const { ctx } = sequencedCtx([]);
		await assert.rejects(
			() => (ctx.session as Session).rawGraphql('query UnexpectedExtraCall { forms { id } }'),
			/Unexpected extra GraphQL call 1: query UnexpectedExtraCall/,
		);
	});

	test('get returns fields in index order and verifies the returned id', async () => {
		const { ctx } = fakeCtx({
			data: {
				form: { id: 'form-1', orgId: 'org-1', fields: [{ id: 'b', index: 1 }, null, { id: 'a', index: 0 }] },
			},
		});
		const result = JSON.parse(await cap('buddy_get_form').run({ orgId: 'org-1', formId: 'form-1' }, ctx));
		assert.deepStrictEqual(
			result.fields.map((f: { id: string }) => f.id),
			['a', 'b'],
		);
		const wrong = fakeCtx({ data: { form: { id: 'different', orgId: 'org-1' } } });
		await assert.rejects(() => cap('buddy_get_form').run({ orgId: 'org-1', formId: 'form-1' }, wrong.ctx), /Form/);
	});

	test('rejects invalid optional write input instead of silently discarding it', async () => {
		for (const change of [
			{ name: 42 },
			{ fields: [{ id: 42 }] },
			{ fields: [{ conditions: [{ action: 'hide', sourceFieldId: 42 }] }] },
		]) {
			const { ctx, calls } = fakeCtx({ data: {} });
			await assert.rejects(() =>
				cap('buddy_update_form').run(
					{ orgId: 'org-1', formId: 'form-1', description: 'valid', ...change },
					ctx,
				),
			);
			assert.strictEqual(calls.length, 0);
		}
	});

	test('GraphQL errors include the serialized server response', async () => {
		const { ctx } = fakeCtx({ errors: [{ message: 'form resolver failed' }] });
		await assert.rejects(
			() => cap('buddy_get_form').run({ orgId: 'org-1', formId: 'form-1' }, ctx),
			/GraphQL error:.*form resolver failed/,
		);
	});

	for (const [operation, requested, expected] of [
		['add', ['tag-b', 'tag-b'], ['tag-a', 'tag-b']],
		['remove', ['tag-a'], []],
		['replace', [], []],
	] as const) {
		test(`form tags ${operation} preserves the intended set and verifies ownership`, async () => {
			setMcpMutationApprover(async () => true);
			const { ctx, calls } = sequencedCtx([
				{ data: { form: { id: 'form-1', orgId: 'org-1', tags: [] } } },
				{ data: { form: { id: 'form-1', orgId: 'org-1', tags: [{ id: 'tag-a' }] } } },
				...(requested.length
					? [{ data: { tags: [...new Set(requested)].map(id => ({ id, orgId: 'org-1' })) } }]
					: []),
				{ data: { setFormTags: { id: 'form-1', orgId: 'org-1', tags: expected.map(id => ({ id })) } } },
			]);
			const result = JSON.parse(
				await cap('buddy_set_form_tags').run(
					{ orgId: 'org-1', formId: 'form-1', operation, tagIds: [...requested] },
					ctx,
				),
			);
			assert.deepStrictEqual(calls[calls.length - 1]?.variables, {
				form: { id: 'form-1', tagIds: [...expected] },
			});
			assert.deepStrictEqual(result.tagIds, { before: ['tag-a'], after: [...expected] });
		});
	}

	test('form tags refuse unknown or foreign tags without mutation', async () => {
		setMcpMutationApprover(async () => true);
		const { ctx, calls } = sequencedCtx([
			{ data: { form: { id: 'form-1', orgId: 'org-1', tags: [] } } },
			{ data: { form: { id: 'form-1', orgId: 'org-1', tags: [] } } },
			{ data: { tags: [{ id: 'tag-b', orgId: 'other-org' }] } },
		]);
		await assert.rejects(
			() =>
				cap('buddy_set_form_tags').run(
					{ orgId: 'org-1', formId: 'form-1', operation: 'add', tagIds: ['tag-b'] },
					ctx,
				),
			/not in org/,
		);
		assert.ok(calls.every(call => !call.query.startsWith('mutation')));
	});

	// -----------------------------------------------------------------------
	// Typed fields, semantic validation, verification and incremental add
	// -----------------------------------------------------------------------

	const typedDynamicField = {
		name: 'user_to_offboard',
		type: 'SELECT',
		label: 'User',
		required: true,
		dynamicOptions: {
			workflowId: 'generator',
			triggerId: 'generator-trigger',
			inputFromFields: { skipCache: 'refresh_options' },
		},
	};

	test('buddy_create_form compiles typedFields into canonical Rewst field JSON', async () => {
		setMcpMutationApprover(async () => true);
		const { ctx, calls } = sequencedCtx([
			generatorWorkflow,
			{ data: { createForm: { id: 'form-1', name: 'Offboarding', orgId: 'org-1' } } },
			savedForm([
				{ id: uuid(1), index: 0, type: 'CHECKBOX', schema: { name: 'refresh_options' } },
				{
					id: uuid(2),
					index: 1,
					type: 'SELECT',
					schema: {
						name: 'user_to_offboard',
						enumSourceWorkflow: { id: 'generator', triggerId: 'generator-trigger' },
					},
				},
			]),
		]);

		const output = JSON.parse(
			await cap('buddy_create_form').run(
				{
					orgId: 'org-1',
					name: 'Offboarding',
					typedFields: [{ name: 'refresh_options', type: 'CHECKBOX' }, typedDynamicField],
				},
				ctx,
			),
		);

		assert.strictEqual(output.status, 'created');
		const sent = calls[1].variables?.form as { fields: Record<string, unknown>[] };
		// The referenced checkbox is minted a real UUID (Rewst's field id column is
		// uuid-typed); the dropdown itself is unreferenced, so Rewst assigns its id.
		const checkboxId = sent.fields[0].id as string;
		assert.match(checkboxId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		assert.deepStrictEqual(sent.fields[0], {
			index: 0,
			type: 'CHECKBOX',
			id: checkboxId,
			schema: { name: 'refresh_options', type: 'boolean' },
		});
		assert.strictEqual(sent.fields[1].id, undefined);
		assert.deepStrictEqual((sent.fields[1].schema as Record<string, unknown>).enumSourceWorkflow, {
			id: 'generator',
			triggerId: 'generator-trigger',
			labelKey: 'label',
			valueKey: 'value',
			input: { skipCache: '' },
			inputFromFields: { skipCache: { fieldId: checkboxId, isActive: true, isRequired: false } },
		});
	});

	test('a broken generator reference is rejected before approval or any mutation', async () => {
		setMcpMutationApprover(async () => assert.fail('a form that cannot work must not reach approval'));
		const { ctx, calls } = sequencedCtx([
			{ data: { workflow: { id: 'generator', orgId: 'org-1', type: 'STANDARD', input: [], output: [] } } },
		]);
		await assert.rejects(
			() =>
				cap('buddy_create_form').run(
					{
						orgId: 'org-1',
						name: 'Offboarding',
						typedFields: [{ name: 'refresh_options', type: 'CHECKBOX' }, typedDynamicField],
					},
					ctx,
				),
			/not OPTION_GENERATOR/,
		);
		assert.ok(calls.every(call => !call.query.startsWith('mutation')));
	});

	test('obsolete dynamic-options properties are named with their replacement, before validation', async () => {
		const { ctx, calls } = fakeCtx({ data: {} });
		await assert.rejects(
			() =>
				cap('buddy_create_form').run(
					{
						orgId: 'org-1',
						name: 'Offboarding',
						typedFields: [
							{ name: 'user', type: 'SELECT', dynamicOptions: { workflowId: 'g', labelField: 'name' } },
						],
					},
					ctx,
				),
			/labelField.*use "labelKey" instead/,
		);
		assert.strictEqual(calls.length, 0);
	});

	test('fields and typedFields cannot be combined', async () => {
		const { ctx } = fakeCtx({ data: {} });
		await assert.rejects(
			() =>
				cap('buddy_create_form').run(
					{ orgId: 'org-1', name: 'x', fields: [], typedFields: [{ name: 'a', type: 'TEXT_INPUT' }] },
					ctx,
				),
			/not both/,
		);
	});

	test('a create whose read-back differs reports the difference without implying a rollback', async () => {
		setMcpMutationApprover(async () => true);
		const fields = [{ index: 0, type: 'TEXT_INPUT', schema: { name: 'company' } }];
		const { ctx } = sequencedCtx([
			{ data: { createForm: { id: 'form-1', orgId: 'org-1' } } },
			savedForm([{ index: 0, type: 'TEXT_INPUT', schema: { name: 'different' } }]),
		]);
		const output = JSON.parse(await cap('buddy_create_form').run({ orgId: 'org-1', name: 'x', fields }, ctx));
		assert.strictEqual(output.status, 'created_unverified');
		assert.strictEqual(output.verification.status, 'mismatch');
		assert.strictEqual(output.id, 'form-1', 'the saved id is always returned');
		assert.match(output.verification.message, /not rolled back/);
		assert.match(output.verification.differences[0], /different/);
	});

	test('a failed read-back is reported as unverified, never as a failed write', async () => {
		setMcpMutationApprover(async () => true);
		const { ctx } = sequencedCtx([
			{ data: { createForm: { id: 'form-1', orgId: 'org-1' } } },
			{ errors: [{ message: 'read timed out' }] },
		]);
		const output = JSON.parse(await cap('buddy_create_form').run({ orgId: 'org-1', name: 'x', fields: [] }, ctx));
		assert.strictEqual(output.status, 'created_unverified');
		assert.strictEqual(output.verification.status, 'unverified');
		assert.strictEqual(output.id, 'form-1');
		assert.match(output.verification.message, /read timed out/);
		assert.match(output.verification.message, /rather than creating it again/);
	});

	test('buddy_validate_form reports errors, warnings, passed checks and checks not run without writing', async () => {
		setMcpMutationApprover(async () => assert.fail('validation never writes'));
		const { ctx, calls } = sequencedCtx([
			{
				data: {
					workflow: { id: 'generator', name: 'Gen', orgId: 'org-1', type: 'STANDARD', input: [], output: [] },
				},
			},
		]);
		const output = JSON.parse(
			await cap('buddy_validate_form').run(
				{
					orgId: 'org-1',
					typedFields: [{ name: 'refresh_options', type: 'CHECKBOX' }, typedDynamicField],
				},
				ctx,
			),
		);
		assert.strictEqual(output.executed, false);
		assert.strictEqual(output.validation.ok, false);
		assert.ok(
			output.validation.errors.some((error: { code: string }) => error.code === 'generator_workflow_wrong_type'),
		);
		assert.ok(output.validation.passedChecks.includes('field_names_valid_and_unique'));
		assert.ok(output.compiledFields.length === 2);
		assert.ok(calls.every(call => !call.query.startsWith('mutation')));
	});

	test('buddy_validate_form checks a stored form and takes exactly one source', async () => {
		const { ctx } = sequencedCtx([
			savedForm([{ id: uuid(1), index: 0, type: 'TEXT_INPUT', schema: { name: 'a' } }]),
		]);
		const output = JSON.parse(await cap('buddy_validate_form').run({ orgId: 'org-1', formId: 'form-1' }, ctx));
		assert.strictEqual(output.source, 'stored form form-1');
		assert.strictEqual(output.validation.ok, true);
		assert.ok(
			output.validation.checksNotRun.some(
				(skipped: { check: string }) => skipped.check === 'generator_workflow_exists',
			),
			'live generator checks are reported as not run when nothing references a workflow',
		);

		const { ctx: bad } = fakeCtx({ data: {} });
		await assert.rejects(
			() => cap('buddy_validate_form').run({ orgId: 'org-1', formId: 'form-1', fields: [] }, bad),
			/exactly one of formId, fields, or typedFields/,
		);
	});

	test("buddy_get_form interprets each field's option source without running a generator", async () => {
		const { ctx, calls } = sequencedCtx([
			savedForm([
				{
					id: uuid(1),
					index: 0,
					type: 'SELECT',
					schema: { name: 'user', enumSourceWorkflow: { id: 'generator', triggerId: 'generator-trigger' } },
				},
			]),
			generatorWorkflow,
		]);
		const output = JSON.parse(await cap('buddy_get_form').run({ orgId: 'org-1', formId: 'form-1' }, ctx));
		assert.deepStrictEqual(output.fields[0].schema.enumSourceWorkflow.id, 'generator', 'raw fields are unchanged');
		assert.strictEqual(output.interpreted.fields[0].optionSource, 'workflow');
		assert.strictEqual(output.interpreted.fields[0].generator.workflowName, 'Get users');
		assert.strictEqual(output.interpreted.fields[0].generator.resolvedTriggerId, 'generator-trigger');
		assert.ok(calls.every(call => !call.query.includes('runWorkflowForOptions')));

		const plain = sequencedCtx([savedForm([])]);
		const raw = JSON.parse(
			await cap('buddy_get_form').run({ orgId: 'org-1', formId: 'form-1', interpret: false }, plain.ctx),
		);
		assert.strictEqual(raw.interpreted, undefined);
		assert.strictEqual(plain.calls.length, 1);
	});

	test('buddy_add_form_field appends one field and writes existing fields back unchanged', async () => {
		let summaryText = '';
		setMcpMutationApprover(async (_scope, summary) => {
			summaryText = summary;
			return true;
		});
		const existing = [
			{
				id: uuid(1),
				formId: 'form-1',
				index: 0,
				type: 'CHECKBOX',
				schema: { name: 'refresh_options', type: 'boolean' },
				createdAt: '2026-01-01',
				conditions: [
					{ action: 'show', fieldId: uuid(1), sourceFieldId: null, index: 0, conditionType: 'default' },
				],
			},
		];
		const added = {
			id: uuid(2),
			index: 1,
			type: 'SELECT',
			schema: {
				name: 'user_to_offboard',
				enumSourceWorkflow: { id: 'generator', triggerId: 'generator-trigger' },
			},
		};
		const { ctx, calls } = sequencedCtx([
			savedForm(existing),
			generatorWorkflow,
			{ data: { updateForm: { id: 'form-1', orgId: 'org-1' } } },
			savedForm([existing[0], added]),
		]);

		const output = JSON.parse(
			await cap('buddy_add_form_field').run({ orgId: 'org-1', formId: 'form-1', field: typedDynamicField }, ctx),
		);

		assert.strictEqual(output.status, 'field_added');
		assert.deepStrictEqual(output.fieldCount, { before: 1, after: 2 });
		assert.match(summaryText, /1 existing field\(s\) are written back unchanged/);
		const sent = (calls[2].variables?.form as { fields: Record<string, unknown>[] }).fields;
		assert.strictEqual(sent.length, 2);
		assert.deepStrictEqual(sent[0], {
			index: 0,
			id: uuid(1),
			formId: 'form-1',
			type: 'CHECKBOX',
			schema: { name: 'refresh_options', type: 'boolean' },
			conditions: [{ action: 'show', fieldId: uuid(1), sourceFieldId: null, index: 0, conditionType: 'default' }],
		});
		assert.ok(!('createdAt' in sent[0]), 'server-only properties are not sent back');
		assert.deepStrictEqual((sent[1].schema as Record<string, unknown>).enumSourceWorkflow, {
			id: 'generator',
			triggerId: 'generator-trigger',
			labelKey: 'label',
			valueKey: 'value',
			input: { skipCache: '' },
			inputFromFields: { skipCache: { fieldId: uuid(1), isActive: true, isRequired: false } },
		});
	});

	test('buddy_add_form_field inserts at an explicit index and refuses a duplicate name', async () => {
		setMcpMutationApprover(async () => true);
		const existing = [
			{ id: uuid(1), index: 0, type: 'TEXT_INPUT', schema: { name: 'a' } },
			{ id: uuid(2), index: 1, type: 'TEXT_INPUT', schema: { name: 'b' } },
		];
		const { ctx, calls } = sequencedCtx([
			savedForm(existing),
			{ data: { updateForm: { id: 'form-1', orgId: 'org-1' } } },
			savedForm([existing[0], { id: uuid(3), index: 1, type: 'TEXT_INPUT', schema: { name: 'c' } }, existing[1]]),
		]);
		const output = JSON.parse(
			await cap('buddy_add_form_field').run(
				{ orgId: 'org-1', formId: 'form-1', field: { name: 'c', type: 'TEXT_INPUT' }, index: 1 },
				ctx,
			),
		);
		assert.strictEqual(output.status, 'field_added');
		assert.deepStrictEqual(
			(calls[1].variables?.form as { fields: { index: number; schema: { name: string } }[] }).fields.map(
				field => [field.index, field.schema.name],
			),
			[
				[0, 'a'],
				[1, 'c'],
				[2, 'b'],
			],
		);

		const duplicate = sequencedCtx([savedForm(existing)]);
		await assert.rejects(
			() =>
				cap('buddy_add_form_field').run(
					{ orgId: 'org-1', formId: 'form-1', field: { name: 'a', type: 'TEXT_INPUT' } },
					duplicate.ctx,
				),
			/already has a field named "a"/,
		);
	});

	test('buddy_add_form_field always prompts and never writes on denial', async () => {
		let approvals = 0;
		setMcpMutationApprover(async () => {
			approvals++;
			return false;
		});
		const { ctx, calls } = sequencedCtx([savedForm([])]);
		const output = JSON.parse(
			await cap('buddy_add_form_field').run(
				{ orgId: 'org-1', formId: 'form-1', field: { name: 'a', type: 'TEXT_INPUT' } },
				ctx,
			),
		);
		assert.strictEqual(output.status, 'approval_required');
		assert.strictEqual(approvals, 1);
		assert.ok(calls.every(call => !call.query.startsWith('mutation')));
	});

	test('form tag denial never writes and invalid operations fail before GraphQL', async () => {
		setMcpMutationApprover(async () => false);
		const { ctx, calls } = sequencedCtx([{ data: { form: { id: 'form-1', orgId: 'org-1' } } }]);
		const result = JSON.parse(
			await cap('buddy_set_form_tags').run(
				{ orgId: 'org-1', formId: 'form-1', operation: 'replace', tagIds: [] },
				ctx,
			),
		);
		assert.strictEqual(result.status, 'approval_required');
		assert.strictEqual(calls.length, 1);
		await assert.rejects(() =>
			cap('buddy_set_form_tags').run({ orgId: 'org-1', formId: 'form-1', operation: 'typo', tagIds: [] }, ctx),
		);
		assert.strictEqual(calls.length, 1);
	});
});
