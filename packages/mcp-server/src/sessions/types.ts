import type Session from './Session';
import type SessionProfile from './SessionProfile';

/** The organization shape shared by session profiles and org indexes. */
export interface Org {
	id: string;
	name: string;
}

export type ChangeType = 'added' | 'removed' | 'cleared' | 'saved';

/** Host-neutral session lifecycle notification. */
export interface SessionChangeEvent {
	type: ChangeType;
	session?: Session;
	allProfiles: SessionProfile[];
	activeProfiles: SessionProfile[];
}
