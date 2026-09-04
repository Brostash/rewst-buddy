import { readFileSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { discoverSharedServer, type SharedServerDescriptor } from './sharedDiscovery';
import { startSharedHttpServer } from './sharedHttp';
import {
	broadcastEditorEvent,
	createSharedEditorServer,
	handleSharedBrowserAction,
	requestAttachedEditor,
} from './editorBridge';
import { runStdioProxy } from './stdioProxy';

declare const __PACKAGE_VERSION__: string;

const VERSION = typeof __PACKAGE_VERSION__ === 'string' ? __PACKAGE_VERSION__ : '0.1.0';
const DEFAULT_PORT = 27121;

export interface ParsedCliOptions {
	command: 'serve' | 'login';
	help: boolean;
	version: boolean;
	transport: 'stdio' | 'http';
	port: number;
	orgs: string[];
	allowWrites: boolean;
	approveWrites: boolean;
	allowGraphqlMutations: boolean;
	stateDir?: string;
	configPath?: string;
	discoveryDir?: string;
	loginStdin: boolean;
}

export interface CliIo {
	stdin: Readable;
	stdout: Writable;
	stderr: Writable;
}

/** Returns whether a requested scope stays within the CLI's explicit --org set. */
export function isAllowedScopeChange(
	request: { orgs: readonly { id: string }[]; workflows: readonly { orgId?: string }[] },
	allowedOrgs: ReadonlySet<string> | readonly string[],
): boolean {
	const allowed = allowedOrgs instanceof Set ? allowedOrgs : new Set(allowedOrgs);
	return (
		request.orgs.every(org => allowed.has(org.id)) &&
		request.workflows.every(workflow => typeof workflow.orgId === 'string' && allowed.has(workflow.orgId))
	);
}

const HELP = `Usage: rewst-buddy-mcp [options]

Run a Rewst Buddy MCP server over stdio (the default) or localhost HTTP.

Options:
  --transport stdio|http  Select the MCP transport
  --port PORT             HTTP port (default: ${DEFAULT_PORT})
  --org ORG[,ORG...]      Organization allowed for writes (repeatable)
  --allow-writes          Expose write tools
  --approve-writes        Approve typed write scopes in this host
  --allow-graphql-mutations  Expose raw GraphQL mutation (requires editor approval)
  --state-dir PATH        Directory for session metadata and credentials
  --config PATH           JSON file containing validated region settings
  --discovery-dir PATH    Directory for the shared server descriptor
  --help                  Show this help
  --version               Show the package version

Commands:
  login --stdin            Read a session cookie from stdin (passphrase required)
`;

function optionValue(arg: string, argv: string[], index: number): [string, number] {
	const equals = arg.indexOf('=');
	if (equals !== -1) return [arg.slice(equals + 1), index];
	const value = argv[index + 1];
	if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`);
	return [value, index + 1];
}

function parsePort(value: string): number {
	if (!/^\d+$/.test(value)) throw new Error(`Invalid port: ${value}`);
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port: ${value}`);
	return port;
}

function addOrgs(orgs: string[], value: string): void {
	for (const org of value.split(',')) {
		const trimmed = org.trim();
		if (trimmed && !orgs.includes(trimmed)) orgs.push(trimmed);
	}
}

