import { _resetMcpMutationApproverForTesting, setMcpMutationApprover } from '@capabilities';
import { Session, SessionManager } from '@sessions';
import { WorkingScopeManager } from '@models';
import { clearCachedSession, getTestSession, hasTestToken, initTestEnvironment } from '@test';
import * as assert from 'assert';
import * as Mocha from 'mocha';
import { _resetApprovedMutationScopes } from '../../ui/chat/tools/graphqlTool';
import { getMcpTestSession } from '../helpers/mcpTestSession';
import { rawGraphqlOrThrow } from '../../capabilities/inputHelpers';
import { callTool, _resetMcpThrottleForTesting } from '../../mcp/McpActions';

const { suite, test, suiteSetup, suiteTeardown, setup } = Mocha;

function writeTestsEnabled(): boolean {
	return (hasTestToken() || !!process.env.REWST_TEST_MCP_URL) && process.env.REWST_TEST_WRITE === '1';
}

const BY_ID = `query RbItestFormById($orgId: ID!, $id: ID!) {
  form(orgContextId: $orgId, where: { orgId: $orgId, id: $id }) {
    id name description orgId fields(orgContextId: $orgId) { id index type schema }
  }
}`;
const DELETE = `mutation RbItestDeleteForm($id: ID!) { deleteForm(id: $id) }`;
const DELETE_TAG = `mutation RbItestDeleteFormTag($id: ID!) { deleteTag(id: $id) }`;
const DELETE_TRIGGER = `mutation RbItestDeleteTrigger($id: ID!) { deleteTrigger(id: $id) }`;
const DELETE_WORKFLOW = `mutation RbItestDeleteWorkflow($id: ID!) { deleteWorkflow(id: $id) }`;

/**
 * Inert synthetic options: the generator returns a fixed two-item list from a
 * Jinja literal, so running it touches no integration, no tenant and no real
 * user data. `skipCache` is declared so the form field has something real to map
 * a value into.
 */
const SYNTHETIC_OPTIONS_EXPRESSION =
	'{{ [{"label": "Synthetic Alpha", "value": "alpha"}, {"label": "Synthetic Beta", "value": "beta"}] }}';

