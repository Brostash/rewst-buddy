/** Retry policy is implemented by the trusted MCP session runtime. */
export interface RetryOptions {
	maxRetries: number;
	baseDelay: number;
	maxDelay: number;
}
