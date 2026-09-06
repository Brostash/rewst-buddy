import { EventEmitter } from 'node:events';
import type { Capability } from './Capability';
import { AsyncLocalStorage } from 'node:async_hooks';
import { WORKFLOW_CHAT_CAPABILITIES, graphqlSchemaCapability } from './chatToolCapabilities';
import { CRATE_CAPABILITIES } from './crateCapabilities';
import { crateUnpackCapability } from './crateUnpackCapability';
import { graphqlMutateCapability } from './graphqlMutateCapability';
import { JINJA_DOCS_CAPABILITIES } from './jinjaDocsCapabilities';
import { ORG_USER_CAPABILITIES } from './orgUserCapabilities';
import { ORG_VARIABLE_MUTATE_CAPABILITIES } from './orgVariableMutateCapabilities';
import { PACK_INTEGRATION_CAPABILITIES } from './packIntegrationCapabilities';
import { PAGE_TEMPLATE_CAPABILITIES } from './pageTemplateCapabilities';
import { resultReadCapability } from './resultReadCapability';
import { READ_CAPABILITIES } from './rewstReadCapabilities';
import { TAG_MUTATE_CAPABILITIES } from './tagMutateCapabilities';
import { TEMPLATE_CLONE_CAPABILITIES } from './templateCloneCapabilities';
import { TEMPLATE_MUTATE_CAPABILITIES } from './templateMutateCapabilities';
import { TRIGGER_ACTIVATION_CAPABILITIES } from './triggerActivationCapabilities';
import { TRIGGER_FORM_CAPABILITIES } from './triggerFormCapabilities';
import { TRIGGER_MUTATE_CAPABILITIES } from './triggerMutateCapabilities';
import { TRIGGER_TAG_CAPABILITIES } from './triggerTagCapabilities';
import { WORKFLOW_CRUD_CAPABILITIES } from './workflowCrudCapabilities';
import { workflowImpactCapability } from './workflowImpactCapability';
import {
	deleteWorkflowInputProfileCapability,
	listWorkflowInputProfilesCapability,
	saveWorkflowInputProfileCapability,
} from './workflowInputProfileCapabilities';
import { workflowLintCapability } from './workflowLintCapability';
import { WORKING_SCOPE_CAPABILITIES } from './workingScopeCapability';

/**
 * The single source of truth for Rewst capabilities. Every capability is
 * exposed over the MCP server surface (behind the boundary's access gates) and
 * mirrored by Cage-Free Rewsty's in-process Buddy path; adding a capability
 * here surfaces it everywhere. Names must be unique across the registry.
 */
export const CAPABILITY_REGISTRY: Capability[] = [
	...WORKFLOW_CHAT_CAPABILITIES,
	graphqlSchemaCapability,
	...READ_CAPABILITIES,
	...TRIGGER_FORM_CAPABILITIES,
	...PACK_INTEGRATION_CAPABILITIES,
	...ORG_USER_CAPABILITIES,
	...PAGE_TEMPLATE_CAPABILITIES,
	...ORG_VARIABLE_MUTATE_CAPABILITIES,
	...TAG_MUTATE_CAPABILITIES,
	...WORKFLOW_CRUD_CAPABILITIES,
	...TRIGGER_MUTATE_CAPABILITIES,
	...TRIGGER_TAG_CAPABILITIES,
	...TRIGGER_ACTIVATION_CAPABILITIES,
	...TEMPLATE_MUTATE_CAPABILITIES,
	...TEMPLATE_CLONE_CAPABILITIES,
	...WORKING_SCOPE_CAPABILITIES,
	...JINJA_DOCS_CAPABILITIES,
	...CRATE_CAPABILITIES,
	crateUnpackCapability,
	workflowImpactCapability,
	workflowLintCapability,
	saveWorkflowInputProfileCapability,
	listWorkflowInputProfilesCapability,
	deleteWorkflowInputProfileCapability,
	graphqlMutateCapability,
	resultReadCapability,
];

const BY_NAME = new Map(CAPABILITY_REGISTRY.map(capability => [capability.spec.name, capability]));
const HOST_CAPABILITIES = new WeakSet<Capability>();
export type HostCapabilityRunner = (
	capability: Capability,
	input: Record<string, unknown>,
	context: import('./Capability').CapabilityContext,
) => Promise<string>;
const hostRunner = new AsyncLocalStorage<HostCapabilityRunner>();

if (BY_NAME.size !== CAPABILITY_REGISTRY.length) {
	throw new Error('CAPABILITY_REGISTRY contains duplicate capability names');
}

/** A capability by tool name, or undefined if no capability owns that name. */
export function getCapability(name: string): Capability | undefined {
	return BY_NAME.get(name);
}

/** Capabilities exposed on the MCP server surface. */
export function mcpCapabilities(): Capability[] {
	return CAPABILITY_REGISTRY;
}

/** Run a capability call with an editor-specific host runner in scope. */
export function runWithHostCapabilityRunner<T>(runner: HostCapabilityRunner, fn: () => Promise<T>): Promise<T> {
	return hostRunner.run(runner, fn);
}

/** Execute host-registered capabilities through the active editor runner. */
export function runCapability(
	capability: Capability,
	input: Record<string, unknown>,
	context: import('./Capability').CapabilityContext,
): Promise<string> {
	const runner = hostRunner.getStore();
	return runner && HOST_CAPABILITIES.has(capability)
		? runner(capability, input, context)
		: capability.run(input, context);
}

/** Whether a capability was supplied by an embedding editor host. */
export function isHostCapability(capability: Capability): boolean {
	return HOST_CAPABILITIES.has(capability);
}

const catalogEvents = new EventEmitter();
catalogEvents.setMaxListeners(0);
/** Observe additions and removals of editor-provided tools. */
export function onCapabilityCatalogChanged(listener: () => void): () => void {
	catalogEvents.on('change', listener);
	return () => {
		catalogEvents.off('change', listener);
	};
}

/** Optional editor surface supplied by an embedding host; absent in the CLI. */
export function registerHostCapabilities(capabilities: readonly Capability[]): () => void {
	const names = new Set<string>();
	for (const capability of capabilities) {
		const name = capability.spec.name;
		if (BY_NAME.has(name) || names.has(name)) throw new Error(`Duplicate capability: ${name}`);
		names.add(name);
	}
	for (const capability of capabilities) {
		BY_NAME.set(capability.spec.name, capability);
		CAPABILITY_REGISTRY.push(capability);
		HOST_CAPABILITIES.add(capability);
	}
	if (capabilities.length) catalogEvents.emit('change');
	return () => {
		let changed = false;
		for (const capability of capabilities) {
			if (BY_NAME.get(capability.spec.name) !== capability) continue;
			changed = true;
			BY_NAME.delete(capability.spec.name);
			const index = CAPABILITY_REGISTRY.indexOf(capability);
			if (index >= 0) CAPABILITY_REGISTRY.splice(index, 1);
		}
		if (changed) catalogEvents.emit('change');
	};
}
