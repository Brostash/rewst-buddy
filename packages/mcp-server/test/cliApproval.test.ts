import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli';
import { requestAttachedEditor } from '../src/editorBridge';
import { createMcpServer } from '../src/mcpServer';
import { SessionManager } from '../src/sessions/SessionManager';
import type Session from '../src/sessions/Session';

const listener = vi.hoisted(() => ({ ready: undefined as Promise<void> | undefined }));
vi.mock('../src/sharedDiscovery', () => ({ discoverSharedServer: async () => undefined }));
vi.mock('../src/sharedHttp', () => ({
	startSharedHttpServer: async (options: { ready: Promise<void> }) => {
		listener.ready = options.ready;
		return { close: async () => {} };
	},
}));
vi.mock('../src/editorBridge', async importOriginal => ({
	...(await importOriginal<typeof import('../src/editorBridge')>()),
	requestAttachedEditor: vi.fn(),
}));

const query =
	'mutation { template: createTemplate(template: { name: "outside scope", orgId: "org-b", body: "x" }) { id orgId } }';
const mutation = {
	name: 'buddy_graphql_mutate',
	arguments: { orgId: 'org-a', scopeId: 'org-a', scopeName: 'template', query },
};

describe('CLI mutation approval through MCP', () => {
	let cliDone: Promise<number> | undefined;
	let stdin: PassThrough | undefined;
	let client: Client | undefined;
	let server: ReturnType<typeof createMcpServer> | undefined;
	const rawGraphql = vi.fn(async (_query: string, _variables?: Record<string, unknown>) => ({
		data: { template: { id: 'new-template', orgId: 'org-b' } },
	}));
	const createTemplate = vi.fn(async () => ({ template: { id: 'typed-template', name: 'Safe' } }));

	beforeEach(() => {
		listener.ready = undefined;
		rawGraphql.mockClear();
		createTemplate.mockClear();
		vi.mocked(requestAttachedEditor).mockReset().mockRejectedValue(new Error('No editor is attached'));
		for (const key of ['REWST_SESSION_COOKIE', 'REWST_BUDDY_MCP_TOKEN', 'REWST_BUDDY_PASSPHRASE'])
			vi.stubEnv(key, '');
		const session = {
			profile: {
				user: { id: 'user' },
				org: { id: 'org-a', name: 'A' },
				allManagedOrgs: [{ id: 'org-b', name: 'B' }],
			},
			validate: async () => true,
			rawGraphql,
			sdk: { createTemplateMinimal: createTemplate },
		} as unknown as Session;
		vi.spyOn(SessionManager, 'init').mockImplementation(() => {});
		vi.spyOn(SessionManager, 'loadSessions').mockResolvedValue([session]);
		vi.spyOn(SessionManager, 'getActiveSessions').mockReturnValue([session]);
		vi.spyOn(SessionManager, 'getSessionForOrg').mockResolvedValue(session);
	});

	afterEach(async () => {
		await client?.close();
		await server?.close();
		stdin?.end();
		if (cliDone) expect(await cliDone).toBe(0);
		client = undefined;
		server = undefined;
		stdin = undefined;
		cliDone = undefined;
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	async function start(approveWrites = true, bare = false): Promise<Client> {
		stdin = new PassThrough();
		cliDone = runCli(
			[
				'--state-dir',
				mkdtempSync(join(tmpdir(), 'rewst-cli-approval-')),
				...(bare
					? []
					: [
							'--org',
							'org-a',
							'--allow-writes',
							...(approveWrites ? ['--approve-writes'] : []),
							'--allow-graphql-mutations',
						]),
			],
			{ stdin, stdout: new PassThrough(), stderr: new PassThrough() },
		);
		await vi.waitFor(() => expect(listener.ready).toBeDefined());
		await listener.ready;
		server = createMcpServer();
		client = new Client({ name: 'cli-approval-test', version: '1' });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		return client;
	}

	it('delegates typed and raw write approval to the client when approveWrites is enabled', async () => {
		const agent = await start();
		const typed = await agent.callTool({
			name: 'buddy_create_template',
			arguments: { orgId: 'org-a', name: 'Safe', body: '' },
		});
		expect(typed.structuredContent).toMatchObject({ result: { status: 'created' } });
		expect((await agent.callTool(mutation)).isError).not.toBe(true);
		expect(rawGraphql).toHaveBeenCalledExactlyOnceWith(query, undefined);
		expect(requestAttachedEditor).not.toHaveBeenCalled();
	});

	it('configures a bare owner through MCP, broadcasts exposure changes, and revokes writes', async () => {
		const agent = await start(false, true);
		const changed = vi.fn();
		agent.setNotificationHandler(ToolListChangedNotificationSchema, changed);
		expect((await agent.listTools()).tools.map(t => t.name)).toContain('buddy_set_write_settings');
		expect((await agent.listTools()).tools.map(t => t.name)).not.toContain('buddy_workflow_run');
		const configure = (args: Record<string, unknown>) =>
			agent.callTool({ name: 'buddy_set_write_settings', arguments: args });
		expect((await configure({ allowWrites: true })).isError).toBe(true);
		expect(
			(await configure({ orgs: ['org-a'], allowWrites: true, approveWrites: true, allowGraphqlMutations: true }))
				.isError,
		).not.toBe(true);
		await vi.waitFor(() => expect(changed).toHaveBeenCalled());
		expect((await agent.listTools()).tools.map(t => t.name)).toEqual(
			expect.arrayContaining(['buddy_workflow_run', 'buddy_workflow_edit', 'buddy_graphql_mutate']),
		);
		expect((await agent.callTool(mutation)).isError).not.toBe(true);
		expect(requestAttachedEditor).not.toHaveBeenCalled();
		expect((await configure({ approveWrites: false })).isError).not.toBe(true);
		expect((await agent.callTool(mutation)).structuredContent).toMatchObject({
			result: { status: 'approval_required' },
		});
		expect(rawGraphql).toHaveBeenCalledTimes(1);
		expect((await configure({ allowWrites: false, allowGraphqlMutations: false })).isError).not.toBe(true);
		expect((await agent.callTool(mutation)).isError).toBe(true);
		expect((await agent.listTools()).tools.map(t => t.name)).not.toContain('buddy_workflow_run');
	});

	it('shares settings with another connection and clears cached typed approvals on revocation', async () => {
		const agent = await start();
		const peerServer = createMcpServer();
		const peer = new Client({ name: 'peer', version: '1' });
		const [peerTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await peerServer.connect(serverTransport);
		await peer.connect(peerTransport);
		try {
			const create = { name: 'buddy_create_template', arguments: { orgId: 'org-a', name: 'Safe', body: '' } };
			expect((await agent.callTool(create)).isError).not.toBe(true);
			expect(createTemplate).toHaveBeenCalledTimes(1);
			const changed = vi.fn();
			peer.setNotificationHandler(ToolListChangedNotificationSchema, changed);
			await agent.callTool({ name: 'buddy_set_write_settings', arguments: { approveWrites: false } });
			await vi.waitFor(() => expect(changed).toHaveBeenCalled());
			expect((await peer.callTool({ name: 'buddy_get_write_settings' })).structuredContent).toMatchObject({
				result: { approveWrites: false },
			});
			expect((await peer.callTool(create)).structuredContent).toMatchObject({
				result: { status: 'approval_required' },
			});
			expect(createTemplate).toHaveBeenCalledTimes(1);
		} finally {
			await peer.close();
			await peerServer.close();
		}
	});

	it('uses editor approval only when automatic approval is disabled', async () => {
		const agent = await start(false);
		vi.mocked(requestAttachedEditor)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce({ approved: true })
			.mockResolvedValueOnce(false);
		expect((await agent.callTool(mutation)).structuredContent).toMatchObject({
			result: { status: 'approval_required' },
		});
		expect(rawGraphql).not.toHaveBeenCalled();
		expect((await agent.callTool(mutation)).isError).not.toBe(true);
		expect(rawGraphql).toHaveBeenCalledExactlyOnceWith(query, undefined);
		expect((await agent.callTool(mutation)).structuredContent).toMatchObject({
			result: { status: 'approval_required' },
		});
		expect(rawGraphql).toHaveBeenCalledTimes(1);
		expect(requestAttachedEditor).toHaveBeenCalledTimes(3);
	});

	it('supports concrete editor approval without automatic typed write approval', async () => {
		const agent = await start(false);
		vi.mocked(requestAttachedEditor).mockResolvedValue(true);
		expect((await agent.callTool(mutation)).isError).not.toBe(true);
		expect(rawGraphql).toHaveBeenCalledExactlyOnceWith(query, undefined);
		expect(requestAttachedEditor).toHaveBeenCalledTimes(1);
	});
});
