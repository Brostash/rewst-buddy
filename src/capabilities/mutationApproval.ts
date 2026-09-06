import type { CapabilityContext } from './EditorCapability';
export {
	approvalRequiredResult,
	withMutationApproval,
} from '../../packages/mcp-server/src/capabilities/mutationApproval';
export function orgDisplayName(ctx: CapabilityContext): string {
	const { profile } = ctx.session;
	if (profile.org.id === ctx.orgId) return profile.org.name;
	const managed = profile.allManagedOrgs.find(org => org.id === ctx.orgId);
	return managed?.name ?? ctx.orgId;
}
