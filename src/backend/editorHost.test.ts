import * as assert from 'assert';
import { suite, test } from 'mocha';
import { initTestEnvironment } from '@test';
import { OPTIONAL_EDITOR_CAPABILITIES } from '../capabilities/registry';
import { isMcpToolCall, runWithApprovalOrigin } from '../../packages/mcp-server/src/capabilities/approvalOrigin';
import { handleEditorRequest } from './editorHost';

suite('Unit: editorHost approval origin', () => {
	initTestEnvironment();
	for (const origin of ['mcp', 'chat', undefined] as const) {
		test(`uses only trusted envelope origin ${origin ?? '(missing)'}`, async () => {
			const capability = OPTIONAL_EDITOR_CAPABILITIES.find(c => c.spec.name === 'buddy_template_sync')!;
			const original = capability.run;
			capability.run = async () => {
				await Promise.resolve();
				return String(isMcpToolCall());
			};
			try {
				const result = await handleEditorRequest('capability.run', {
					name: capability.spec.name,
					origin,
					args: { origin: origin === 'mcp' ? 'chat' : 'mcp' },
					context: { orgId: 'org', profiles: [] },
				});
				assert.strictEqual(result, String(origin === 'mcp'));
				assert.strictEqual(isMcpToolCall(), false, 'origin must not leak into later editor work');
			} finally {
				capability.run = original;
			}
		});
	}
	test('rejects invalid envelope origins and preserves the surrounding call context', async () => {
		await runWithApprovalOrigin('chat', async () => {
			await assert.rejects(
				handleEditorRequest('capability.run', {
					name: 'buddy_template_sync',
					origin: 'auto-approve',
					args: {},
					context: { orgId: 'org', profiles: [] },
				}),
				/origin must be/,
			);
			assert.strictEqual(isMcpToolCall(), false);
		});
	});
});
