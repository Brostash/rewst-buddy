import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { request } from 'node:http';

export interface SharedServerDescriptor {
	identity: 'rewst-buddy';
	protocol: 1;
	version: string;
	instanceId: string;
	port: number;
	publicToken: string;
	editorToken: string;
}

const IDENTITY = 'rewst-buddy' as const;
const PROTOCOL = 1 as const;
const PROBE_TIMEOUT_MS = 1500;
const MAX_PROBE_BYTES = 16 * 1024;

export function defaultDiscoveryDir(): string {
	if (platform() === 'win32') {
		return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'rewst-buddy', 'runtimes');
	}
	if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'rewst-buddy', 'runtimes');
	return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'rewst-buddy', 'runtimes');
}

function descriptorPath(port: number, discoveryDir = defaultDiscoveryDir()): string {
	return join(discoveryDir, `${port}.json`);
}

function validPort(port: number): void {
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError(`Invalid shared server port: ${port}`);
}

function isOwnerAndPrivate(mode: number, uid: number | undefined): boolean {
	if (platform() === 'win32') return true;
	if ((mode & 0o077) !== 0) return false;
	return uid === undefined || typeof process.getuid !== 'function' || uid === process.getuid();
}

async function verifyPrivatePath(path: string, kind: 'directory' | 'file'): Promise<void> {
	const info = await lstat(path);
	if (info.isSymbolicLink()) throw new Error(`Shared discovery ${kind} must not be a symbolic link: ${path}`);
	if (kind === 'directory' && !info.isDirectory())
		throw new Error(`Shared discovery path is not a directory: ${path}`);
	if (kind === 'file' && !info.isFile()) throw new Error(`Shared discovery record is not a file: ${path}`);
	if (!isOwnerAndPrivate(info.mode, info.uid)) {
		throw new Error(`Shared discovery ${kind} must be owner-only: ${path}`);
	}
}

function validateDescriptor(value: unknown): SharedServerDescriptor {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Shared discovery record is not an object');
	const item = value as Record<string, unknown>;
	if (item.identity !== IDENTITY || item.protocol !== PROTOCOL)
		throw new Error('Shared server identity or protocol is incompatible');
	if (typeof item.version !== 'string' || !item.version) throw new Error('Shared server version is missing');
	if (typeof item.instanceId !== 'string' || !item.instanceId)
		throw new Error('Shared server instance id is missing');
	if (typeof item.port !== 'number' || !Number.isInteger(item.port) || item.port < 1 || item.port > 65535)
		throw new Error('Shared server port is invalid');
	if (
		typeof item.publicToken !== 'string' ||
		!item.publicToken ||
		typeof item.editorToken !== 'string' ||
		!item.editorToken
	)
		throw new Error('Shared server credentials are missing');
	return item as unknown as SharedServerDescriptor;
}

function proof(editorToken: string, challenge: string): string {
	return createHmac('sha256', editorToken).update(challenge).digest('hex');
}

function equalText(left: string, right: string): boolean {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	return a.length === b.length && timingSafeEqual(a, b);
}

async function readRecord(path: string): Promise<SharedServerDescriptor | undefined> {
	try {
		await verifyPrivatePath(dirname(path), 'directory');
		await verifyPrivatePath(path, 'file');
		return validateDescriptor(JSON.parse(await readFile(path, 'utf8')));
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') return undefined;
		throw error;
	}
}

export async function publishSharedServer(
	descriptor: SharedServerDescriptor,
	discoveryDir = defaultDiscoveryDir(),
): Promise<void> {
	validPort(descriptor.port);
	validateDescriptor(descriptor);
	await mkdir(discoveryDir, { recursive: true, mode: 0o700 });
	await chmod(discoveryDir, 0o700);
	await verifyPrivatePath(discoveryDir, 'directory');
	const path = descriptorPath(descriptor.port, discoveryDir);
	const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
	await writeFile(temporary, `${JSON.stringify(descriptor)}\n`, { mode: 0o600 });
	await chmod(temporary, 0o600);
	try {
		await rename(temporary, path);
		await chmod(path, 0o600);
	} catch (error) {
		await unlink(temporary).catch(() => undefined);
		throw error;
	}
}

