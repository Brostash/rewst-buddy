import { readCapability } from './capabilityFactories';
import { runToolRequests, WORKSPACE_TOOL_SPECS } from '../ui/chat/tools/workspaceTools';
export {
	WORKFLOW_CHAT_CAPABILITIES,
	graphqlSchemaCapability,
	executionLogsDeps,
} from '../../packages/mcp-server/src/capabilities/chatToolCapabilities';
export const WORKSPACE_CHAT_CAPABILITIES = WORKSPACE_TOOL_SPECS.map(spec =>
	readCapability(
		spec,
		async input => {
			const [result] = await runToolRequests([{ tool: spec.name, args: input }]);
			return result.ok ? result.output : `Error: ${result.output}`;
		},
		{ requiresOrg: false },
	),
);
