import { expect, vi } from 'vitest';
import { teardown as afterEach, setup as beforeEach, suite as describe, test as it } from '../test/tdd';
import type SessionProfile from './SessionProfile';
import { SessionManager } from './SessionManager';
import { SessionTreeDataProvider } from '../ui/webview/SessionTreeDataProvider';

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	executeCommand: vi.fn(async () => undefined),
	listeners: new Set<(event: unknown) => void>(),
}));

vi.mock('../backend/operations', () => ({
	invoke: mocks.invoke,
	subscribe: (listener: (event: unknown) => void) => {
		mocks.listeners.add(listener);
		return { dispose: () => mocks.listeners.delete(listener) };
	},
}));
vi.mock('@global', () => ({ extPrefix: 'rewst-buddy' }));
vi.mock('@sessions', async () => ({ SessionManager: (await import('./SessionManager')).SessionManager }));
vi.mock('vscode', () => {
	class EventEmitter<T> {
		private listeners = new Set<(event: T) => void>();
		readonly event = (listener: (event: T) => void) => {
			this.listeners.add(listener);
			return { dispose: () => this.listeners.delete(listener) };
		};
		fire(event: T): void {
			for (const listener of this.listeners) listener(event);
		}
		dispose(): void {
			this.listeners.clear();
		}
	}
	return {
		default: {
			EventEmitter,
			commands: { executeCommand: mocks.executeCommand },
			TreeItem: class {},
			TreeItemCollapsibleState: { None: 0 },
			ThemeIcon: class {},
			MarkdownString: class {},
		},
	};
});

function profile(userId = 'user-1'): SessionProfile {
	return {
		user: { id: userId } as SessionProfile['user'],
		org: { id: 'org-1', name: 'Organization' },
		allManagedOrgs: [{ id: 'org-1', name: 'Organization' }],
		label: userId,
		region: {
			name: 'Test',
			cookieName: 'appSession',
			loginUrl: 'https://app.example.test',
			graphqlUrl: 'https://api.example.test/graphql',
		},
	};
}

function publish(sessions: { sessionId: string; profile: SessionProfile; expired: boolean }[]): void {
	for (const listener of mocks.listeners)
		listener({ type: 'sessions', snapshot: { sessions, knownProfiles: sessions.map(value => value.profile) } });
}

describe('editor session snapshots', () => {
	beforeEach(() => {
		SessionManager.dispose();
		SessionManager._resetForTesting();
		mocks.invoke.mockReset();
		mocks.executeCommand.mockClear();
	});
	afterEach(() => SessionManager.dispose());

	it('publishes restored profiles to the tree when an existing owner sends no new session event', async () => {
		const active = profile();
		const expired = profile('expired-user');
		mocks.invoke.mockResolvedValue({
			sessions: [
				{ sessionId: active.user.id, profile: active, expired: false },
				{ sessionId: expired.user.id, profile: expired, expired: true },
			],
			knownProfiles: [active, expired],
		});
		const tree = new SessionTreeDataProvider();
		try {
			SessionManager.init();
			await SessionManager.loadSessions();
			expect(SessionManager.getActiveSessions()).toHaveLength(1);
			expect((await tree.getChildren()).map(item => ({ id: item.profile.user.id, active: item.active }))).toEqual(
				[
					{ id: 'user-1', active: true },
					{ id: 'expired-user', active: false },
				],
			);
		} finally {
			tree.dispose();
		}
	});

	it('updates menu availability as snapshots add and remove the last active session', async () => {
		const active = { sessionId: 'user-1', profile: profile(), expired: false };
		mocks.invoke.mockResolvedValue({ sessions: [active], knownProfiles: [active.profile] });
		SessionManager.init();
		await SessionManager.loadSessions();
		expect(mocks.executeCommand).toHaveBeenLastCalledWith('setContext', 'rewst-buddy.anyActiveSessions', true);

		publish([{ ...active, expired: true }]);
		expect(mocks.executeCommand).toHaveBeenLastCalledWith('setContext', 'rewst-buddy.anyActiveSessions', false);
		publish([active]);
		expect(mocks.executeCommand).toHaveBeenLastCalledWith('setContext', 'rewst-buddy.anyActiveSessions', true);
		SessionManager.dispose();
		expect(mocks.executeCommand).toHaveBeenLastCalledWith('setContext', 'rewst-buddy.anyActiveSessions', false);
	});
});
