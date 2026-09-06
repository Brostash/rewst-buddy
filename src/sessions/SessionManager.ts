import vscode from 'vscode';
import { extPrefix } from '@global';
import { invoke, subscribe } from '../backend/operations';
import type { ChangeType, SessionChangeEvent } from './types';
import EditorSession, { type Session, type SessionSnapshot } from './Session';
import type SessionProfile from './SessionProfile';

type SnapshotResult =
	| SessionSnapshot[]
	| {
			sessions?: SessionSnapshot[];
			snapshot?: SessionSnapshot[];
			knownProfiles?: SessionProfile[];
			changeType?: ChangeType;
	  };
type MutableSession = Session & { _applySnapshot(snapshot: SessionSnapshot): void };

function updateSession(session: Session | undefined, snapshot: SessionSnapshot): void {
	if (!session) return;
	const mutable = session as Partial<MutableSession>;
	if (typeof mutable._applySnapshot === 'function') mutable._applySnapshot(snapshot);
	else session.profile = snapshot.profile;
}

function snapshotsFrom(result: SnapshotResult | undefined): SessionSnapshot[] {
	if (Array.isArray(result)) return result;
	return result?.sessions ?? result?.snapshot ?? [];
}

function knownProfilesFrom(result: SnapshotResult | undefined): SessionProfile[] | undefined {
	return Array.isArray(result) ? undefined : result?.knownProfiles;
}

function profileId(profile: SessionProfile): string {
	return profile.user.id ?? profile.org.id;
}

