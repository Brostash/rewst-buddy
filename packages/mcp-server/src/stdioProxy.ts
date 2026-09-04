import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	CallToolRequestSchema,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Readable, Writable } from 'node:stream';

export interface StdioProxyOptions {
	port: number;
	publicToken: string;
	stdin: Readable;
	stdout: Writable;
	serverUrl?: string;
}

/**
 * Run a small MCP server on stdio while forwarding its public surface to the
 * already-running shared HTTP server. The HTTP client is the only resource
 * owned by this process; closing the proxy never asks the owner to stop.
 */
export async function runStdioProxy(options: StdioProxyOptions): Promise<void> {
	const client = new Client({ name: 'rewst-buddy-mcp-stdio-proxy', version: '0.1.0' });
	const httpTransport = new StreamableHTTPClientTransport(
		new URL(options.serverUrl ?? `http://127.0.0.1:${options.port}/mcp`),
		{
			requestInit: { headers: { Authorization: `Bearer ${options.publicToken}` }, redirect: 'error' },
		},
	);
	const proxy = new Server(
		{ name: 'rewst-buddy-mcp', version: '0.1.0' },
		{ capabilities: { tools: {}, resources: {}, prompts: {} } },
	);
	await client.connect(httpTransport);

	proxy.setRequestHandler(ListToolsRequestSchema, (request, extra) =>
		client.listTools(request.params, { signal: extra.signal }),
	);
	proxy.setRequestHandler(CallToolRequestSchema, (request, extra) =>
		client.callTool(request.params, undefined, { signal: extra.signal, timeout: 30 * 60_000 }),
	);
	proxy.setRequestHandler(ListPromptsRequestSchema, (request, extra) =>
		client.listPrompts(request.params, { signal: extra.signal }),
	);
	proxy.setRequestHandler(GetPromptRequestSchema, (request, extra) =>
		client.getPrompt(request.params, { signal: extra.signal }),
	);
	proxy.setRequestHandler(ListResourcesRequestSchema, (request, extra) =>
		client.listResources(request.params, { signal: extra.signal }),
	);
	proxy.setRequestHandler(ReadResourceRequestSchema, (request, extra) =>
		client.readResource(request.params, { signal: extra.signal }),
	);

	const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
	const stdioTransport = new StdioServerTransport(options.stdin, options.stdout);
	let closed = false;
	let resolveClosed!: () => void;
	const done = new Promise<void>(resolve => {
		resolveClosed = resolve;
	});
	const close = () => {
		if (closed) return;
		closed = true;
		void stdioTransport
			.close()
			.catch(() => undefined)
			.finally(async () => {
				await proxy.close().catch(() => undefined);
				await httpTransport.terminateSession().catch(() => undefined);
				await client.close().catch(() => undefined);
				resolveClosed();
			});
	};

	proxy.onclose = close;
	options.stdin.once('end', close);
	process.once('SIGINT', close);
	process.once('SIGTERM', close);
	if (options.stdin.readableEnded) close();
	try {
		await proxy.connect(stdioTransport);
		await done;
	} finally {
		options.stdin.off('end', close);
		process.off('SIGINT', close);
		process.off('SIGTERM', close);
		close();
		await done;
	}
}