export function parseCliArgs(argv: string[]): ParsedCliOptions {
	const result: ParsedCliOptions = {
		command: 'serve',
		help: false,
		version: false,
		transport: 'stdio',
		port: DEFAULT_PORT,
		orgs: [],
		allowWrites: false,
		approveWrites: false,
		allowGraphqlMutations: false,
		loginStdin: false,
	};
	let index = 0;
	if (argv[0] === 'login') {
		result.command = 'login';
		index = 1;
	}
	for (; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === '--help' || arg === '-h') result.help = true;
		else if (arg === '--version' || arg === '-v') result.version = true;
		else if (arg === '--allow-writes') result.allowWrites = true;
		else if (arg === '--approve-writes') result.approveWrites = true;
		else if (arg === '--allow-graphql-mutations') result.allowGraphqlMutations = true;
		else if (arg === '--stdin') result.loginStdin = true;
		else if (arg === '--transport' || arg.startsWith('--transport=')) {
			const [value, next] = optionValue(arg, argv, index);
			if (value !== 'stdio' && value !== 'http') throw new Error(`Invalid transport: ${value}`);
			result.transport = value;
			index = next;
		} else if (arg === '--port' || arg.startsWith('--port=')) {
			const [value, next] = optionValue(arg, argv, index);
			result.port = parsePort(value);
			index = next;
		} else if (arg === '--org' || arg.startsWith('--org=')) {
			const [value, next] = optionValue(arg, argv, index);
			addOrgs(result.orgs, value);
			index = next;
		} else if (arg === '--state-dir' || arg.startsWith('--state-dir=')) {
			const [value, next] = optionValue(arg, argv, index);
			result.stateDir = value;
			index = next;
		} else if (arg === '--config' || arg.startsWith('--config=')) {
			const [value, next] = optionValue(arg, argv, index);
			result.configPath = value;
			index = next;
		} else if (arg === '--discovery-dir' || arg.startsWith('--discovery-dir=')) {
			const [value, next] = optionValue(arg, argv, index);
			result.discoveryDir = value;
			index = next;
		} else {
			throw new Error(`Unknown option: ${arg}`);
		}
	}
	if (result.command === 'login' && !result.loginStdin) throw new Error('login requires --stdin');
	if (result.approveWrites && (!result.allowWrites || result.orgs.length === 0)) {
		throw new Error('--approve-writes requires --allow-writes and at least one --org');
	}
	if (result.allowGraphqlMutations && (!result.allowWrites || result.orgs.length === 0)) {
		throw new Error('--allow-graphql-mutations requires --allow-writes and --org');
	}
	if (result.command === 'login' && result.transport !== 'stdio') throw new Error('login only supports stdio');
	return result;
}

function defaultStateDir(): string {
	if (platform() === 'win32')
		return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Rewst Buddy');
	if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Rewst Buddy');
	return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'rewst-buddy');
}

function hasPersistentCredentials(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}

function readConfig(path: string | undefined): Record<string, unknown> {
	if (!path) return {};
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Config must be a JSON object');
	const record = parsed as Record<string, unknown>;
	for (const key of Object.keys(record)) if (key !== 'regions') throw new Error(`Unsupported config key: ${key}`);
	if (record.regions !== undefined) {
		if (!Array.isArray(record.regions) || record.regions.length === 0)
			throw new Error('Config regions must be non-empty');
		for (const region of record.regions) {
			if (!region || typeof region !== 'object') throw new Error('Each region must be an object');
			const item = region as Record<string, unknown>;
			for (const key of ['name', 'cookieName', 'graphqlUrl', 'loginUrl']) {
				if (typeof item[key] !== 'string' || item[key].trim() === '')
					throw new Error(`Region ${key} is required`);
			}
			for (const key of ['graphqlUrl', 'loginUrl', 'subscriptionsUrl']) {
				if (item[key] !== undefined) {
					const url = new URL(item[key] as string);
					if (
						url.protocol !== 'https:' &&
						url.protocol !== 'http:' &&
						url.protocol !== 'wss:' &&
						url.protocol !== 'ws:'
					) {
						throw new Error(`Region ${key} must use HTTP(S) or WS(S)`);
					}
				}
			}
		}
	}
	return record;
}

function redact(value: unknown, secrets: string[]): unknown {
	if (typeof value === 'string')
		return secrets.reduce((text, secret) => (secret ? text.split(secret).join('[REDACTED]') : text), value);
	if (Array.isArray(value)) return value.map(item => redact(item, secrets));
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				/cookie|token|passphrase|secret/i.test(key) ? '[REDACTED]' : redact(item, secrets),
			]),
		);
	return value;
}