suite('Integration: form CRUD tools', function () {
	this.timeout(600_000); // Allows interactive approval on an existing MCP host.

	let session: Session;
	let targetOrgId: string;
	let closeMcp: (() => Promise<void>) | undefined;
	const run = async (name: string, args: Record<string, unknown>) => {
		console.log(`[itest] ${name}`);
		_resetMcpThrottleForTesting();
		const result = await callTool(
			{ name, arguments: { orgId: targetOrgId, ...args } },
			{
				enable: true,
				enableWriteTools: true,
				enableDangerousGraphqlMutation: false,
				alwaysAllowedOrgs: [],
				workingOrgScope: 'strict',
			},
		);
		assert.notStrictEqual(result.isError, true, result.text);
		return result.text;
	};

	suiteSetup(async function () {
		if (!writeTestsEnabled()) {
			this.skip();
			return;
		}
		initTestEnvironment();
		if (process.env.REWST_TEST_MCP_URL) {
			const remote = await getMcpTestSession();
			session = remote.session;
			closeMcp = remote.close;
		} else {
			session = await getTestSession();
		}
		targetOrgId = session.profile.org.id;
		if (!targetOrgId) throw new Error('Refusing to run: the test session has no sandbox org id.');
		if (!/sandbox/i.test(session.profile.org.name)) {
			throw new Error(
				`Refusing to run form writes: REWST_TEST_ORG_ID resolves to "${session.profile.org.name}", not a sandbox.`,
			);
		}
		SessionManager._setSessionsForTesting([session]);
		WorkingScopeManager._resetForTesting();
		WorkingScopeManager.setOrgs([targetOrgId]);
		console.log(`\n[itest] target org: ${session.profile.org.name} (${targetOrgId})`);
	});

	setup(() => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		setMcpMutationApprover(async () => true);
	});

	suiteTeardown(async () => {
		_resetApprovedMutationScopes();
		_resetMcpMutationApproverForTesting();
		clearCachedSession();
		SessionManager._resetForTesting();
		WorkingScopeManager._resetForTesting();
		await closeMcp?.();
	});

	test('form definitions, conditions, tags, pagination, and deletion round-trip through the MCP boundary', async () => {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const name = `rb-form-itest-${stamp}`;
		let id: string | undefined;
		let tagId: string | undefined;
		let bodyFailed = false;

		const byId = async (formId: string) => {
			const { data, errors } = await session.rawGraphql(BY_ID, { orgId: targetOrgId, id: formId });
			if (Array.isArray(errors) ? errors.length > 0 : errors != null) {
				throw new Error(`BY_ID GraphQL error: ${JSON.stringify(errors)}`);
			}
			return (data as { form?: { id: string; name: string; description?: string; orgId: string } | null }).form;
		};

		try {
			const created = JSON.parse(
				await run('buddy_create_form', {
					name,
					description: 'integration test',
					fields: [
						{
							index: 0,
							type: 'TEXT_INPUT',
							schema: { name: 'company', type: 'string', label: 'Company', required: true },
						},
						{
							index: 1,
							type: 'CHECKBOX',
							schema: { name: 'enabled', type: 'boolean', label: 'Enabled', default: false },
						},
					],
				}),
			);
			assert.strictEqual(created.status, 'created');
			id = created.id;

			const read = JSON.parse(await run('buddy_get_form', { formId: id }));
			assert.strictEqual(read.name, name);
			assert.strictEqual(read.orgId, targetOrgId);
			assert.strictEqual(read.fields.length, 2);
			assert.strictEqual(read.fields[0].schema.name, 'company');
			assert.strictEqual(read.fields[1].type, 'CHECKBOX');
			assert.match(await run('buddy_list_forms', { search: name, limit: 1, offset: 0 }), new RegExp(id!));
			assert.strictEqual(
				await run('buddy_list_forms', { search: name, limit: 1, offset: 1 }),
				'No forms found for this organization.',
			);
			assert.match(await run('buddy_resolve_reference', { modelType: 'Form', valueIn: [id] }), new RegExp(id!));

			const updatedName = `${name}-updated`;
			const updated = JSON.parse(
				await run('buddy_update_form', { formId: id, name: updatedName, description: '' }),
			);
			assert.strictEqual(updated.status, 'updated');
			const row = await byId(id!);
			assert.strictEqual(row?.name, updatedName);
			assert.strictEqual(row?.description, '');
			const preserved = JSON.parse(await run('buddy_get_form', { formId: id }));
			assert.deepStrictEqual(preserved.fields, read.fields, 'metadata edits must preserve field definitions');
			const fields = preserved.fields.map((field: Record<string, unknown>) => ({ ...field }));
			fields[0].conditions = [
				{
					action: 'show',
					actionValue: null,
					conditionType: 'default',
					fieldId: fields[0].id,
					index: 0,
					requiredValue: true,
					sourceFieldId: fields[1].id,
				},
			];
			await run('buddy_update_form', { formId: id, fields });
			const conditioned = JSON.parse(await run('buddy_get_form', { formId: id }));
			assert.strictEqual(conditioned.fields[0].conditions[0].sourceFieldId, fields[1].id);
			assert.strictEqual(conditioned.fields[0].conditions[0].requiredValue, true);
			// Round-trip the actual nullable condition shape returned by Rewst.
			await run('buddy_update_form', { formId: id, fields: conditioned.fields });
			const reread = JSON.parse(await run('buddy_get_form', { formId: id }));
			assert.deepStrictEqual(reread.fields, conditioned.fields);

			const tag = JSON.parse(await run('buddy_create_tag', { name: `${name}-tag` }));
			tagId = tag.id;
			const tagged = JSON.parse(
				await run('buddy_set_form_tags', { formId: id, operation: 'add', tagIds: [tagId] }),
			);
			assert.deepStrictEqual(tagged.tagIds.after, [tagId]);
			const untagged = JSON.parse(
				await run('buddy_set_form_tags', { formId: id, operation: 'replace', tagIds: [] }),
			);
			assert.deepStrictEqual(untagged.tagIds.after, []);
			await run('buddy_update_form', { formId: id, fields: [] });
			assert.deepStrictEqual(JSON.parse(await run('buddy_get_form', { formId: id })).fields, []);

			const deleted = JSON.parse(await run('buddy_delete_form', { formId: id }));
			assert.strictEqual(deleted.status, 'deleted');
			assert.strictEqual(await byId(created.id), null);
			id = undefined;
		} catch (error) {
			bodyFailed = true;
			throw error;
		} finally {
			const errors: unknown[] = [];
			if (id) {
				try {
					await rawGraphqlOrThrow(session, DELETE, { id });
				} catch (error) {
					errors.push(error);
					console.error(`Form cleanup failed; delete test form ${id} in org ${targetOrgId}.`);
				}
			}
			if (tagId) {
				try {
					await rawGraphqlOrThrow(session, DELETE_TAG, { id: tagId });
				} catch (error) {
					errors.push(error);
					console.error(`Tag cleanup failed; delete test tag ${tagId} in org ${targetOrgId}.`);
				}
			}
			if (!bodyFailed)
				assert.strictEqual(errors.length, 0, `Fixture cleanup failed: ${errors.map(String).join('; ')}`);
		}
	});

	test('an option-generator workflow, its trigger, a dynamic form and a disabled submit trigger round-trip', async () => {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const base = `rb-optgen-itest-${stamp}`;
		let workflowId: string | undefined;
		let generatorTriggerId: string | undefined;
		let formId: string | undefined;
		let submitTriggerId: string | undefined;
		let submitWorkflowId: string | undefined;
		let bodyFailed = false;

		try {
			// 1. An OPTION_GENERATOR workflow declaring its inputs and options output.
			const generator = JSON.parse(
				await run('buddy_create_workflow', {
					name: `${base}-generator`,
					description: 'Inert option generator fixture',
					type: 'OPTION_GENERATOR',
					input: ['skipCache'],
					output: [{ name: 'options', value: SYNTHETIC_OPTIONS_EXPRESSION }],
				}),
			);
			assert.strictEqual(generator.status, 'created');
			assert.strictEqual(generator.type, 'OPTION_GENERATOR');
			workflowId = generator.id;

			// 2. A trigger for it. Created disabled by default, then enabled so the
			//    generator can actually be invoked.
			const generatorTrigger = JSON.parse(
				await run('buddy_create_trigger', {
					workflowId,
					name: `${base}-generator-trigger`,
					triggerTypeRef: process.env.REWST_TEST_GENERATOR_TRIGGER_REF ?? 'manual',
				}),
			);
			assert.strictEqual(generatorTrigger.status, 'created');
			assert.strictEqual(generatorTrigger.enabled, false, 'new triggers are created disabled');
			generatorTriggerId = generatorTrigger.id;
			await run('buddy_set_trigger_enabled', { triggerId: generatorTriggerId, enabled: true });

			// 3. A form whose dropdown is generated by that workflow, from typed fields.
			const form = JSON.parse(
				await run('buddy_create_form', {
					name: `${base}-form`,
					description: 'Dynamic options fixture',
					typedFields: [
						{ name: 'refresh_options', type: 'CHECKBOX', label: 'Refresh' },
						{
							name: 'synthetic_choice',
							type: 'SELECT',
							label: 'Synthetic choice',
							required: true,
							dynamicOptions: {
								workflowId,
								triggerId: generatorTriggerId,
								inputFromFields: { skipCache: 'refresh_options' },
							},
						},
					],
				}),
			);
			assert.strictEqual(form.status, 'created', JSON.stringify(form.verification));
			assert.strictEqual(form.verification.status, 'verified');
			formId = form.id;

			// 4. Interpretation resolves the generator without running it.
			const read = JSON.parse(await run('buddy_get_form', { formId }));
			const dynamic = read.interpreted.fields.find(
				(field: { name: string }) => field.name === 'synthetic_choice',
			);
			assert.strictEqual(dynamic.generator.workflowType, 'OPTION_GENERATOR');
			assert.strictEqual(dynamic.generator.resolvedTriggerId, generatorTriggerId);
			assert.deepStrictEqual(dynamic.generator.problems, []);
			const stored = read.fields.find(
				(field: { schema: { name: string } }) => field.schema.name === 'synthetic_choice',
			);
			assert.strictEqual(stored.schema.enumSourceWorkflow.id, workflowId);

			// 5. Adding one field incrementally leaves the existing fields alone.
			const added = JSON.parse(
				await run('buddy_add_form_field', {
					formId,
					field: { name: 'reason', type: 'MULTILINE_INPUT', label: 'Reason' },
				}),
			);
			assert.strictEqual(added.status, 'field_added');
			assert.deepStrictEqual(added.fieldCount, { before: 2, after: 3 });
			const afterAdd = JSON.parse(await run('buddy_get_form', { formId }));
			assert.deepStrictEqual(
				afterAdd.fields.map((field: { schema: { name: string } }) => field.schema.name),
				['refresh_options', 'synthetic_choice', 'reason'],
			);
			assert.deepStrictEqual(
				afterAdd.fields[1].schema.enumSourceWorkflow,
				stored.schema.enumSourceWorkflow,
				'the untouched generator field is written back byte-for-byte',
			);

			// 6. Non-executing validation of the stored form.
			const validation = JSON.parse(await run('buddy_validate_form', { formId }));
			assert.strictEqual(validation.executed, false);
			assert.strictEqual(validation.validation.ok, true, JSON.stringify(validation.validation.errors));
			assert.ok(validation.validation.passedChecks.includes('generator_declares_options_output'));

			// 7. Actually run the generator and check the produced option keys.
			const smoke = JSON.parse(
				await run('buddy_test_form_options', {
					workflowId,
					formId,
					fieldName: 'synthetic_choice',
					values: { refresh_options: true },
					skipCache: true,
				}),
			);
			assert.ok(['passed', 'running'].includes(smoke.status), JSON.stringify(smoke));
			if (smoke.status === 'passed') {
				assert.strictEqual(smoke.optionCount, 2);
				assert.strictEqual(smoke.labelKeyCheck.status, 'passed');
				assert.strictEqual(smoke.valueKeyCheck.status, 'passed');
			}

			// 8. A disabled form-submission trigger on a separate target workflow.
			const target = JSON.parse(await run('buddy_create_workflow', { name: `${base}-submit-target` }));
			submitWorkflowId = target.id;
			const submit = JSON.parse(
				await run('buddy_create_trigger', {
					workflowId: submitWorkflowId,
					name: `${base}-submit`,
					formId,
					...(process.env.REWST_TEST_FORM_TRIGGER_REF
						? { triggerTypeRef: process.env.REWST_TEST_FORM_TRIGGER_REF }
						: {}),
				}),
			);
			assert.strictEqual(submit.status, 'created', JSON.stringify(submit.verification));
			assert.strictEqual(submit.enabled, false, 'a form submit trigger is never created live');
			assert.strictEqual(submit.formId, formId);
			assert.strictEqual(submit.verification.status, 'verified');
			submitTriggerId = submit.id;

			const withTrigger = JSON.parse(await run('buddy_get_form', { formId }));
			assert.ok(
				withTrigger.triggers.some((trigger: { id: string }) => trigger.id === submitTriggerId),
				'the form reports its new submission trigger',
			);
		} catch (error) {
			bodyFailed = true;
			throw error;
		} finally {
			const errors: unknown[] = [];
			const cleanup = async (label: string, mutation: string, id: string | undefined) => {
				if (!id) return;
				try {
					await rawGraphqlOrThrow(session, mutation, { id });
				} catch (error) {
					errors.push(error);
					console.error(`${label} cleanup failed; remove ${id} in org ${targetOrgId} by hand.`);
				}
			};
			// Triggers first: deleting a workflow or form out from under one leaves
			// the other side dangling.
			await cleanup('Submit trigger', DELETE_TRIGGER, submitTriggerId);
			await cleanup('Generator trigger', DELETE_TRIGGER, generatorTriggerId);
			await cleanup('Form', DELETE, formId);
			await cleanup('Generator workflow', DELETE_WORKFLOW, workflowId);
			await cleanup('Submit target workflow', DELETE_WORKFLOW, submitWorkflowId);
			if (!bodyFailed)
				assert.strictEqual(errors.length, 0, `Fixture cleanup failed: ${errors.map(String).join('; ')}`);
		}
	});
});
