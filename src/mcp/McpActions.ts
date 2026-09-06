import { cachedTools, cachedResources, invoke } from '../backend/operations';
import type { McpResourceDescriptor, McpToolDescriptor, McpToolResult } from './protocol';
import type { McpSettings } from './settings';
export { McpError } from '../../packages/mcp-server/src/mcp/McpActions';
export type { CallToolParams, ResourceContent } from '../../packages/mcp-server/src/mcp/McpActions';
import type { CallToolParams, ResourceContent } from '../../packages/mcp-server/src/mcp/McpActions';

/** Synchronous UI catalogs refreshed over MCP on startup/config/session changes. */
export function listTools(_settings?: McpSettings): McpToolDescriptor[] {
	return [...cachedTools()];
}
export function listResources(_settings?: McpSettings): McpResourceDescriptor[] {
	return [...cachedResources()];
}
export function callTool(params: CallToolParams, _settings?: McpSettings): Promise<McpToolResult> {
	return invoke('tools.call', { ...params });
}
export function readResource(uri: string, _settings?: McpSettings): Promise<ResourceContent> {
	return invoke('resources.read', { uri });
}
export { _resetMcpThrottleForTesting } from '../../packages/mcp-server/src/mcp/McpActions';
