import { describe, expect, it } from 'vitest';
import { getRuntimeHost, type RuntimeHost } from '../src/host';
import { WorkingScopeManager } from '../src/models/WorkingScopeManager';
import { MemorySecretStore, MemoryStateStore } from '../src/storage';
import { startRuntime, stopRuntime } from '../src/runtime';
import {
	requestMcpMutationApproval,
	requestMcpScopedMutationApproval,
	setMcpMutationApprover,
	setMcpScopedMutationApprover,
} from '../src/capabilities/graphqlMutateCapability';

function host(): RuntimeHost {
	return {
		state: new MemoryStateStore(),
		secrets: new MemorySecretStore(),
		getSetting: (_key, fallback) => fallback,
		log: () => {},
	};
}

describe('runtime lifecycle', () => {
	it('configures the host and loads sessions without network credentials', async () => {
		const runtimeHost = host();
		await startRuntime(runtimeHost);
		expect(() => runtimeHost.state.get('missing')).not.toThrow();
		await stopRuntime(runtimeHost);
	});

	it('can replace the configured host for a subsequent start', async () => {
		const first = host();
		const second = host();
		await startRuntime(first);
		WorkingScopeManager.setOrgs(['first-host-org']);
		await stopRuntime(first);
		await startRuntime(second);
		expect(getRuntimeHost()).toBe(second);
		expect(WorkingScopeManager.getOrgs()).toEqual([]);
		await stopRuntime(second);
	});

	it('rejects concurrent startup with a different host', async () => {
		const first = host();
		const second = host();
		await startRuntime(first);
		await expect(startRuntime(second)).rejects.toThrow('different Rewst Buddy runtime host');
		await stopRuntime(first);
	});

	it('does not carry concrete or standing write approval into the next runtime', async () => {
		const first = host();
		const second = host();
		const scope = { scopeId: 'template', scopeName: 'Template', orgId: 'org', orgName: 'Org' };
		await startRuntime(first);
		setMcpMutationApprover(async () => true);
		setMcpScopedMutationApprover(async () => true);
		await stopRuntime(first);
		await startRuntime(second);
		try {
			expect(await requestMcpMutationApproval(scope, 'mutation')).toBe(false);
			expect(await requestMcpScopedMutationApproval(scope, 'typed write')).toBe(false);
		} finally {
			await stopRuntime(second);
		}
	});
});
