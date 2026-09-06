/** Organization shape is shared with the headless runtime. */
export type { Org } from '../../packages/mcp-server/src/sessions/types';

import type { Session } from './Session';
import type SessionProfile from './SessionProfile';

export type ChangeType = 'added' | 'removed' | 'cleared' | 'saved';

/** Editor lifecycle event carrying the editor facade's structural session. */
export interface SessionChangeEvent {
	type: ChangeType;
	session?: Session;
	allProfiles: SessionProfile[];
	activeProfiles: SessionProfile[];
}
