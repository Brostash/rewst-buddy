import vscode from 'vscode';
import { invoke } from '../backend/operations';
import type { FullTemplateFragment, Sdk } from './graphql/sdk';
import type SessionProfile from './SessionProfile';

const SDK_METHODS = new Set([
	'getConversations',
	'getConversation',
	'deleteConversation',
	'createConversationMessageVote',
	'myRoboRewstyPreferences',
	'addAllowedTool',
	'removeAllowedTool',
	'listTemplates',
	'createTemplateMinimal',
	'updateTemplate',
	'updateTemplateBody',
	'updateTemplateName',
	'getTemplate',
	'deleteTemplate',
	'User',
]);

export interface SessionSnapshot {
	sessionId: string;
	profile: SessionProfile;
	expired: boolean;
}

function profileSessionId(profile: SessionProfile): string {
	const id = profile.user.id;
	if (typeof id !== 'string' || id.length === 0) throw new Error('Session profile has no user id.');
	return id;
}

function sdkProxy(sessionId: string): Sdk {
	return new Proxy(Object.create(null) as Sdk, {
		get(_target, property: string | symbol) {
			if (typeof property !== 'string' || !SDK_METHODS.has(property)) return undefined;
			return (args?: unknown) =>
				invoke(`session.sdk.${property}`, {
					sessionId,
					...(args === undefined ? {} : { args }),
				});
		},
	}) as Sdk;
}

/** Lightweight editor-side handle; authenticated work runs in the backend. */
/** Structural editor-safe view of a trusted backend session. */
export interface Session {
	sdk: Sdk | undefined;
	profile: SessionProfile;
	readonly sessionId?: string;
	readonly onExpired: vscode.Event<Session>;
	isExpired(): boolean;
	validate(): Promise<boolean>;
	ensureValid(): Promise<boolean>;
	refreshToken(): Promise<void>;
	getTemplate(templateId: string): Promise<FullTemplateFragment>;
}

class EditorSession implements Session {
	private expired: boolean;
	private readonly expiredEmitter = new vscode.EventEmitter<Session>();
	readonly onExpired = this.expiredEmitter.event;
	readonly sessionId?: string;

	constructor(
		public sdk: Sdk | undefined,
		public profile: SessionProfile,
		sessionId?: string,
		expired = false,
	) {
		this.sessionId = sessionId ?? profile.user.id ?? undefined;
		this.expired = expired;
		if (!this.sdk && this.sessionId) this.sdk = sdkProxy(this.sessionId);
	}

	static fromSnapshot(snapshot: SessionSnapshot): Session {
		return new EditorSession(undefined, snapshot.profile, snapshot.sessionId, snapshot.expired);
	}

	_applySnapshot(snapshot: SessionSnapshot): void {
		this.profile = snapshot.profile;
		if (snapshot.expired && !this.expired) this.expiredEmitter.fire(this);
		this.expired = snapshot.expired;
	}

	isExpired(): boolean {
		return this.expired;
	}

	private requireId(): string {
		if (!this.sessionId) throw new Error('Session has no user id.');
		return this.sessionId;
	}

	async validate(): Promise<boolean> {
		const valid = await invoke<boolean>('session.validate', { sessionId: this.requireId() });
		this.expired = !valid;
		return valid;
	}

	async ensureValid(): Promise<boolean> {
		const valid = await invoke<boolean>('session.ensureValid', { sessionId: this.requireId() });
		this.expired = !valid;
		return valid;
	}

	async refreshToken(): Promise<void> {
		const refreshed = await invoke<SessionSnapshot>('session.refresh', { sessionId: this.requireId() });
		this._applySnapshot(refreshed);
	}

	async getTemplate(templateId: string): Promise<FullTemplateFragment> {
		return invoke('session.getTemplate', { sessionId: this.requireId(), templateId });
	}
}

export const Session: {
	new (sdk: Sdk | undefined, profile: SessionProfile, sessionId?: string, expired?: boolean): Session;
	fromSnapshot(snapshot: SessionSnapshot): Session;
} = EditorSession;
export default Session;
