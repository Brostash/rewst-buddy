import { afterEach, expect, test } from 'vitest';
import { CAPABILITY_REGISTRY, getCapability, registerHostCapabilities } from '../src/capabilities/registry';

let dispose: (() => void) | undefined;
afterEach(() => {
	dispose?.();
	dispose = undefined;
});

test('editor capabilities are optional and cannot replace server operations', () => {
	const capability = {
		spec: { name: 'test_editor', description: 'Editor only', args: '{}', inputSchema: { type: 'object' } },
		access: 'read' as const,
		requiresOrg: false,
		run: async () => 'ok',
	};
	expect(getCapability(capability.spec.name)).toBeUndefined();
	dispose = registerHostCapabilities([capability]);
	expect(getCapability(capability.spec.name)).toBe(capability);
	expect(CAPABILITY_REGISTRY).toContain(capability);
	expect(() => registerHostCapabilities([capability])).toThrow(/duplicate/i);
	dispose();
	expect(getCapability(capability.spec.name)).toBeUndefined();
});
