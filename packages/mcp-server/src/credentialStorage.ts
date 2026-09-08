import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import type { SecretStore } from './host';
import { EncryptedSecretStore, FileStateStore } from './storage';

const STORAGE_ERROR =
	'Secure credential storage is unavailable or locked. Unlock your OS credential store (Linux requires secret-tool and a Secret Service), or configure REWST_BUDDY_PASSPHRASE with a separate --state-dir for headless use.';

export interface VaultKey {
	get(): Promise<string | undefined>;
	set(value: string): Promise<void>;
}

/** Keep secrets out of command arguments and discard backend diagnostics. */
function secretTool(args: string[], input?: string): Promise<string | undefined> {
	return new Promise((resolve, reject) => {
		const child = spawn('secret-tool', args, { stdio: ['pipe', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(STORAGE_ERROR));
		}, 30_000);
		child.stdout.setEncoding('utf8').on('data', chunk => {
			stdout += chunk;
		});
		child.stderr.setEncoding('utf8').on('data', chunk => {
			stderr += chunk;
		});
		child.on('error', () => {
			clearTimeout(timer);
			reject(new Error(STORAGE_ERROR));
		});
		child.stdin.on('error', () => {});
		child.on('close', code => {
			clearTimeout(timer);
			if (code === 0) resolve(stdout.trim() || undefined);
			else if (input === undefined && code === 1 && !stderr && !stdout) resolve(undefined);
			else reject(new Error(STORAGE_ERROR));
		});
		child.stdin.end(input);
	});
}

export function osVaultKey(directory: string): VaultKey {
	const account = createHash('sha256').update(directory).digest('hex');
	const service = 'rewst-buddy-mcp';
	// Use Secret Service explicitly: kernel keyrings can disappear at logout.
	if (process.platform === 'linux') {
		const attributes = ['service', service, 'account', account];
		return {
			get: () => secretTool(['lookup', ...attributes]),
			set: async value => {
				await secretTool(['store', '--label=Rewst Buddy MCP vault', ...attributes], value);
			},
		};
	}
	const entry = async () => {
		if (process.platform !== 'darwin' && process.platform !== 'win32') throw new Error(STORAGE_ERROR);
		const { AsyncEntry } = await import('@napi-rs/keyring');
		return new AsyncEntry(service, account);
	};
	return {
		get: async () => (await entry()).getPassword(),
		set: async value => {
			await (await entry()).setPassword(value);
		},
	};
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}

/** Delay the OS prompt until credentials are needed, so offline tool listing still works. */
class OsEncryptedStore implements SecretStore {
	private vault?: Promise<EncryptedSecretStore>;
	constructor(
		private readonly path: string,
		private readonly key: VaultKey,
		private readonly existing: boolean,
	) {}
	async open(): Promise<EncryptedSecretStore> {
		if (!this.vault) {
			this.vault = (async () => {
				let password: string | undefined;
				try {
					password = await this.key.get();
					if (!password) {
						if (this.existing) throw new Error(STORAGE_ERROR);
						password = randomBytes(32).toString('base64');
						await this.key.set(password);
						if ((await this.key.get()) !== password) throw new Error(STORAGE_ERROR);
					}
				} catch {
					throw new Error(STORAGE_ERROR);
				}
				return EncryptedSecretStore.open(this.path, password);
			})();
			// Permit retry after an unlock, while never replacing an existing vault's key.
			this.vault.catch(() => {
				this.vault = undefined;
			});
		}
		return this.vault;
	}
	async get(key: string): Promise<string | undefined> {
		if (!this.existing && !this.vault) return undefined;
		return (await this.open()).get(key);
	}
	async store(key: string, value: string): Promise<void> {
		await (await this.open()).store(key, value);
	}
	async delete(key: string): Promise<void> {
		if (this.existing || this.vault) await (await this.open()).delete(key);
	}
	async flush(): Promise<void> {
		if (this.vault) await (await this.vault).flush();
	}
}

/** One writer owns both metadata and the vault, including during login. */
export async function openCredentialStorage(stateDir: string, passphrase?: string, keyFactory = osVaultKey) {
	await mkdir(stateDir, { recursive: true, mode: 0o700 });
	const directory = await realpath(stateDir);
	let compromised = false;
	let closed = false;
	let release: () => Promise<void>;
	try {
		release = await lockfile.lock(directory, {
			onCompromised: () => {
				compromised = true;
			},
		});
	} catch {
		throw new Error(
			'Session storage is in use. Stop the other owner or login process, or choose another --state-dir.',
		);
	}
	try {
		const legacyPath = join(directory, 'credentials.enc');
		const osPath = join(directory, 'credentials.os.enc');
		if (!passphrase && (await exists(legacyPath)))
			throw new Error(
				'Encrypted credentials were found; set REWST_BUDDY_PASSPHRASE or choose a different --state-dir before starting.',
			);
		if (passphrase && (await exists(osPath)))
			throw new Error(
				'OS-protected credentials were found; remove REWST_BUDDY_PASSPHRASE or choose a different --state-dir.',
			);
		const osExists = await exists(osPath);
		const secrets = passphrase
			? await EncryptedSecretStore.open(legacyPath, passphrase)
			: new OsEncryptedStore(osPath, keyFactory(directory), osExists);
		if (secrets instanceof OsEncryptedStore && osExists) await secrets.open();
		const state = await FileStateStore.open(join(directory, 'state.json'));
		const check = () => {
			if (closed) throw new Error('Session storage is closed');
			if (compromised)
				throw new Error('Session storage lock was lost. Restart the server before changing sessions.');
		};
		return {
			state: {
				get: state.get.bind(state),
				update: async (key: string, value: unknown) => {
					check();
					await state.update(key, value);
				},
			},
			secrets: {
				get: async (key: string) => {
					check();
					return secrets.get(key);
				},
				store: async (key: string, value: string) => {
					check();
					await secrets.store(key, value);
				},
				delete: async (key: string) => {
					check();
					await secrets.delete(key);
				},
			},
			close: async () => {
				if (closed) return;
				closed = true;
				try {
					await Promise.all([state.flush(), secrets.flush()]);
				} finally {
					await release();
				}
			},
		};
	} catch (error) {
		await release();
		throw error;
	}
}
