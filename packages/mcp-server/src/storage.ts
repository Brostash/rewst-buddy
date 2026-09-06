import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SecretStore, StateStore } from './host';

async function readOptional(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw error;
	}
}

function parseRecord(text: string): Record<string, unknown> {
	const data: unknown = JSON.parse(text);
	if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Rewst Buddy state file');
	return data as Record<string, unknown>;
}

async function atomicWrite(path: string, contents: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`;
	try {
		await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' });
		await rename(temporary, path);
	} finally {
		await unlink(temporary).catch(error => {
			if (error.code !== 'ENOENT') throw error;
		});
	}
}

export class MemoryStateStore implements StateStore {
	protected readonly values: Map<string, unknown>;
	constructor(initial: Record<string, unknown> = {}) {
		this.values = new Map(Object.entries(initial));
	}
	get<T>(key: string, fallback: T): T;
	get<T>(key: string): T | undefined;
	get<T>(key: string, fallback?: T): T | undefined {
		return this.values.has(key) ? (this.values.get(key) as T) : fallback;
	}
	async update(key: string, value: unknown): Promise<void> {
		if (value === undefined) this.values.delete(key);
		else this.values.set(key, value);
	}
}

export class FileStateStore extends MemoryStateStore {
	private writes: Promise<void> = Promise.resolve();
	private constructor(
		private readonly path: string,
		initial: Record<string, unknown>,
	) {
		super(initial);
	}
	static async open(path: string): Promise<FileStateStore> {
		const text = await readOptional(path);
		return new FileStateStore(path, text === undefined ? {} : parseRecord(text));
	}
	override async update(key: string, value: unknown): Promise<void> {
		await super.update(key, value);
		const contents = JSON.stringify(Object.fromEntries(this.values));
		const write = this.writes.catch(() => {}).then(() => atomicWrite(this.path, contents));
		this.writes = write;
		await write;
	}
	async flush(): Promise<void> {
		await this.writes;
	}
}

export class MemorySecretStore implements SecretStore {
	protected readonly secrets = new Map<string, string>();
	async get(key: string): Promise<string | undefined> {
		return this.secrets.get(key);
	}
	async store(key: string, value: string): Promise<void> {
		this.secrets.set(key, value);
	}
	async delete(key: string): Promise<void> {
		this.secrets.delete(key);
	}
}

/** Persistent credentials require an operator-provided passphrase, never a key stored beside the vault. */
export class EncryptedSecretStore extends MemorySecretStore {
	private writes: Promise<void> = Promise.resolve();
	private constructor(
		private readonly path: string,
		private readonly key: Buffer,
		private readonly salt: Buffer,
	) {
		super();
	}
	static async open(path: string, passphrase: string): Promise<EncryptedSecretStore> {
		if (!passphrase) throw new Error('A passphrase is required for persistent credential storage');
		const text = await readOptional(path);
		const envelope = text === undefined ? undefined : parseRecord(text);
		if (
			envelope &&
			(envelope.version !== 1 ||
				typeof envelope.salt !== 'string' ||
				typeof envelope.iv !== 'string' ||
				typeof envelope.tag !== 'string' ||
				typeof envelope.data !== 'string')
		) {
			throw new Error('Invalid Rewst Buddy credential vault');
		}
		const salt = envelope ? Buffer.from(envelope.salt as string, 'base64') : randomBytes(16);
		if (salt.length !== 16) throw new Error('Invalid credential vault salt');
		const key = scryptSync(passphrase, salt, 32);
		const store = new EncryptedSecretStore(path, key, salt);
		if (envelope) {
			const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv as string, 'base64'));
			decipher.setAuthTag(Buffer.from(envelope.tag as string, 'base64'));
			const plain = Buffer.concat([
				decipher.update(Buffer.from(envelope.data as string, 'base64')),
				decipher.final(),
			]);
			for (const [name, value] of Object.entries(parseRecord(plain.toString('utf8')))) {
				if (typeof value !== 'string') throw new Error('Invalid credential value in vault');
				store.secrets.set(name, value);
			}
		}
		return store;
	}
	private persist(): Promise<void> {
		const iv = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.key, iv);
		const data = Buffer.concat([
			cipher.update(JSON.stringify(Object.fromEntries(this.secrets)), 'utf8'),
			cipher.final(),
		]);
		const text = JSON.stringify({
			version: 1,
			salt: this.salt.toString('base64'),
			iv: iv.toString('base64'),
			tag: cipher.getAuthTag().toString('base64'),
			data: data.toString('base64'),
		});
		const write = this.writes.catch(() => {}).then(() => atomicWrite(this.path, text));
		this.writes = write;
		return write;
	}
	override async store(key: string, value: string): Promise<void> {
		await super.store(key, value);
		await this.persist();
	}
	override async delete(key: string): Promise<void> {
		await super.delete(key);
		await this.persist();
	}
	async flush(): Promise<void> {
		await this.writes;
	}
}
