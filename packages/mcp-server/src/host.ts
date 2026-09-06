/** Host services supplied by a standalone process or the embedding application. */
export interface StateStore {
	get<T>(key: string, fallback: T): T;
	get<T>(key: string): T | undefined;
	update(key: string, value: unknown): PromiseLike<void>;
}

export interface SecretStore {
	get(key: string): PromiseLike<string | undefined>;
	store(key: string, value: string): PromiseLike<void>;
	delete(key: string): PromiseLike<void>;
}

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface RuntimeHost {
	state: StateStore;
	secrets: SecretStore;
	getSetting<T>(key: string, fallback: T): T;
	log(level: LogLevel, message: string, ...details: unknown[]): void;
	notify?(level: 'info' | 'warn' | 'error', message: string): void;
	requestToken?(): Promise<string>;
	sessionExpired?(label: string): void;
	templateChanged?(template: { id: string; name: string; updatedAt?: string | null }): void;
}

let configuredHost: RuntimeHost | undefined;

export function configureRuntimeHost(host: RuntimeHost): void {
	configuredHost = host;
}

export function getRuntimeHost(): RuntimeHost {
	if (!configuredHost) throw new Error('Rewst Buddy runtime has not been initialized');
	return configuredHost;
}

export const context = {
	get globalState(): StateStore {
		return getRuntimeHost().state;
	},
	get secrets(): SecretStore {
		return getRuntimeHost().secrets;
	},
};

function emit(level: LogLevel, message: string, ...details: unknown[]): void {
	getRuntimeHost().log(level, message, ...details);
}

function error(message: string, cause?: unknown, ...details: unknown[]): Error {
	emit('error', message, cause, ...details);
	return new Error(
		cause === undefined ? message : `${message} ${cause instanceof Error ? cause.message : String(cause)}`,
	);
}

export const log = {
	trace: (message: string, ...details: unknown[]) => emit('trace', message, ...details),
	debug: (message: string, ...details: unknown[]) => emit('debug', message, ...details),
	info: (message: string, ...details: unknown[]) => emit('info', message, ...details),
	warn: (message: string, ...details: unknown[]) => emit('warn', message, ...details),
	error,
	notifyInfo(message: string, ...details: unknown[]): void {
		emit('info', message, ...details);
		getRuntimeHost().notify?.('info', message);
	},
	notifyWarn(message: string, ...details: unknown[]): void {
		emit('warn', message, ...details);
		getRuntimeHost().notify?.('warn', message);
	},
	notifyError(message: string, cause?: unknown, ...details: unknown[]): Error {
		const result = error(message, cause, ...details);
		getRuntimeHost().notify?.('error', result.message);
		return result;
	},
};

export interface Disposable {
	dispose(): void;
}

/** Small host-neutral event source with the same subscription shape as editor events. */
export class EventEmitter<T> implements Disposable {
	private readonly listeners = new Set<(event: T) => unknown>();
	readonly event = (listener: (event: T) => unknown, thisArg?: unknown, disposables?: Disposable[]): Disposable => {
		const bound = (event: T) => listener.call(thisArg, event);
		this.listeners.add(bound);
		const disposable = {
			dispose: () => {
				this.listeners.delete(bound);
			},
		};
		disposables?.push(disposable);
		return disposable;
	};
	fire(event: T): void {
		for (const listener of [...this.listeners]) listener(event);
	}
	dispose(): void {
		this.listeners.clear();
	}
}
