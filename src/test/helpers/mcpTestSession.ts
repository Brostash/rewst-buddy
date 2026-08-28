import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Session } from '@sessions';

export function validateMcpTestEndpoint(endpoint: URL): void {
	if (endpoint.protocol !== 'https:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) {
		throw new Error('MCP live tests with a bearer token require an HTTPS loopback endpoint.');
	}
}

/**
 * Opt-in live-test adapter for contributors who already have Buddy signed in.
 * Credentials stay in the existing extension host. Every request traverses its
 * normal MCP scope/auth/approval gates; no test hook changes that running host.
 * This adapter supports rawGraphql only, not the typed Session SDK.
 */
export async function getMcpTestSession(): Promise<{ session: Session; close: () => Promise<void> }> {
	const orgId = process.env.REWST_TEST_ORG_ID?.trim();
	const token = process.env.REWST_TEST_MCP_TOKEN;
	const endpoint = new URL(process.env.REWST_TEST_MCP_URL ?? '');
	if (!orgId || !token)
		throw new Error('MCP live tests require an explicit REWST_TEST_ORG_ID and REWST_TEST_MCP_TOKEN.');
	validateMcpTestEndpoint(endpoint);
	const client = new Client({ name: 'rewst-buddy-form-integration', version: '1' });
	const transport = new StreamableHTTPClientTransport(endpoint, {
		requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' },
	});
	const invoke = async (name: string, args: Record<string, unknown>) => {
		const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
		const text = (result.content as { type: string; text?: string }[])
			.filter(part => part.type === 'text')
			.map(part => part.text ?? '')
			.join('');
		if (result.isError) throw new Error(`Live MCP ${name} failed: ${text}`);
		// Test-owned resources are small. Never silently parse a truncated result.
		const parsed = JSON.parse(text) as { data?: unknown; errors?: unknown; status?: string };
		if (parsed.status === 'approval_required') throw new Error('Live mutation was not approved in VS Code.');
		return parsed;
	};
	try {
		await client.connect(transport);
		const query = `query RbItestSandboxIdentity($orgId: ID!) { organization(where: { id: $orgId }) { id name } }`;
		const response = await invoke('buddy_graphql_query', { orgId, query });
		const org = (response.data as { organization?: { id: string; name: string } })?.organization;
		if (org?.id !== orgId || !/sandbox/i.test(org.name)) {
			throw new Error('Refusing MCP live tests: the explicitly selected org must resolve to a sandbox.');
		}
		const session = {
			profile: {
				org,
				allManagedOrgs: [org],
				user: { id: 'mcp-form-integration', orgId, organization: { ...org, managedAndSubOrgs: [org] } },
			},
			// Authentication is performed by the existing host on every forwarded call.
			validate: async () => true,
			ensureValid: async () => true,
			onExpired: () => ({ dispose() {} }),
			rawGraphql: async (document: string, variables?: Record<string, unknown>) => {
				if (variables?.orgId !== undefined && variables.orgId !== orgId)
					throw new Error('Sandbox org mismatch.');
				if (/^\s*mutation\b/.test(document)) {
					if (process.env.REWST_TEST_WRITE !== '1')
						throw new Error('Live writes require REWST_TEST_WRITE=1.');
					return invoke('buddy_graphql_mutate', {
						orgId,
						query: document,
						variables,
						scopeId: orgId,
						scopeName: 'disposable form integration fixtures',
						orgName: org.name,
					});
				}
				return invoke('buddy_graphql_query', { orgId, query: document, variables });
			},
		} as unknown as Session;
		return { session, close: () => client.close() };
	} catch (error) {
		await client.close();
		throw error;
	}
}
