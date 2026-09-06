import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(packageRoot, 'package.json');

function readManifest() {
	return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function runNode(args, options = {}) {
	return spawnSync(process.execPath, args, {
		cwd: packageRoot,
		encoding: 'utf8',
		env: { ...process.env, NODE_PATH: '' },
		...options,
	});
}

function runBuild() {
	const result = runNode(['scripts/build.mjs']);
	assert.equal(result.status, 0, `package build failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

function runNpm(args, options) {
	const npmExecPath = process.env.npm_execpath;
	const command = npmExecPath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
	const commandArgs = npmExecPath ? [npmExecPath, ...args] : args;
	const result = spawnSync(command, commandArgs, {
		...options,
		encoding: 'utf8',
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(result.stderr || `npm exited with ${result.status}`);
	return result.stdout;
}

function packAndExtract() {
	const packDir = mkdtempSync(join(tmpdir(), 'rewst-buddy-mcp-pack-'));
	const output = runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], {
		cwd: packageRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			NODE_PATH: '',
			npm_config_cache: mkdtempSync(join(tmpdir(), 'rewst-buddy-mcp-npm-cache-')),
			npm_config_update_notifier: 'false',
		},
	});
	const archive = resolve(packDir, JSON.parse(output)[0].filename);
	const extractDir = mkdtempSync(join(tmpdir(), 'rewst-buddy-mcp-extract-'));
	execFileSync('tar', ['-xzf', archive, '-C', extractDir]);
	return join(extractDir, 'package', 'dist', 'cli.cjs');
}

function randomPort() {
	return 20000 + Math.floor(Math.random() * 20000);
}

async function waitForFile(path, timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			return JSON.parse(readFileSync(path, 'utf8'));
		} catch {
			await new Promise(resolve => setTimeout(resolve, 25));
		}
	}
	throw new Error(`Timed out waiting for ${path}`);
}

function waitForExit(child) {
	return new Promise((resolve, reject) => {
		if (child.exitCode !== null) {
			resolve(child.exitCode);
			return;
		}
		child.once('error', reject);
		child.once('exit', code => resolve(code));
	});
}

test('manifest describes a self-contained Node MCP package', () => {
	const manifest = readManifest();
	assert.equal(manifest.name, 'rewst-buddy-mcp');
	assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/);
	assert.equal(manifest.engines?.node, '>=22');
	assert.equal(manifest.bin?.['rewst-buddy-mcp'], 'dist/cli.cjs');
	assert.deepEqual([...manifest.files].sort(), ['LICENSE', 'README.md', 'dist/*.cjs', 'dist/types/**']);
	assert.equal(manifest.type, 'module');
	assert.equal(manifest.scripts?.build, 'node scripts/build.mjs');
	assert.deepEqual(manifest.publishConfig, {
		access: 'public',
		provenance: true,
		registry: 'https://registry.npmjs.org/',
	});
	for (const dependency of ['@modelcontextprotocol/sdk', 'graphql', 'graphql-request', 'graphql-ws', 'ws', 'zod']) {
		assert.equal(typeof manifest.dependencies?.[dependency], 'string', `${dependency} must be declared`);
	}
});

test('the two package entrypoints are present and buildable', () => {
	assert.ok(readFileSync(join(packageRoot, 'src/cli.ts'), 'utf8'), 'src/cli.ts must be supplied by the MCP split');
	assert.ok(
		readFileSync(join(packageRoot, 'src/index.ts'), 'utf8'),
		'src/index.ts must be supplied by the MCP split',
	);
	runBuild();

	const cli = join(packageRoot, 'dist/cli.cjs');
	const index = join(packageRoot, 'dist/index.cjs');
	const types = join(packageRoot, 'dist/types/index.d.ts');
	assert.ok(statSync(cli).mode & 0o111, 'the CLI bundle must be executable');
	assert.match(readFileSync(cli, 'utf8'), /^#!\/usr\/bin\/env node\n/);
	assert.ok(statSync(index).size > 0, 'the library bundle must be non-empty');
	assert.ok(statSync(types).size > 0, 'the library declaration bundle must be non-empty');
	assert.equal(readFileSync(join(packageRoot, 'dist/types/package.json'), 'utf8').trim(), '{"type":"commonjs"}');
});

test('production metafile has no VS Code import and optional ws addons stay external', () => {
	const metafilePath = join(packageRoot, 'dist/metafile.json');
	assert.doesNotThrow(() => readFileSync(metafilePath, 'utf8'));
	const metafile = JSON.parse(readFileSync(metafilePath, 'utf8'));
	const inputs = Object.keys(metafile.inputs ?? {});
	assert.ok(inputs.length > 0, 'production metafile must record bundle inputs');
	assert.ok(!inputs.some(input => /(?:^|[\\/])vscode(?:[\\/]|$)/.test(input)), 'vscode must not be bundled');
	const outputs = Object.values(metafile.outputs ?? {});
	assert.ok(outputs.some(output => output.entryPoint?.endsWith('src/index.ts')));
	assert.ok(outputs.some(output => output.entryPoint?.endsWith('src/cli.ts')));
});

test('bundled CLI supports offline help and version', () => {
	runBuild();
	const cli = packAndExtract();
	for (const flag of ['--help', '--version']) {
		const result = runNode([cli, flag], {
			cwd: mkdtempSync(join(tmpdir(), 'rewst-buddy-mcp-')),
		});
		assert.equal(result.status, 0, `${flag} failed: ${result.stderr}`);
		assert.notEqual(result.stdout.trim(), '', `${flag} produced no output`);
	}
});

test('packed server handles MCP requests outside the checkout', async () => {
	const cli = packAndExtract();
	const cwd = mkdtempSync(join(tmpdir(), 'rewst-buddy-mcp-stdio-'));
	const port = randomPort();
	const discoveryDir = mkdtempSync(join(tmpdir(), 'rewst-buddy-mcp-discovery-'));
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [cli, '--port', String(port), '--discovery-dir', discoveryDir, '--state-dir', join(cwd, 'state')],
		cwd,
		env: { REWST_SESSION_COOKIE: '', REWST_BUDDY_PASSPHRASE: '', REWST_BUDDY_MCP_TOKEN: '' },
		stderr: 'pipe',
	});
	const client = new Client({ name: 'package-acceptance', version: '1.0.0' });
	try {
		await client.connect(transport);
		const { tools } = await client.listTools();
		assert.ok(tools.some(tool => tool.name === 'buddy_get_working_scope'));
		assert.ok(!tools.some(tool => tool.name === 'rewst_editor_operation'));
		const result = await client.callTool({ name: 'buddy_get_working_scope', arguments: {} });
		assert.equal(result.isError, true);
		assert.equal(result.structuredContent?.code, 'no_session');
	} finally {
		await client.close();
	}
});

test('a second CLI reuses the owner and proxy EOF leaves the owner running', async () => {
	const cli = packAndExtract();
	const cwd = mkdtempSync(join(tmpdir(), 'rewst-buddy-mcp-reuse-'));
	const port = randomPort();
	const discoveryDir = mkdtempSync(join(tmpdir(), 'rewst-buddy-mcp-reuse-discovery-'));
	const ownerArgs = ['--port', String(port), '--discovery-dir', discoveryDir, '--state-dir', join(cwd, 'state')];
	const proxyArgs = ['--port', String(port), '--discovery-dir', discoveryDir];
	const env = {
		...process.env,
		NODE_PATH: '',
		REWST_SESSION_COOKIE: '',
		REWST_BUDDY_PASSPHRASE: '',
		REWST_BUDDY_MCP_TOKEN: '',
	};
	const owner = spawn(process.execPath, [cli, ...ownerArgs], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
	const recordPath = join(discoveryDir, `${port}.json`);
	let proxy;
	try {
		const ownerDescriptor = await waitForFile(recordPath);
		proxy = new StdioClientTransport({ command: process.execPath, args: [cli, ...proxyArgs], cwd, stderr: 'pipe' });
		const client = new Client({ name: 'package-reuse', version: '1.0.0' });
		try {
			await client.connect(proxy);
			const { tools } = await client.listTools();
			assert.ok(tools.some(tool => tool.name === 'buddy_get_working_scope'));
		} finally {
			await client.close();
		}
		await new Promise(resolve => setTimeout(resolve, 100));
		assert.equal(owner.exitCode, null, 'proxy shutdown must not stop the owner');
		assert.equal(JSON.parse(readFileSync(recordPath, 'utf8')).instanceId, ownerDescriptor.instanceId);
	} finally {
		if (proxy) await proxy.close().catch(() => undefined);
		if (owner.exitCode === null) owner.stdin.end();
		if (owner.exitCode === null) await waitForExit(owner);
	}
});

test('CLI starts under its npm executable name', () => {
	const cwd = mkdtempSync(join(tmpdir(), 'rewst-buddy-mcp-bin-'));
	const bin = join(cwd, 'rewst-buddy-mcp');
	copyFileSync(join(packageRoot, 'dist/cli.cjs'), bin);
	const result = runNode([bin, '--version'], { cwd });
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), readManifest().version);
});

test('npm pack dry run contains only package metadata, README, license, and dist', () => {
	runBuild();
	const output = runNpm(['pack', '--dry-run', '--json', '--ignore-scripts'], {
		cwd: packageRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			NODE_PATH: '',
			npm_config_cache: mkdtempSync(join(tmpdir(), 'rewst-buddy-mcp-npm-cache-')),
			npm_config_update_notifier: 'false',
		},
	});
	const pack = JSON.parse(output)[0];
	const names = pack.files.map(file => file.path).sort();
	assert.ok(names.includes('package.json'));
	assert.ok(names.includes('README.md'));
	assert.ok(names.includes('LICENSE'));
	assert.ok(names.includes('dist/cli.cjs'));
	assert.ok(names.includes('dist/index.cjs'));
	assert.ok(names.includes('dist/types/index.d.ts'));
	assert.ok(names.includes('dist/types/package.json'));
	assert.ok(!names.includes('dist/metafile.json'));
	assert.ok(
		names.every(
			name => name === 'package.json' || name === 'README.md' || name === 'LICENSE' || name.startsWith('dist/'),
		),
	);
	assert.ok(!names.some(name => name.startsWith('src/') || name.startsWith('scripts/')));
});
