import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverSharedServer, publishSharedServer, type SharedServerDescriptor } from '../src/sharedDiscovery';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	while (cleanups.length) await cleanups.pop()?.();
});

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as { port: number }).port;
	await new Promise<void>(resolve => server.close(() => resolve()));
	return port;
}

function descriptor(port: number): SharedServerDescriptor {
	return {
		identity: 'rewst-buddy',
		protocol: 1,
		version: 'test',
		instanceId: 'instance',
		port,
		publicToken: 'public',
		editorToken: 'editor',
	};
}

describe('shared discovery', () => {
	it('rejects promptly when a listener disconnects during its response', async () => {
		const listener = createServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.write('{', () => setTimeout(() => res.destroy(), 20));
		});
		await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
		cleanups.push(() => new Promise<void>(resolve => listener.close(() => resolve())));
		const port = (listener.address() as { port: number }).port;
		const dir = await mkdtemp(join(tmpdir(), 'rewst-buddy-discovery-'));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await expect(
				Promise.race([
					discoverSharedServer(port, dir),
					new Promise<never>((_resolve, reject) => {
						timer = setTimeout(() => reject(new Error('Discovery never settled after disconnect')), 1_000);
					}),
				]),
			).rejects.toThrow(/Unable to probe shared Rewst Buddy server/);
		} finally {
			clearTimeout(timer);
		}
	});

	it('returns undefined for a stale record when no listener is present', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'rewst-buddy-discovery-'));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		const port = await freePort();
		await publishSharedServer(descriptor(port), dir);
		expect(await discoverSharedServer(port, dir)).toBeUndefined();
	});

	it('rejects an unknown listener instead of treating it as absent', async () => {
		const port = await freePort();
		const listener = createServer((_req, res) => {
			res.writeHead(404, { 'content-type': 'text/plain' });
			res.end('other service');
		});
		await new Promise<void>(resolve => listener.listen(port, '127.0.0.1', resolve));
		cleanups.push(() => new Promise<void>(resolve => listener.close(() => resolve())));
		const dir = await mkdtemp(join(tmpdir(), 'rewst-buddy-discovery-'));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		await expect(discoverSharedServer(port, dir)).rejects.toThrow(/not a compatible/);
	});

	it('requires private credentials when a Rewst Buddy listener is present', async () => {
		const port = await freePort();
		const listener = createServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(
				JSON.stringify({
					identity: 'rewst-buddy',
					protocol: 1,
					version: 'test',
					instanceId: 'instance',
					proof: 'bad',
				}),
			);
		});
		await new Promise<void>(resolve => listener.listen(port, '127.0.0.1', resolve));
		cleanups.push(() => new Promise<void>(resolve => listener.close(() => resolve())));
		const dir = await mkdtemp(join(tmpdir(), 'rewst-buddy-discovery-'));
		cleanups.push(() => rm(dir, { recursive: true, force: true }));
		await expect(discoverSharedServer(port, dir)).rejects.toThrow(/credentials are missing/);
		await publishSharedServer(descriptor(port), dir);
		await expect(discoverSharedServer(port, dir)).rejects.toThrow(/authentication/);
	});
});
