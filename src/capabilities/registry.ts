import { registerHostCapabilities } from '../../packages/mcp-server/src/capabilities/registry';
import type { Capability as BackendCapability } from '../../packages/mcp-server/src/capabilities/Capability';
import { Session } from '@sessions';
import type { SessionProfile } from '@sessions';
import type { Capability, CapabilityContext } from './EditorCapability';
import { TEMPLATE_LINK_CAPABILITIES } from './templateLinkCapabilities';
import { TEMPLATE_SYNC_CAPABILITIES } from './templateSyncCapabilities';
import { WORKSPACE_CHAT_CAPABILITIES } from './chatToolCapabilities';

/** Capabilities that require the embedding editor host to perform local work. */
export const OPTIONAL_EDITOR_CAPABILITIES: readonly Capability[] = [
	...TEMPLATE_LINK_CAPABILITIES,
	...TEMPLATE_SYNC_CAPABILITIES,
	...WORKSPACE_CHAT_CAPABILITIES,
];

/** Context shipped by the standalone server when it asks the editor to run a capability. */
export interface EditorCapabilityRequestContext {
	orgId: string;
	profile?: SessionProfile;
	profiles: SessionProfile[];
}

function editorSession(profile: SessionProfile): Session {
	return new Session(undefined, profile, profile.user.id ?? undefined);
}

/** Run one of the explicitly exported optional editor capabilities. */
export function runOptionalEditorCapability(
	capability: Capability,
	input: Record<string, unknown>,
	context: EditorCapabilityRequestContext,
): Promise<string> {
	const session = context.profile ? editorSession(context.profile) : undefined;
	const sessions = context.profiles.map(editorSession);
	return capability.run(input, {
		orgId: context.orgId,
		session: session!,
		sessions,
	} satisfies CapabilityContext);
}

/**
 * Importing this module installs the editor's optional surface for the embedded
 * fallback server. The standalone package never imports this module, and so has
 * no editor tools. The private shared-server bridge uses the raw catalog above
 * and runOptionalEditorCapability instead of this registry mutation.
 */
registerHostCapabilities(
	OPTIONAL_EDITOR_CAPABILITIES.map(
		capability =>
			({
				...capability,
				async run(input, ctx) {
					const profile = ctx.session?.profile;
					return runOptionalEditorCapability(capability, input, {
						orgId: ctx.orgId,
						profile: profile as SessionProfile | undefined,
						profiles: ctx.sessions.map(session => session.profile as SessionProfile),
					});
				},
			}) satisfies BackendCapability,
	),
);

export {
	CAPABILITY_REGISTRY,
	getCapability,
	mcpCapabilities,
} from '../../packages/mcp-server/src/capabilities/registry';
