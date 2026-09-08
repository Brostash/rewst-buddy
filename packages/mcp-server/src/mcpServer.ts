import { getRuntimeWriteSettings } from './host';
import { onCapabilityCatalogChanged } from './capabilities/registry';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	CallToolRequestSchema,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { callTool, listResources, listTools, McpError, readResource } from './mcp/McpActions';
import { buildMcpInstructions, MCP_PROMPTS, renderMcpPrompt } from './mcp/instructions';
import { MCP_PROTOCOL_VERSION } from './mcp/protocol';
import { readMcpSettings } from './mcp/settings';

declare const __PACKAGE_VERSION__: string;

export interface ExtraTool {
	name: string;
	description: string;
	inputSchema: object;
	run(
		input: Record<string, unknown>,
		context: { signal: AbortSignal; emit(event: unknown): Promise<void> },
	): Promise<unknown>;
}

export interface McpServerOptions {
	extraTools?: ExtraTool[];
}

const SERVER_INFO = {
	name: 'rewst-buddy-mcp',
	version: typeof __PACKAGE_VERSION__ === 'string' ? __PACKAGE_VERSION__ : '0.1.0',
};

function toObjectSchema(schema: object): { type: 'object'; [key: string]: unknown } {
	if (schema && typeof schema === 'object' && (schema as { type?: unknown }).type === 'object') {
		return schema as { type: 'object'; [key: string]: unknown };
	}
	return { type: 'object', properties: {} };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string {
	if (error instanceof McpError) return error.code;
	if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
		return (error as { code: string }).code;
	}
	return 'internal';
}

function structuredResult(text: string): { result: unknown } | undefined {
	try {
		return { result: JSON.parse(text) };
	} catch {
		return undefined;
	}
}

function assertUniqueExtraTools(extraTools: ExtraTool[]): void {
	const names = new Set<string>();
	for (const tool of extraTools) {
		if (!tool || typeof tool.name !== 'string' || tool.name.trim() === '') {
			throw new TypeError('Extra MCP tools require a non-empty name');
		}
		if (names.has(tool.name)) throw new TypeError(`Duplicate extra MCP tool "${tool.name}"`);
		names.add(tool.name);
	}
}

/** Create a low-level SDK server. The caller owns its transport lifecycle. */
export function createMcpServer(options: McpServerOptions = {}): Server {
	const writeSettings = getRuntimeWriteSettings();
	const extraTools = [...(writeSettings?.tools() ?? []), ...(options.extraTools ?? [])];
	assertUniqueExtraTools(extraTools);
	const extraByName = new Map(extraTools.map(tool => [tool.name, tool]));
	const server = new Server(SERVER_INFO, {
		capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} },
		instructions: buildMcpInstructions(),
	});

	let unsubscribeSettings: (() => void) | undefined;
	let unsubscribeCatalog: (() => void) | undefined;
	server.oninitialized = () => {
		unsubscribeSettings?.();
		unsubscribeSettings = writeSettings?.onChanged(() => {
			void server.sendToolListChanged().catch(() => undefined);
		});
		unsubscribeCatalog?.();
		unsubscribeCatalog = onCapabilityCatalogChanged(() => {
			void server.sendToolListChanged().catch(() => undefined);
		});
	};
	server.onclose = () => {
		unsubscribeSettings?.();
		unsubscribeCatalog?.();
	};

	server.setRequestHandler(ListToolsRequestSchema, () => {
		const settings = readMcpSettings();
		return {
			tools: [
				...listTools(settings).map(tool => ({
					name: tool.name,
					description: tool.description,
					inputSchema: toObjectSchema(tool.inputSchema),
				})),
				...extraTools.map(tool => ({
					name: tool.name,
					description: tool.description,
					inputSchema: toObjectSchema(tool.inputSchema),
				})),
			],
		};
	});

	server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
		const input = (request.params.arguments ?? {}) as Record<string, unknown>;
		const custom = extraByName.get(request.params.name);
		if (custom) {
			try {
				const value = await custom.run(input, {
					signal: extra.signal,
					emit: event =>
						extra.sendNotification({
							method: 'notifications/rewst/event',
							params: { event },
						} as never),
				});
				const result = value ?? null;
				const text = typeof result === 'string' ? result : JSON.stringify(result);
				return { content: [{ type: 'text' as const, text }], structuredContent: { result } };
			} catch (error) {
				const text = errorMessage(error);
				return {
					content: [{ type: 'text' as const, text }],
					isError: true,
					structuredContent: { code: errorCode(error) },
				};
			}
		}

		try {
			const result = await callTool({ name: request.params.name, arguments: input });
			return {
				content: [{ type: 'text' as const, text: result.text }],
				isError: result.isError === true,
				structuredContent: structuredResult(result.text),
			};
		} catch (error) {
			const text = errorMessage(error);
			return {
				content: [{ type: 'text' as const, text }],
				isError: true,
				structuredContent: { code: errorCode(error) },
			};
		}
	});

	server.setRequestHandler(ListPromptsRequestSchema, () => ({
		prompts: MCP_PROMPTS.map(prompt => ({
			name: prompt.name,
			description: prompt.description,
			arguments: prompt.arguments,
		})),
	}));

	server.setRequestHandler(GetPromptRequestSchema, request => {
		const args = (request.params.arguments ?? {}) as Record<string, string>;
		return {
			messages: [
				{
					role: 'user' as const,
					content: { type: 'text' as const, text: renderMcpPrompt(request.params.name, args) },
				},
			],
		};
	});

	server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: listResources(readMcpSettings()) }));
	server.setRequestHandler(ReadResourceRequestSchema, async request => {
		const content = await readResource(request.params.uri, readMcpSettings());
		return { contents: [{ uri: content.uri, mimeType: content.mimeType, text: content.text }] };
	});

	return server;
}

export { MCP_PROTOCOL_VERSION };
