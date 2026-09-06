import { invoke } from '../../backend/operations';
import { SessionManager as BackendSessions, type Session } from '../../../packages/mcp-server/src/sessions';
import { SessionManager as EditorSessions } from '../../sessions/SessionManager';
export function installMockSessions(sessions: Session[]): void {
	EditorSessions._setSessionsForTesting(sessions, false);
	BackendSessions._setSessionsForTesting(sessions);
}

export function installMockProfiles(
	profiles: import('../../../packages/mcp-server/src/sessions').SessionProfile[],
): void {
	BackendSessions._setKnownProfilesForTesting(profiles);
	EditorSessions._setKnownProfilesForTesting(profiles);
}

/** Wait for seeded session notifications to cross the embedded MCP connection. */
export async function installMockSessionsAndWait(sessions: Session[]): Promise<void> {
	installMockSessions(sessions);
	await invoke('sessions.snapshot', {});
}
