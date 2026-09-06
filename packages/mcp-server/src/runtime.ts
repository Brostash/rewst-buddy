import type { RuntimeHost } from './host';
import { configureRuntimeHost } from './host';
import { _resetMcpMutationApproverForTesting, _resetMcpResultCacheForTesting } from './capabilities/index';
import { _resetWorkingScopeApproverForTesting } from './capabilities/workingScopeCapability';
import { WorkingScopeManager } from './models/WorkingScopeManager';
import { SessionManager } from './sessions/SessionManager';
import { _resetApprovedMutationScopes } from './tools/graphqlTool';
import { _resetWorkflowIndexForTesting } from './workflow/searchIndex';

let activeHost: RuntimeHost | undefined;
let startup: Promise<void> | undefined;

function resetEphemeralState(): void {
	// These are process-lifetime caches in the extension host. A standalone
	// embedding can be stopped and started against another host in one process,
	// so never let the second host inherit the first host's scope or approvals.
	SessionManager.resetInMemory();
	WorkingScopeManager._resetForTesting();
	WorkingScopeManager._reloadForTesting();
	_resetApprovedMutationScopes();
	_resetMcpMutationApproverForTesting();
	_resetWorkingScopeApproverForTesting();
	_resetMcpResultCacheForTesting();
	_resetWorkflowIndexForTesting();
}

/** Initialise the host boundary and restore any persisted sessions. */
export async function startRuntime(host: RuntimeHost): Promise<void> {
	if (activeHost && activeHost !== host) throw new Error('A different Rewst Buddy runtime host is already active');
	if (startup) return startup;
	configureRuntimeHost(host);
	activeHost = host;
	startup = (async () => {
		SessionManager.init();
		await SessionManager.loadSessions();
	})();
	try {
		await startup;
	} catch (error) {
		if (activeHost === host) {
			SessionManager.dispose();
			resetEphemeralState();
			activeHost = undefined;
			startup = undefined;
		}
		throw error;
	}
}

/** Stop refresh work and release any host resources supplied by an embedder. */
export async function stopRuntime(host: RuntimeHost | undefined = activeHost): Promise<void> {
	if (activeHost && host && activeHost !== host) return;
	const currentStartup = startup;
	if (currentStartup) {
		try {
			await currentStartup;
		} catch {
			// Startup failures are reported by startRuntime; shutdown still cleans up.
		}
	}
	SessionManager.dispose();
	resetEphemeralState();
	activeHost = undefined;
	startup = undefined;
	const cleanup = host as
		| (RuntimeHost & { dispose?: () => void | Promise<void>; close?: () => void | Promise<void> })
		| undefined;
	if (cleanup?.dispose) await cleanup.dispose();
	else if (cleanup?.close) await cleanup.close();
}