export async function withdrawSharedServer(
	instanceId: string,
	port: number,
	discoveryDir = defaultDiscoveryDir(),
): Promise<void> {
	validPort(port);
	const path = descriptorPath(port, discoveryDir);
	try {
		const current = await readRecord(path);
		if (current?.instanceId === instanceId)
			await unlink(path).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== 'ENOENT') throw error;
			});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
}

interface ProbeResult {
	status: number;
	body: string;
}

function probe(port: number, challenge: string): Promise<ProbeResult> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: '127.0.0.1',
				port,
				path: `/.well-known/rewst-buddy?challenge=${encodeURIComponent(challenge)}`,
				method: 'GET',
				timeout: PROBE_TIMEOUT_MS,
				headers: { Host: `127.0.0.1:${port}` },
			},
			res => {
				res.once('error', reject);
				res.once('aborted', () =>
					reject(
						Object.assign(new Error('Shared server discovery response was interrupted'), {
							code: 'ECONNRESET',
						}),
					),
				);
				const chunks: Buffer[] = [];
				let size = 0;
				res.on('data', chunk => {
					const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
					size += buffer.length;
					if (size > MAX_PROBE_BYTES) {
						req.destroy(
							Object.assign(new Error('Shared server discovery response is too large'), {
								code: 'EPROTO',
							}),
						);
						return;
					}
					chunks.push(buffer);
				});
				res.on('end', () =>
					resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
				);
			},
		);
		req.on('timeout', () =>
			req.destroy(Object.assign(new Error('Shared server discovery probe timed out'), { code: 'ETIMEDOUT' })),
		);
		req.on('error', reject);
		req.end();
	});
}

/** Discover and authenticate the already-running local Rewst Buddy server. */
export async function discoverSharedServer(
	port: number,
	discoveryDir = defaultDiscoveryDir(),
): Promise<SharedServerDescriptor | undefined> {
	validPort(port);
	const path = descriptorPath(port, discoveryDir);
	const challenge = randomBytes(24).toString('base64url');
	let response: ProbeResult;
	try {
		response = await probe(port, challenge);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === 'ECONNREFUSED') return undefined;
		throw new Error(
			`Unable to probe shared Rewst Buddy server on 127.0.0.1:${port}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (response.status < 200 || response.status >= 300) {
		throw new Error(`A listener is already using 127.0.0.1:${port}, but it is not a compatible Rewst Buddy server`);
	}
	let record: SharedServerDescriptor | undefined;
	try {
		record = await readRecord(path);
	} catch (error) {
		throw new Error(
			`Cannot read shared Rewst Buddy credentials: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!record)
		throw new Error(
			`A Rewst Buddy listener is running on port ${port}, but its local discovery credentials are missing`,
		);
	if (record.port !== port)
		throw new Error(`Shared Rewst Buddy discovery record targets port ${record.port}, expected ${port}`);
	let remote: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(response.body);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
			throw new Error('probe response is not an object');
		remote = parsed as Record<string, unknown>;
	} catch (error) {
		throw new Error(
			`The listener on port ${port} returned an invalid Rewst Buddy identity response: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (
		remote.identity !== IDENTITY ||
		remote.protocol !== PROTOCOL ||
		remote.instanceId !== record.instanceId ||
		remote.version !== record.version
	)
		throw new Error(`The listener on port ${port} is an incompatible or stale Rewst Buddy instance`);
	const remoteProof = typeof remote.proof === 'string' ? remote.proof : remote.hmac;
	if (typeof remoteProof !== 'string' || !equalText(remoteProof, proof(record.editorToken, challenge)))
		throw new Error(`The listener on port ${port} failed Rewst Buddy discovery authentication`);
	return record;
}

export function sharedServerProof(editorToken: string, challenge: string): string {
	return proof(editorToken, challenge);
}

export function sharedDescriptorPath(port: number, discoveryDir = defaultDiscoveryDir()): string {
	validPort(port);
	return descriptorPath(port, discoveryDir);
}