async function readAll(stream: Readable): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
	return Buffer.concat(chunks).toString('utf8').trim();
}

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function hasServerConfiguration(options: ParsedCliOptions): boolean {
	return Boolean(
		options.orgs.length ||
		options.allowWrites ||
		options.approveWrites ||
		options.allowGraphqlMutations ||
		options.stateDir ||
		options.configPath ||
		process.env.REWST_BUDDY_PASSPHRASE,
	);
}

function isAddressInUse(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'EADDRINUSE');
}

async function rediscoverAfterCollision(
	port: number,
	discoveryDir: string | undefined,
): Promise<SharedServerDescriptor | undefined> {
	for (let attempt = 0; attempt < 20; attempt++) {
		try {
			const descriptor = await discoverSharedServer(port, discoveryDir);
			if (descriptor) return descriptor;
		} catch (error) {
			// A winner publishes its private record immediately after listen().
			// Only that short missing-record window is retryable; an incompatible
			// listener or failed identity must remain a hard error.
			const message = error instanceof Error ? error.message : String(error);
			if (!/discovery credentials are missing|discovery record is missing/i.test(message)) throw error;
		}
		await new Promise(resolve => setTimeout(resolve, 10));
	}
	return undefined;
}

async function forwardSessionCookie(descriptor: SharedServerDescriptor, cookie: string | undefined): Promise<void> {
	if (!cookie) return;
	const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
		import('@modelcontextprotocol/sdk/client/index.js'),
		import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
	]);
	const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${descriptor.port}/editor`), {
		requestInit: { headers: { Authorization: `Bearer ${descriptor.editorToken}` }, redirect: 'error' },
	});
	const client = new Client({ name: 'rewst-buddy-mcp-session-intake', version: VERSION });
	try {
		await client.connect(transport);
		const result = await client.callTool({
			name: 'rewst_editor_operation',
			arguments: { operation: 'sessions.create', input: { cookies: cookie } },
		});
		if (result.isError) throw new Error('Shared server rejected the session cookie.');
	} finally {
		await transport.terminateSession().catch(() => undefined);
		await client.close().catch(() => undefined);
	}
}

async function waitForSignal(): Promise<void> {
	await new Promise<void>(resolve => {
		const done = () => {
			process.off('SIGINT', done);
			process.off('SIGTERM', done);
			resolve();
		};
		process.once('SIGINT', done);
		process.once('SIGTERM', done);
	});
}

async function waitForStdioClose(
	stdin: Readable,
	transport: { close(): Promise<void> },
	server: { close(): Promise<void>; onclose?: () => void },
): Promise<void> {
	await new Promise<void>(resolve => {
		let closed = false;
		const done = () => {
			if (closed) return;
			closed = true;
			stdin.off('end', closeTransport);
			process.off('SIGINT', closeTransport);
			process.off('SIGTERM', closeTransport);
			resolve();
		};
		const closeTransport = () => {
			void transport
				.close()
				.catch(() => undefined)
				.finally(done);
		};
		server.onclose = done;
		stdin.once('end', closeTransport);
		process.once('SIGINT', closeTransport);
		process.once('SIGTERM', closeTransport);
		if (stdin.readableEnded) closeTransport();
	});
	await server.close().catch(() => undefined);
}

async function runLogin(options: ParsedCliOptions, io: CliIo): Promise<number> {
	const { FileStateStore, MemorySecretStore, EncryptedSecretStore } = await import('./storage');
	const { configureRuntimeHost } = await import('./host');
	const { SessionManager } = await import('./sessions/SessionManager');
	const { startRuntime, stopRuntime } = await import('./runtime');
	const config = readConfig(options.configPath);
	const stateDir = options.stateDir || defaultStateDir();
	const passphrase = process.env.REWST_BUDDY_PASSPHRASE;
	const credentialsPath = join(stateDir, 'credentials.enc');
	if (!passphrase && hasPersistentCredentials(credentialsPath)) {
		io.stderr.write(
			'Encrypted credentials were found; set REWST_BUDDY_PASSPHRASE or choose a different --state-dir before starting.\n',
		);
		return 2;
	}
	const state = await FileStateStore.open(join(stateDir, 'state.json'));
	const secrets = passphrase ? await EncryptedSecretStore.open(credentialsPath, passphrase) : new MemorySecretStore();
	const secretValues = [process.env.REWST_BUDDY_MCP_TOKEN, passphrase].filter((value): value is string => !!value);
	const host = {
		state,
		secrets,
		getSetting<T>(key: string, fallback: T): T {
			if (key === 'regions' && config.regions) return config.regions as T;
			if (key === 'mcp.alwaysAllowedOrgs') return options.orgs as T;
			if (key === 'mcp.enableWriteTools') return options.allowWrites as T;
			if (key === 'mcp.enableDangerousGraphqlMutation') return options.allowGraphqlMutations as T;
			if (key === 'mcp.enable') return true as T;
			return fallback;
		},
		log(level: string, message: string, ...details: unknown[]) {
			io.stderr.write(
				`[${level}] ${String(redact(message, secretValues))}${details.length ? ` ${JSON.stringify(redact(details, secretValues))}` : ''}\n`,
			);
		},
		requestToken: async () => {
			throw new Error('login --stdin requires a cookie and passphrase');
		},
	};
	configureRuntimeHost(host);
	await startRuntime(host);
	try {
		if (!passphrase) {
			io.stderr.write('login --stdin requires REWST_BUDDY_PASSPHRASE\n');
			return 2;
		}
		const cookie = await readAll(io.stdin);
		if (!cookie) {
			io.stderr.write('No session cookie was provided on stdin\n');
			return 2;
		}
		secretValues.push(cookie);
		try {
			await SessionManager.createSession(cookie);
		} catch (error) {
			io.stderr.write(`${String(redact(error instanceof Error ? error.message : error, secretValues))}\n`);
			return 1;
		}
		return 0;
	} finally {
		await stopRuntime(host);
	}
}

export async function runCli(
	argv = process.argv.slice(2),
	io: CliIo = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
	let options: ParsedCliOptions;
	try {
		options = parseCliArgs(argv);
	} catch (error) {
		io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		return 2;
	}
	if (options.help) {
		io.stdout.write(HELP);
		return 0;
	}
	if (options.version) {
		io.stdout.write(`${VERSION}\n`);
		return 0;
	}

	// `login --stdin` is deliberately independent of server discovery. It is a
	// credential persistence command, rather than another public MCP client.
	if (options.command === 'login') return runLogin(options, io);

	// Discovery must happen before opening state or secret stores. A second
	// process therefore cannot accidentally load credentials or start refresh
	// work merely because an owner is already present.
	let existing: SharedServerDescriptor | undefined;
	try {
		existing = await discoverSharedServer(options.port, options.discoveryDir);
	} catch (error) {
		io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
	if (existing) {
		if (hasServerConfiguration(options)) {
			io.stderr.write(
				'An existing Rewst Buddy server owns this port; remove server configuration flags when attaching to it.\n',
			);
			return 2;
		}
		try {
			await forwardSessionCookie(existing, process.env.REWST_SESSION_COOKIE);
		} catch (error) {
			const secret = process.env.REWST_SESSION_COOKIE;
			io.stderr.write(
				`${String(redact(error instanceof Error ? error.message : error, secret ? [secret] : []))}\n`,
			);
			return 1;
		}
		if (options.transport === 'http') {
			io.stderr.write(`Reusing existing Rewst Buddy server on port ${existing.port}.\n`);
			return 0;
		}
		try {
			await runStdioProxy({
				port: existing.port,
				publicToken: existing.publicToken,
				stdin: io.stdin,
				stdout: io.stdout,
			});
			return 0;
		} catch (error) {
			const secret = process.env.REWST_SESSION_COOKIE;
			io.stderr.write(
				`${String(redact(error instanceof Error ? error.message : error, secret ? [secret] : []))}\n`,
			);
			return 1;
		}
	}

	const ready = deferred<void>();
	// The owner may fail before any HTTP request observes the readiness gate;
	// keep that expected startup failure from becoming an unhandled rejection.
	void ready.promise.catch(() => undefined);
	let hub: Awaited<ReturnType<typeof startSharedHttpServer>> | undefined;
	try {
		hub = await startSharedHttpServer({
			port: options.port,
			discoveryDir: options.discoveryDir,
			publicToken: process.env.REWST_BUDDY_MCP_TOKEN,
			publicEnabled: () => true,
			createEditorServer: createSharedEditorServer,
			handleBrowserAction: handleSharedBrowserAction,
			version: VERSION,
			ready: ready.promise,
		});
	} catch (error) {
		if (!isAddressInUse(error)) throw error;
		// Another contender may have won between discovery and listen.
		try {
			existing = await rediscoverAfterCollision(options.port, options.discoveryDir);
		} catch (rediscoveryError) {
			io.stderr.write(
				`${rediscoveryError instanceof Error ? rediscoveryError.message : String(rediscoveryError)}\n`,
			);
			return 1;
		}
		if (!existing) throw error;
		if (hasServerConfiguration(options)) {
			io.stderr.write(
				'An existing Rewst Buddy server owns this port; remove server configuration flags when attaching to it.\n',
			);
			return 2;
		}
		await forwardSessionCookie(existing, process.env.REWST_SESSION_COOKIE);
		if (options.transport === 'http') {
			io.stderr.write(`Reusing existing Rewst Buddy server on port ${existing.port}.\n`);
			return 0;
		}
		await runStdioProxy({
			port: existing.port,
			publicToken: existing.publicToken,
			stdin: io.stdin,
			stdout: io.stdout,
		});
		return 0;
	}

	let host: import('./host').RuntimeHost | undefined;
	let stopRuntime: ((host?: import('./host').RuntimeHost) => Promise<void>) | undefined;
	try {
		const { FileStateStore, MemorySecretStore, EncryptedSecretStore } = await import('./storage');
		const { configureRuntimeHost } = await import('./host');
		const { SessionManager } = await import('./sessions/SessionManager');
		const runtime = await import('./runtime');
		const { startRuntime } = runtime;
		stopRuntime = runtime.stopRuntime;
		const config = readConfig(options.configPath);
		const stateDir = options.stateDir || defaultStateDir();
		const passphrase = process.env.REWST_BUDDY_PASSPHRASE;
		const credentialsPath = join(stateDir, 'credentials.enc');
		if (!passphrase && hasPersistentCredentials(credentialsPath)) {
			io.stderr.write(
				'Encrypted credentials were found; set REWST_BUDDY_PASSPHRASE or choose a different --state-dir before starting.\n',
			);
			return 2;
		}
		const state = await FileStateStore.open(join(stateDir, 'state.json'));
		const secrets = passphrase
			? await EncryptedSecretStore.open(credentialsPath, passphrase)
			: new MemorySecretStore();
		const secretValues = [process.env.REWST_BUDDY_MCP_TOKEN, passphrase, process.env.REWST_SESSION_COOKIE].filter(
			(value): value is string => !!value,
		);
		host = {
			state,
			secrets,
			getSetting<T>(key: string, fallback: T): T {
				if (key === 'regions' && config.regions) return config.regions as T;
				if (key === 'mcp.alwaysAllowedOrgs') return options.orgs as T;
				if (key === 'mcp.enableWriteTools') return options.allowWrites as T;
				if (key === 'mcp.enableDangerousGraphqlMutation') return options.allowGraphqlMutations as T;
				if (key === 'mcp.enable') return true as T;
				return fallback;
			},
			log(level: string, message: string, ...details: unknown[]) {
				const safeMessage = String(redact(message, secretValues));
				io.stderr.write(
					`[${level}] ${safeMessage}${details.length ? ` ${JSON.stringify(redact(details, secretValues))}` : ''}\n`,
				);
			},
			requestToken: async () => {
				const result = await requestAttachedEditor('token.request', {});
				if (typeof result !== 'string' || result.length === 0)
					throw new Error('Provide a cookie with REWST_SESSION_COOKIE or login --stdin');
				return result;
			},
			sessionExpired: label => {
				void requestAttachedEditor('session.expired', { label }).catch(() => undefined);
			},
			templateChanged: template => {
				broadcastEditorEvent({ type: 'templateChanged', template });
			},
		};
		configureRuntimeHost(host);
		const { setMcpMutationApprover, setMcpScopedMutationApprover, setWorkingScopeApprover } =
			await import('./capabilities/index');
		// Arbitrary documents have no verified relationship to scope.orgId. Even
		// with standing typed-write approval, show each document to the editor.
		setMcpMutationApprover(async (scope, operation, origin) => {
			try {
				const result = await requestAttachedEditor('approval.mutation', { scope, operation, origin });
				return result === true || (result as { approved?: unknown } | undefined)?.approved === true;
			} catch {
				return false;
			}
		});
		if (options.approveWrites) {
			const allowedOrgs = new Set(options.orgs);
			setMcpScopedMutationApprover(async scope => allowedOrgs.has(scope.orgId));
			setWorkingScopeApprover(async request => isAllowedScopeChange(request, allowedOrgs));
		} else {
			setMcpScopedMutationApprover(undefined);
			setWorkingScopeApprover(async (request, origin) => {
				try {
					const result = await requestAttachedEditor('approval.scope', { request, origin });
					return result === true || (result as { approved?: unknown } | undefined)?.approved === true;
				} catch {
					return false;
				}
			});
		}
		await startRuntime(host);
		ready.resolve();

		if (process.env.REWST_SESSION_COOKIE) await SessionManager.createSession(process.env.REWST_SESSION_COOKIE);
		if (options.transport === 'http') {
			await waitForSignal();
			return 0;
		}
		const [{ StdioServerTransport }, { createMcpServer }] = await Promise.all([
			import('@modelcontextprotocol/sdk/server/stdio.js'),
			import('./mcpServer'),
		]);
		const server = createMcpServer();
		const transport = new StdioServerTransport(io.stdin, io.stdout);
		await server.connect(transport);
		await waitForStdioClose(io.stdin, transport, server);
		return 0;
	} catch (error) {
		ready.reject(error);
		throw error;
	} finally {
		// Reject any request still waiting on startup before closing the listener.
		// This matters when initialization returns early (for example, because an
		// encrypted vault has no passphrase).
		ready.reject(new Error('Rewst Buddy owner stopped before becoming ready'));
		if (hub) await hub.close().catch(() => undefined);
		if (host && stopRuntime) await stopRuntime(host);
	}
}

// npm may launch this file through a bin symlink named rewst-buddy-mcp.
// Check the CommonJS entry module, rather than the spelling of argv[1].
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
	runCli()
		.then(code => {
			if (code) process.exitCode = code;
		})
		.catch(error => {
			const secrets = [
				process.env.REWST_BUDDY_MCP_TOKEN,
				process.env.REWST_BUDDY_PASSPHRASE,
				process.env.REWST_SESSION_COOKIE,
			].filter((value): value is string => !!value);
			const message = error instanceof Error ? error.message : String(error);
			process.stderr.write(`${redact(message, secrets)}\n`);
			process.exitCode = 1;
		});
}
