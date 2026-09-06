import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { log } from '@utils';
import type { IncomingMessage, ServerResponse } from 'http';
import { formatHostPort, getServerConfig } from '../server/config';
import { parseBearerToken } from './protocol';
import { isValidMcpToken } from './runtime';
import { readMcpSettings } from './settings';

/** Mount the shared MCP server on the extension's local HTTP listener. */
export { createMcpServer as buildMcpServer } from '../../packages/mcp-server/src/mcpServer';
import { createMcpServer as buildMcpServer } from '../../packages/mcp-server/src/mcpServer';

/** node lowercases header names; a repeated header arrives as an array. */
function firstHeader(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

/**
 * Host header allowlist for DNS-rebinding protection. Always allows the loopback
 * names; the configured host is added only when it is a real bindable host, never
 * a wildcard (0.0.0.0 / ::) — accepting a wildcard Host would defeat the guard.
 */
function allowedHosts(host: string, port: number): string[] {
	const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
	const trimmed = host.trim();
	const wildcards = new Set(['0.0.0.0', '::', '[::]', '']);
	const hostWithPort = formatHostPort(trimmed, port);
	if (!wildcards.has(trimmed) && !hosts.includes(hostWithPort)) {
		hosts.push(hostWithPort);
	}
	return hosts;
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
	res.writeHead(statusCode, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

/**
 * Handles one request to the /mcp endpoint. Gates on the master switch and the
 * localhost token, then hands the request to a fresh stateless MCP transport
 * (one server+transport per request, the documented stateless pattern). DNS
 * rebinding protection restricts the Host header to localhost.
 */
export async function handleMcpHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const settings = readMcpSettings();
	if (!settings.enable) {
		writeJson(res, 403, {
			error: { code: 'mcp_disabled', message: 'The MCP server is disabled (rewst-buddy.mcp.enable).' },
		});
		return;
	}
	if (!isValidMcpToken(parseBearerToken(firstHeader(req.headers.authorization)))) {
		writeJson(res, 401, {
			error: {
				code: 'bad_token',
				message:
					'Invalid or missing MCP token in the Authorization header. Regenerate the client config in VS Code.',
			},
		});
		return;
	}

	const { host, port } = getServerConfig();
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
		enableDnsRebindingProtection: true,
		allowedHosts: allowedHosts(host, port),
	});
	const server = buildMcpServer();
	res.on('close', () => {
		void transport.close();
		void server.close();
	});
	try {
		await server.connect(transport);
		await transport.handleRequest(req, res);
	} catch (error) {
		log.error('MCP HTTP request failed', error instanceof Error ? error : undefined);
		if (!res.headersSent) {
			writeJson(res, 500, { error: { code: 'internal', message: 'MCP request failed.' } });
		}
	}
}
