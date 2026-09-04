import type { Org } from '../../packages/mcp-server/src/sessions/types';
import type { UserFragment } from './graphql/sdk';
import type { RegionConfig } from './RegionConfig';

export default interface SessionProfile {
	region: RegionConfig;
	org: Org;
	allManagedOrgs: Org[];
	label: string;
	user: UserFragment;
} // commands/index.ts
