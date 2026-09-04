import { editorDataOperations } from './editorData';
import { editorSessionOperations } from './editorSessions';
import { WorkingScopeManager } from './models/WorkingScopeManager';
import { callTool, listTools, listResources, readResource } from './mcp/McpActions';
import type { ExtraTool } from './mcpServer';

export function scopeSnapshot() {
	return {
		...WorkingScopeManager.snapshot(),
		namedWorkflows: [...WorkingScopeManager.workflowNames].map(([id, name]) => ({ id, name })),
	};
}

const scopeMethods = new Set(['setOrgs', 'addOrgs', 'removeOrgs', 'setWorkflows', 'addWorkflows', 'removeWorkflows']);
/** Only install on the private editor connection. Never expose as an agent tool. */
export function createEditorTool(): ExtraTool {
	return {
		name: 'rewst_editor_operation',
		description: 'Private editor operations',
		inputSchema: {
			type: 'object',
			properties: { operation: { type: 'string' }, input: { type: 'object' } },
			required: ['operation', 'input'],
		},
		async run(request, ctx) {
			const operation = request.operation;
			if (typeof operation !== 'string') throw new Error('Expected an operation');
			const input = request.input;
			if (!input || typeof input !== 'object' || Array.isArray(input))
				throw new Error('Expected operation input');
			const args = input as Record<string, unknown>;
			const handler = Object.hasOwn(editorSessionOperations, operation)
				? editorSessionOperations[operation]
				: Object.hasOwn(editorDataOperations, operation)
					? editorDataOperations[operation]
					: undefined;
			if (handler) return handler(args, ctx);
			if (operation === 'scope.snapshot') return scopeSnapshot();
			if (operation === 'scope.change') {
				const method = args.method;
				if (method === 'clear') WorkingScopeManager.clear();
				else if (method === 'applyChange') {
					const change = args.change as { orgs?: string[]; workflows?: string[]; replace?: boolean };
					if (
						!change ||
						(change.orgs && !Array.isArray(change.orgs)) ||
						(change.workflows && !Array.isArray(change.workflows))
					)
						throw new Error('Invalid scope change');
					WorkingScopeManager.applyChange(
						change,
						args.namedWorkflows as { id: string; name: string }[] | undefined,
					);
				} else if (typeof method === 'string' && scopeMethods.has(method) && Array.isArray(args.ids)) {
					(WorkingScopeManager[method as 'setOrgs'] as (ids: string[]) => void)(args.ids);
				} else throw new Error('Invalid scope operation');
				return scopeSnapshot();
			}
			if (operation === 'tools.list') return listTools();
			if (operation === 'tools.call')
				return callTool({
					name: String(args.name),
					arguments: args.arguments as Record<string, unknown> | undefined,
					orgId: args.orgId as string | undefined,
					origin: args.origin === 'chat' ? 'chat' : 'mcp',
				});
			if (operation === 'resources.list') return listResources();
			if (operation === 'resources.read') return readResource(String(args.uri));
			throw new Error(`Unknown editor operation: ${operation}`);
		},
	};
}
