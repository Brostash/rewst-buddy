import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import lockfile from 'proper-lockfile';
import { openCredentialStorage, type VaultKey } from '../src/credentialStorage';

const directories: string[] = [];
const stores: Awaited<ReturnType<typeof openCredentialStorage>>[] = [];
afterEach(async () => {
	await Promise.all(stores.splice(0).map(store => store.close()));
	await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function directory() {
	const path = await mkdtemp(join(tmpdir(), 'rewst-vault-'));
	directories.push(path);
	return path;
}
function keychain() {
	const keys = new Map<string, string>();
	return vi.fn(
		(directory: string): VaultKey => ({
			get: async () => keys.get(directory),
			set: async value => {
				keys.set(directory, value);
			},
		}),
	);
}
async function open(path: string, factory = keychain(), passphrase?: string) {
	const store = await openCredentialStorage(path, passphrase, factory);
	stores.push(store);
	return store;
}
async function close(store: (typeof stores)[number]) {
	stores.splice(stores.indexOf(store), 1);
	await store.close();
}

describe('default secure credential persistence', () => {
	it('restores, rotates and deletes credentials with no plaintext secret or key on disk', async () => {
		const dir = await directory();
		const factory = keychain();
		const first = await open(dir, factory);
		await first.secrets.store('user', 'original-cookie');
		await first.state.update('SessionProfiles', [{ user: { id: 'user' } }]);
		await close(first);
		const second = await open(dir, factory);
		expect(await second.secrets.get('user')).toBe('original-cookie');
		expect(second.state.get('SessionProfiles')).toEqual([{ user: { id: 'user' } }]);
		await second.secrets.store('user', 'rotated-cookie');
		await close(second);
		const third = await open(dir, factory);
		expect(await third.secrets.get('user')).toBe('rotated-cookie');
		const password = await factory(dir).get();
		for (const file of await readdir(dir)) {
			const text = await readFile(join(dir, file), 'utf8');
			expect(text).not.toMatch(/original-cookie|rotated-cookie/);
			expect(text).not.toContain(password);
			if (process.platform !== 'win32') expect((await stat(join(dir, file))).mode & 0o777).toBe(0o600);
		}
		await third.secrets.delete('user');
		await close(third);
		expect(await (await open(dir, factory)).secrets.get('user')).toBeUndefined();
	});

	it('does not require an OS store for offline tool listing but rejects saving when locked', async () => {
		const dir = await directory();
		const get = vi.fn(async () => {
			throw new Error('backend-private-details');
		});
		const set = vi.fn();
		const store = await open(dir, () => ({ get, set }));
		expect(await store.secrets.get('missing')).toBeUndefined();
		expect(get).not.toHaveBeenCalled();
		await expect(store.secrets.store('user', 'sensitive-cookie')).rejects.toThrow(/Secure credential storage/);
		expect(set).not.toHaveBeenCalled();
		expect(await readdir(dir)).toEqual([]);
	});

	it('preserves existing files and never replaces a missing or locked OS key', async () => {
		const dir = await directory();
		const first = await open(dir);
		await first.secrets.store('user', 'cookie');
		await first.state.update('SessionProfiles', ['keep']);
		await close(first);
		const before = await readFile(join(dir, 'credentials.os.enc'), 'utf8');
		for (const get of [
			async () => undefined,
			async () => {
				throw new Error('locked');
			},
		]) {
			const set = vi.fn();
			await expect(open(dir, () => ({ get, set }))).rejects.toThrow(/Secure credential storage/);
			expect(set).not.toHaveBeenCalled();
			expect(await readFile(join(dir, 'credentials.os.enc'), 'utf8')).toBe(before);
			expect(await readFile(join(dir, 'state.json'), 'utf8')).toContain('keep');
		}
	});

	it('keeps passphrase vaults compatible and rejects accidental backend changes', async () => {
		const dir = await directory();
		const factory = vi.fn(() => {
			throw new Error('OS store must not be used');
		});
		const first = await open(dir, factory, 'operator-passphrase');
		await first.secrets.store('user', 'cookie');
		await close(first);
		await expect(open(dir)).rejects.toThrow(/Encrypted credentials were found/);
		await expect(open(dir, factory, 'wrong')).rejects.toThrow();
		expect(await (await open(dir, factory, 'operator-passphrase')).secrets.get('user')).toBe('cookie');
		expect(factory).not.toHaveBeenCalled();
		const osDir = await directory();
		const osStore = await open(osDir);
		await osStore.secrets.store('user', 'cookie');
		await close(osStore);
		await expect(open(osDir, factory, 'passphrase')).rejects.toThrow(/OS-protected credentials/);
	});

	it('isolates directories and prevents simultaneous login/server writers', async () => {
		const dir = await directory();
		const factory = keychain();
		const first = await open(dir, factory);
		await first.secrets.store('user', 'cookie');
		await expect(open(dir, factory)).rejects.toThrow(/storage is in use/);
		const other = await open(await directory(), factory);
		expect(await other.secrets.get('user')).toBeUndefined();
		await close(first);
		expect(await (await open(dir, factory)).secrets.get('user')).toBe('cookie');
	});
});

it('preserves filesystem lock errors instead of reporting contention', async () => {
	const error = Object.assign(new Error('permission denied creating lock directory'), { code: 'EACCES' });
	const lock = vi.spyOn(lockfile, 'lock').mockRejectedValueOnce(error);
	try {
		await expect(open(await directory())).rejects.toBe(error);
	} finally {
		lock.mockRestore();
	}
});

it('keeps the lock until an accepted first credential save finishes during shutdown', async () => {
	const { EncryptedSecretStore } = await import('../src/storage');
	const dir = await directory();
	let unlock!: (value: string) => void;
	const key = new Promise<string>(resolve => {
		unlock = resolve;
	});
	let finishWrite!: () => void;
	const writeGate = new Promise<void>(resolve => {
		finishWrite = resolve;
	});
	let writeStarted!: () => void;
	const started = new Promise<void>(resolve => {
		writeStarted = resolve;
	});
	const originalStore = EncryptedSecretStore.prototype.store;
	const slowStore = vi
		.spyOn(EncryptedSecretStore.prototype, 'store')
		.mockImplementationOnce(async function (name, value) {
			writeStarted();
			await writeGate;
			await originalStore.call(this, name, value);
		});
	const factory = () => ({ get: () => key, set: async () => {} });
	const first = await open(dir, factory);
	const saving = first.secrets.store('user', 'cookie-during-unlock');
	const closing = close(first);
	try {
		await expect(first.secrets.store('another-user', 'too-late')).rejects.toThrow(/closed/);
		unlock('synthetic-master-key');
		await started;
		const outcome = await Promise.race([
			closing.then(() => 'closed'),
			new Promise(resolve => setTimeout(() => resolve('waiting'), 25)),
		]);
		expect(outcome).toBe('waiting');
		await expect(open(dir, factory)).rejects.toThrow(/storage is in use/);
	} finally {
		finishWrite();
		await Promise.all([saving, closing]);
		slowStore.mockRestore();
	}
	const second = await open(dir, factory);
	expect(await second.secrets.get('user')).toBe('cookie-during-unlock');
});
