import { afterEach, beforeEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { configureRuntimeHost } from '../src/host';
import { MemoryStateStore, MemorySecretStore } from '../src/storage';
import { createMcpServer } from '../src/mcpServer';
import { createEditorTool } from '../src/editorOperations';
import { SessionManager } from '../src/sessions/SessionManager';
import { WorkingScopeManager } from '../src/models/WorkingScopeManager';

const connections: { client: Client; server: ReturnType<typeof createMcpServer> }[] = [];
beforeEach(() => {
	configureRuntimeHost({
		state: new MemoryStateStore(),
		secrets: new MemorySecretStore(),
		getSetting: (_key, fallback) => fallback,
		log() {},
	});
	SessionManager._resetForTesting();
	WorkingScopeManager._resetForTesting();
});
afterEach(async () => {
	await Promise.all(connections.splice(0).flatMap(({ client, server }) => [client.close(), server.close()]));
});
async function connect(editor: boolean) {
	const server = createMcpServer(editor ? { extraTools: [createEditorTool()] } : {});
	const client = new Client({ name: 'test-editor', version: '1' });
	const [c, s] = InMemoryTransport.createLinkedPair();
	await server.connect(s);
	await client.connect(c);
	connections.push({ client, server });
	return client;
}

test('public connections cannot call private editor administration', async () => {
	const client = await connect(false);
	expect((await client.listTools()).tools.some(t => t.name === 'rewst_editor_operation')).toBe(false);
	const denied = await client.callTool({
		name: 'rewst_editor_operation',
		arguments: { operation: 'scope.change', input: { method: 'setOrgs', ids: ['forbidden'] } },
	});
	expect(denied.isError).toBe(true);
	expect(WorkingScopeManager.getOrgs()).toEqual([]);
});

test('editor scope changes cross MCP; agent mutations on same runtime still require write grant', async () => {
	const editor = await connect(true);
	const result = await editor.callTool({
		name: 'rewst_editor_operation',
		arguments: { operation: 'scope.change', input: { method: 'setOrgs', ids: ['chosen-org'] } },
	});
	expect(result.isError).not.toBe(true);
	expect(result.structuredContent).toMatchObject({ result: { orgs: ['chosen-org'] } });
	const publicClient = await connect(false);
	const denied = await publicClient.callTool({
		name: 'buddy_delete_template',
		arguments: { orgId: 'chosen-org', templateId: 'template' },
	});
	expect(denied.isError).toBe(true);
	expect(denied.structuredContent).toMatchObject({ code: 'write_disabled' });
});

test('private session snapshots return metadata with no credential values', async () => {
	const editor = await connect(true);
	const result = await editor.callTool({
		name: 'rewst_editor_operation',
		arguments: { operation: 'sessions.snapshot', input: {} },
	});
	expect(result.isError).not.toBe(true);
	expect(JSON.stringify(result)).not.toMatch(/appSession|cookie|passphrase/);
});
