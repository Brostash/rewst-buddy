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

	async function start(approveWrites = true): Promise<Client> {
		stdin = new PassThrough();
		cliDone = runCli(
			[
				'--state-dir',
				mkdtempSync(join(tmpdir(), 'rewst-cli-approval-')),
				'--org',
				'org-a',
				'--allow-writes',
				...(approveWrites ? ['--approve-writes'] : []),
				'--allow-graphql-mutations',
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

	it('does not auto-approve raw GraphQL against a sibling org in a headless CLI', async () => {
		const agent = await start();
		const typed = await agent.callTool({
			name: 'buddy_create_template',
			arguments: { orgId: 'org-a', name: 'Safe', body: '' },
		});
		expect(typed.structuredContent).toMatchObject({ result: { status: 'created' } });
		expect(createTemplate).toHaveBeenCalledWith({ orgId: 'org-a', name: 'Safe', body: '' });
		expect(requestAttachedEditor).not.toHaveBeenCalled();
		// The typed create also remembers approval for scopeId=org-a. Raw
		// documents must not inherit that approval or the CLI's scoped policy.
		const result = await agent.callTool(mutation);
		expect(result.structuredContent).toMatchObject({ result: { status: 'approval_required' } });
		expect(rawGraphql).not.toHaveBeenCalled();
		expect(requestAttachedEditor).toHaveBeenCalledWith(
			'approval.mutation',
			expect.objectContaining({ operation: query, scope: expect.objectContaining({ orgId: 'org-a' }) }),
		);
	});

	it('requires approval of every raw operation even with automatic typed writes enabled', async () => {
		const agent = await start();
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
