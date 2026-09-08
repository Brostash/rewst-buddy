import { AsyncLocalStorage } from 'async_hooks';

/** Trusted async-local call origin, set at the McpActions boundary, never from tool arguments. */
export type ApprovalOrigin = 'chat' | 'mcp';

const store = new AsyncLocalStorage<ApprovalOrigin>();

/** Runs fn with the given approval origin in scope for the approval flow to read. */
export function runWithApprovalOrigin<T>(origin: ApprovalOrigin, fn: () => Promise<T>): Promise<T> {
	return store.run(origin, fn);
}

/** The in-flight call's origin; defaults to an external MCP client when unset. */
export function currentApprovalOrigin(): ApprovalOrigin {
	return store.getStore() ?? 'mcp';
}

/** Unmarked in-process extension calls must retain host approval. */
export function isMcpToolCall(): boolean {
	return store.getStore() === 'mcp';
}
