import * as assert from 'node:assert';
import { suite, test } from '../tdd';
import { validateMcpTestEndpoint } from './mcpTestSession';

suite('Unit: MCP test session transport validation', () => {
	test('accepts only an HTTPS loopback endpoint when using a bearer token', () => {
		for (const url of ['https://localhost:3000/mcp', 'https://127.0.0.1:3000/mcp', 'https://[::1]:3000/mcp']) {
			assert.doesNotThrow(() => validateMcpTestEndpoint(new URL(url)));
		}
		for (const url of ['http://localhost:3000/mcp', 'https://example.test/mcp', 'http://example.test/mcp']) {
			assert.throws(() => validateMcpTestEndpoint(new URL(url)), /HTTPS loopback endpoint/);
		}
	});
});
