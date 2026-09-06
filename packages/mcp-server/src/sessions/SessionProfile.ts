import type { UserFragment } from './graphql/generated/graphql';
import type { Org } from './types';
import type { RegionConfig } from './RegionConfig';

export default interface SessionProfile {
	region: RegionConfig;
	org: Org;
	allManagedOrgs: Org[];
	label: string;
	user: UserFragment;
} // commands/index.ts
