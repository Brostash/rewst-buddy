import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileStateStore, EncryptedSecretStore } from '../src/storage';

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function directory() {
	const path = await mkdtemp(join(tmpdir(), 'rewst-storage-'));
	directories.push(path);
	return path;
}

describe('standalone storage', () => {
	it('persists independent queued updates across a restart', async () => {
		const path = join(await directory(), 'state.json');
		const state = await FileStateStore.open(path);
		await Promise.all([state.update('one', 1), state.update('two', { id: 2 })]);
		const restored = await FileStateStore.open(path);
		expect(restored.get('one')).toBe(1);
		expect(restored.get('two')).toEqual({ id: 2 });
	});

	it('stores encrypted credentials and restores them only with the same passphrase', async () => {
		const path = join(await directory(), 'secrets.json');
		const secrets = await EncryptedSecretStore.open(path, 'test passphrase');
		await secrets.store('user', 'private-session-cookie');
		expect(await readFile(path, 'utf8')).not.toContain('private-session-cookie');
		const restored = await EncryptedSecretStore.open(path, 'test passphrase');
		expect(await restored.get('user')).toBe('private-session-cookie');
		await expect(EncryptedSecretStore.open(path, 'wrong')).rejects.toThrow();
	});

	it('does not silently overwrite an unreadable state file', async () => {
		const { writeFile } = await import('node:fs/promises');
		const path = join(await directory(), 'state.json');
		await writeFile(path, '{corrupt');
		await expect(FileStateStore.open(path)).rejects.toThrow();
		expect(await readFile(path, 'utf8')).toBe('{corrupt');
	});
});
