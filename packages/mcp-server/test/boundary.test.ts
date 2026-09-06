import { beforeEach, describe, expect, it } from 'vitest';
import { configureRuntimeHost, type RuntimeHost } from '../src/host';
import { CAPABILITY_REGISTRY } from '../src/capabilities/registry';
import { callTool, listTools } from '../src/mcp/McpActions';
import { readMcpSettings } from '../src/mcp/settings';

describe('standalone capability boundary', () => {
	beforeEach(() => {
		const state = new Map<string, unknown>();
		configureRuntimeHost({
			state: {
				get: (key, fallback) => (state.get(key) ?? fallback) as never,
				update: async (key, value) => {
					state.set(key, value);
				},
			},
			secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
			getSetting: (_key, fallback) => fallback,
			log: () => {},
		} satisfies RuntimeHost);
	});

	it('provides remote operations without advertising absent editor capabilities', () => {
		const names = CAPABILITY_REGISTRY.map(capability => capability.spec.name);
		expect(new Set(names).size).toBe(names.length);
		expect(names).toContain('buddy_get_template');
		expect(names).toContain('buddy_workflow_get');
		expect(names).not.toContain('buddy_search_template_links');
		expect(names).not.toContain('buddy_template_sync');
	});

	it('starts with remote writes disabled and rejects an attempted mutation before session access', async () => {
		expect(readMcpSettings().enableWriteTools).toBe(false);
		expect(listTools().some(tool => tool.name === 'buddy_delete_template')).toBe(false);
		await expect(
			callTool({ name: 'buddy_delete_template', arguments: { orgId: 'org', templateId: 'template' } }),
		).rejects.toMatchObject({ code: 'write_disabled' });
	});

	it('requires a deliberate organization scope even when writes are enabled', async () => {
		await expect(
			callTool(
				{ name: 'buddy_delete_template', arguments: { orgId: 'org', templateId: 'template' } },
				{
					...readMcpSettings(),
					enableWriteTools: true,
				},
			),
		).rejects.toMatchObject({ code: 'org_out_of_scope' });
	});
});