export const SessionManager = new (class _ implements vscode.Disposable {
	private loadPromise: Promise<Session[]> | undefined;
	private loadedSnapshot = false;
	private backendSubscription: { dispose(): void } | undefined;
	private knownProfilesCache: SessionProfile[] = [];
	private anyActiveSessions = false;
	private readonly sessionChangeEmitter = new vscode.EventEmitter<SessionChangeEvent>();
	readonly onSessionChange = this.sessionChangeEmitter.event;
	readonly sessionMap = new Map<string, Session>();

	init(): _ {
		void vscode.commands.executeCommand('setContext', `${extPrefix}.anyActiveSessions`, this.anyActiveSessions);
		this.attachBackendSubscription();
		void this.loadSessions().catch(error => console.error('SessionManager.init: background load failed', error));
		return this;
	}

	dispose(): void {
		this.backendSubscription?.dispose();
		this.backendSubscription = undefined;
		this.loadPromise = undefined;
		this.loadedSnapshot = false;
		this.setAnyActiveSessions(false);
	}

	private setAnyActiveSessions(value: boolean): void {
		if (this.anyActiveSessions === value) return;
		this.anyActiveSessions = value;
		void vscode.commands.executeCommand('setContext', `${extPrefix}.anyActiveSessions`, value);
	}

	hasActiveSessions(): boolean {
		return this.anyActiveSessions;
	}
	getActiveSessions(): Session[] {
		return [...this.sessionMap.values()];
	}
	getAllKnownProfiles(): SessionProfile[] {
		return this.knownProfilesCache;
	}

	getProfileForOrg(orgId: string): SessionProfile | undefined {
		return this.knownProfilesCache.find(
			profile => profile.org.id === orgId || profile.allManagedOrgs.some(org => org.id === orgId),
		);
	}

	async loadSessions(): Promise<Session[]> {
		if (!this.loadPromise) {
			this.loadPromise = invoke<SnapshotResult>('sessions.load', {})
				.then(result => {
					// An already-running owner need not emit another session event
					// when asked to load. Publish this window's initial snapshot.
					const emit = !this.loadedSnapshot;
					this.loadedSnapshot = true;
					this.applySnapshots(snapshotsFrom(result), emit, knownProfilesFrom(result));
					return this.getActiveSessions();
				})
				.finally(() => {
					this.loadPromise = undefined;
				});
		}
		return this.loadPromise;
	}

	async createSession(cookies?: string, options: { persist?: boolean } = {}): Promise<Session> {
		const result = await invoke<SessionSnapshot>('sessions.create', {
			...(cookies === undefined ? {} : { cookies }),
			...(options.persist === undefined ? {} : { persist: options.persist }),
		});
		this.applySnapshots([result], false, undefined, false);
		return this.sessionMap.get(result.sessionId) ?? EditorSession.fromSnapshot(result);
	}

	async createFromProfile(profile: SessionProfile): Promise<Session> {
		await this.loadSessions();
		return (
			this.sessionMap.get(profileId(profile)) ?? new EditorSession(undefined, profile, profileId(profile), true)
		);
	}

	async getProfileSession(profile: SessionProfile): Promise<Session> {
		return this.getOrgSession(profile.org.id, new URL(profile.region.loginUrl));
	}

	async getOrgSession(orgId: string, baseURL: URL): Promise<Session> {
		const result = await invoke<SessionSnapshot>('sessions.forOrg', { orgId, region: baseURL.toString() });
		this.applySnapshots([result], false, undefined, false);
		const session = this.sessionMap.get(result.sessionId);
		if (!session) throw new Error(`No active session found for organization '${orgId}'.`);
		return session;
	}

	async getSessionForOrg(orgId: string): Promise<Session> {
		const result = await invoke<SessionSnapshot>('sessions.forOrg', { orgId });
		this.applySnapshots([result], false, undefined, false);
		const session = this.sessionMap.get(result.sessionId);
		if (!session) throw new Error(`No active session found for organization '${orgId}'.`);
		return session;
	}

	async clearProfiles(): Promise<void> {
		await invoke('sessions.clear', {});
		this.applySnapshots([], false, [], true);
	}

	async removeSession(userId: string): Promise<void> {
		const result = await invoke<SnapshotResult>('sessions.remove', { sessionId: userId });
		this.applySnapshots(snapshotsFrom(result), false, knownProfilesFrom(result));
	}

	async refreshActiveSessions(): Promise<void> {
		const result = await invoke<SnapshotResult>('sessions.refresh', {});
		this.applySnapshots(snapshotsFrom(result), false, knownProfilesFrom(result));
	}

	_setSessionsForTesting(sessions: Session[], notify = true): void {
		this.sessionMap.clear();
		for (const session of sessions) {
			const id = session.sessionId ?? session.profile.user.id ?? session.profile.org.id;
			this.sessionMap.set(id, session);
		}
		this.knownProfilesCache = sessions.map(session => session.profile);
		this.setAnyActiveSessions(sessions.length > 0);
		if (notify)
			this.sessionChangeEmitter.fire({
				type: 'saved',
				allProfiles: this.knownProfilesCache,
				activeProfiles: sessions.map(session => session.profile),
			});
	}

	_setKnownProfilesForTesting(profiles: SessionProfile[]): void {
		this.knownProfilesCache = profiles;
	}

	_resetForTesting(): void {
		this.sessionMap.clear();
		this.knownProfilesCache = [];
		this.setAnyActiveSessions(false);
		this.loadPromise = undefined;
		this.loadedSnapshot = false;
		this.sessionChangeEmitter.fire({ type: 'cleared', allProfiles: [], activeProfiles: [] });
	}

	private attachBackendSubscription(): void {
		if (this.backendSubscription) return;
		this.backendSubscription = subscribe(event => {
			if (!event || typeof event !== 'object') return;
			const payload = event as { type?: unknown; snapshot?: unknown; changeType?: unknown };
			if (payload.type !== 'sessions') return;
			const result = payload.snapshot as SnapshotResult | undefined;
			if (!Array.isArray(result) && !Array.isArray(result?.sessions)) return;
			const changeType =
				payload.changeType === 'added' ||
				payload.changeType === 'removed' ||
				payload.changeType === 'cleared' ||
				payload.changeType === 'saved'
					? payload.changeType
					: 'saved';
			this.applySnapshots(snapshotsFrom(result), true, knownProfilesFrom(result), true, changeType);
		});
	}

	private applySnapshots(
		snapshots: SessionSnapshot[],
		emit: boolean,
		knownProfiles?: SessionProfile[],
		replaceActive = true,
		changeType: ChangeType = 'saved',
	): void {
		const activeIds = new Set<string>();
		for (const snapshot of snapshots) {
			const id = snapshot.sessionId;
			if (snapshot.expired) {
				updateSession(this.sessionMap.get(id), snapshot);
				this.sessionMap.delete(id);
				continue;
			}
			activeIds.add(id);
			const previous = this.sessionMap.get(id);
			if (previous) updateSession(previous, snapshot);
			else this.sessionMap.set(id, EditorSession.fromSnapshot(snapshot));
		}
		if (replaceActive) {
			for (const id of [...this.sessionMap.keys()]) if (!activeIds.has(id)) this.sessionMap.delete(id);
		}
		if (knownProfiles) this.knownProfilesCache = knownProfiles;
		else if (replaceActive && snapshots.length > 0)
			this.knownProfilesCache = snapshots.map(snapshot => snapshot.profile);
		else if (snapshots.length > 0) {
			const byId = new Map(this.knownProfilesCache.map(profile => [profileId(profile), profile]));
			for (const item of snapshots) byId.set(profileId(item.profile), item.profile);
			this.knownProfilesCache = [...byId.values()];
		}
		this.setAnyActiveSessions(this.sessionMap.size > 0);
		if (emit)
			this.sessionChangeEmitter.fire({
				type: changeType,
				allProfiles: this.knownProfilesCache,
				activeProfiles: this.getActiveSessions().map(session => session.profile),
			});
	}
})();
