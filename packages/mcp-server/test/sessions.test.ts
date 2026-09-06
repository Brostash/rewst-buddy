import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureRuntimeHost, type RuntimeHost } from '../src/host';
import { SessionManager } from '../src/sessions/SessionManager';
import Session from '../src/sessions/Session';
import type { Sdk } from '../src/sessions/graphql/sdk';
import type SessionProfile from '../src/sessions/SessionProfile';
import type { RegionConfig } from '../src/sessions/RegionConfig';

const region: RegionConfig = {
	name: 'Test',
	cookieName: 'appSession',
	graphqlUrl: 'https://api.example.test/graphql',
	loginUrl: 'https://app.example.test',
};

function hostWithState(initial: Record<string, unknown> = {}, requestToken?: () => Promise<string>): RuntimeHost {
	const state = new Map(Object.entries(initial));
	const secrets = new Map<string, string>();
	const getState = ((key: string, fallback?: unknown) =>
		state.has(key) ? state.get(key) : fallback) as RuntimeHost['state']['get'];
	configureRuntimeHost({
		state: {
			get: getState,
			update: async (key, value) => {
				state.set(key, value);
			},
		},
		secrets: {
			get: async key => secrets.get(key),
			store: async (key, value) => {
				secrets.set(key, value);
			},
			delete: async key => {
				secrets.delete(key);
			},
		},
		getSetting: (_key, fallback) => fallback,
		log: () => {},
		requestToken,
	});
	return {
		state: {
			get: getState,
			update: async (key, value) => {
				state.set(key, value);
			},
		},
		secrets: {
			get: async key => secrets.get(key),
			store: async (key, value) => {
				secrets.set(key, value);
			},
			delete: async key => {
				secrets.delete(key);
			},
		},
		getSetting: (_key, fallback) => fallback,
		log: () => {},
		requestToken,
	};
}

function makeSdk(user: Record<string, unknown>): Sdk {
	return { User: vi.fn().mockResolvedValue({ user }) } as unknown as Sdk;
}

function makeUser() {
	return {
		id: 'user-1',
		username: 'alice',
		roleIds: [],
		organization: {
			id: 'org-root',
			name: 'Root',
			managedAndSubOrgs: [{ id: 'org-sub', name: 'Sub' }],
		},
		allManagedOrgs: [
			{ id: 'org-other', name: 'Other' },
			{ id: 'org-sub', name: 'Sub' },
		],
	};
}

describe('standalone sessions', () => {
	beforeEach(() => {
		SessionManager._resetForTesting();
		vi.restoreAllMocks();
	});

	it('creates a host-backed session and indexes the managed-org union', async () => {
		hostWithState();
		const sdk = makeSdk(makeUser());
		vi.spyOn(Session, 'newSdk').mockResolvedValue([sdk, region, { value: 'appSession=cookie' } as never]);

		const session = await SessionManager.createSession('cookie', { persist: false });

		expect(session.profile.user.id).toBe('user-1');
		expect(session.profile.allManagedOrgs.map(org => org.id)).toEqual(['org-root', 'org-other', 'org-sub']);
		expect(SessionManager.getActiveSessions()).toEqual([session]);
		expect(await SessionManager.getSessionForOrg('org-other')).toBe(session);
	});

	it('restores persisted profiles through the host stores', async () => {
		const user = makeUser();
		const profile: SessionProfile = {
			region,
			org: { id: 'org-root', name: 'Root' },
			allManagedOrgs: [
				{ id: 'org-root', name: 'Root' },
				{ id: 'org-sub', name: 'Sub' },
			],
			label: 'alice (Root)',
			user: user as never,
		};
		const runtime = hostWithState({ SessionProfiles: [profile] });
		await runtime.secrets.store('user-1', 'appSession=restored');
		const sdk = makeSdk(user);
		vi.spyOn(Session, 'newSdk').mockResolvedValue([sdk, region, { value: 'appSession=restored' } as never]);

		const sessions = await SessionManager.loadSessions();

		expect(sessions).toHaveLength(1);
		expect(sessions[0].profile.user.id).toBe('user-1');
	});

	it('rejects token creation when the host cannot prompt', async () => {
		hostWithState();
		await expect(SessionManager.createSession()).rejects.toThrow('No token prompt is available');
	});

	it('delegates token creation to the host requestToken callback', async () => {
		const requestToken = vi.fn(async () => 'token-from-host');
		hostWithState({}, requestToken);
		const sdk = makeSdk(makeUser());
		vi.spyOn(Session, 'newSdk').mockResolvedValue([sdk, region, { value: 'appSession=token-from-host' } as never]);

		await SessionManager.createSession();

		expect(requestToken).toHaveBeenCalledOnce();
		expect(Session.newSdk).toHaveBeenCalledWith('token-from-host');
	});

	it('refreshes and persists a new cookie after the login endpoint rotates it', async () => {
		const runtime = hostWithState();
		await runtime.secrets.store('user-1', 'appSession=old');
		const user = makeUser();
		const oldSdk = makeSdk(user);
		const refreshedSdk = makeSdk(user);
		const profile: SessionProfile = {
			region,
			org: { id: 'org-root', name: 'Root' },
			allManagedOrgs: [{ id: 'org-root', name: 'Root' }],
			label: 'alice (Root)',
			user: user as never,
		};
		const session = new Session(oldSdk, profile);
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(null, {
						status: 200,
						headers: { 'set-cookie': 'appSession=fresh' },
					}),
			),
		);
		const internals = Session as unknown as { newSdkAtRegion: (...args: unknown[]) => Sdk };
		vi.spyOn(internals, 'newSdkAtRegion').mockReturnValue(refreshedSdk);

		await session.refreshToken();

		expect(session.sdk).toBe(refreshedSdk);
		expect(await runtime.secrets.get('user-1')).toBe('appSession=fresh');
		vi.unstubAllGlobals();
	});

	it('emits expiry after repeated refresh failures and calls the host hook', async () => {
		const expired = vi.fn();
		const state = hostWithState();
		configureRuntimeHost({ ...state, sessionExpired: expired });
		const profile: SessionProfile = {
			region,
			org: { id: 'org-root', name: 'Root' },
			allManagedOrgs: [{ id: 'org-root', name: 'Root' }],
			label: 'alice (Root)',
			user: makeUser() as never,
		};
		const session = new Session(makeSdk(makeUser()), profile);
		const onExpired = vi.fn();
		session.onExpired(onExpired);

		await expect(session.refreshToken()).rejects.toThrow('no token found');
		await expect(session.refreshToken()).rejects.toThrow('no token found');
		await expect(session.refreshToken()).rejects.toThrow('no token found');

		expect(session.isExpired()).toBe(true);
		expect(onExpired).toHaveBeenCalledOnce();
		expect(expired).toHaveBeenCalledWith('alice (Root)');
	});
});

it('contains no editor-runtime imports in the package session runtime', async () => {
	const fs = await import('node:fs/promises');
	const path = await import('node:path');
	const root = path.resolve(import.meta.dirname, '../src/sessions');
	const files: string[] = [];
	async function collect(dir: string): Promise<void> {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) await collect(full);
			else if (entry.name.endsWith('.ts')) files.push(full);
		}
	}
	await collect(root);
	for (const file of files) {
		expect(await fs.readFile(file, 'utf8')).not.toMatch(/(?:from\s+|import\s*\()(['"])vscode\1/);
	}
});
