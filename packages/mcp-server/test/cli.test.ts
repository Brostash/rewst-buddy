import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { isAllowedScopeChange, parseCliArgs, runCli } from '../src/cli';

function io() {
	const stdin = new PassThrough();
	const stdout = new PassThrough();
	const stderr = new PassThrough();
	return { stdin, stdout, stderr };
}

function isolatedServerArgs(stateDir: string): string[] {
	const port = 20000 + Math.floor(Math.random() * 20000);
	const discoveryDir = mkdtempSync(join(tmpdir(), 'rewst-mcp-discovery-'));
	return ['--port', String(port), '--discovery-dir', discoveryDir, '--state-dir', stateDir];
}

describe('standalone CLI argument boundary', () => {
	it('keeps help and version offline', async () => {
		const helpIo = io();
		expect(await runCli(['--help'], helpIo)).toBe(0);
		const versionIo = io();
		expect(await runCli(['--version'], versionIo)).toBe(0);
	});

	it('parses repeated and comma separated org scopes', () => {
		expect(parseCliArgs(['--org', 'one,two', '--org=three']).orgs).toEqual(['one', 'two', 'three']);
	});

	it('requires explicit write approval and a non-empty org scope', () => {
		expect(() => parseCliArgs(['--approve-writes'])).toThrow(/requires --allow-writes/);
		expect(() => parseCliArgs(['--allow-writes', '--approve-writes'])).toThrow(/at least one --org/);
		expect(() => parseCliArgs(['--allow-graphql-mutations', '--org', 'one'])).toThrow(/--allow-writes/);
		expect(() => parseCliArgs(['--allow-graphql-mutations', '--allow-writes'])).toThrow(/--org/);
		expect(parseCliArgs(['--allow-graphql-mutations', '--allow-writes', '--org', 'one'])).toMatchObject({
			allowGraphqlMutations: true,
			approveWrites: false,
		});
	});

	it('keeps approved scope changes inside the explicit organization allowlist', () => {
		const allowed = new Set(['org-allowed']);
		expect(isAllowedScopeChange({ orgs: [{ id: 'org-allowed' }], workflows: [] }, allowed)).toBe(true);
		expect(isAllowedScopeChange({ orgs: [{ id: 'org-forbidden' }], workflows: [] }, allowed)).toBe(false);
		expect(
			isAllowedScopeChange({ orgs: [], workflows: [{ id: 'workflow', orgId: 'org-forbidden' }] }, allowed),
		).toBe(false);
		expect(isAllowedScopeChange({ orgs: [], workflows: [{ id: 'workflow' }] }, allowed)).toBe(false);
	});

	it('stops the runtime when stdio reaches EOF', async () => {
		vi.stubEnv('REWST_SESSION_COOKIE', '');
		vi.stubEnv('REWST_BUDDY_MCP_TOKEN', '');
		vi.stubEnv('REWST_BUDDY_PASSPHRASE', '');
		try {
			const streams = io();
			streams.stdin.end();
			expect(await runCli(isolatedServerArgs(mkdtempSync(join(tmpdir(), 'rewst-mcp-cli-'))), streams)).toBe(0);
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it('does not overwrite saved metadata when an encrypted vault lacks its passphrase', async () => {
		const stateDir = mkdtempSync(join(tmpdir(), 'rewst-mcp-vault-'));
		const statePath = join(stateDir, 'state.json');
		const saved = '{"SessionProfiles":[{"user":{"id":"keep-me"}}]}';
		writeFileSync(statePath, saved);
		writeFileSync(join(stateDir, 'credentials.enc'), 'synthetic encrypted vault');
		vi.stubEnv('REWST_BUDDY_PASSPHRASE', '');
		vi.stubEnv('REWST_SESSION_COOKIE', '');
		vi.stubEnv('REWST_BUDDY_MCP_TOKEN', '');
		try {
			const streams = io();
			expect(await runCli(isolatedServerArgs(stateDir), streams)).toBe(2);
			expect(readFileSync(statePath, 'utf8')).toBe(saved);
			expect(streams.stderr.read()?.toString()).toMatch(/Encrypted credentials were found/);
		} finally {
			vi.unstubAllEnvs();
		}
	});
});

it('login reports locked storage as exit code 2 without consuming the cookie', async () => {
	const { openCredentialStorage } = await import('../src/credentialStorage');
	const stateDir = mkdtempSync(join(tmpdir(), 'rewst-login-locked-'));
	const owner = await openCredentialStorage(stateDir, 'synthetic-passphrase');
	const streams = io();
	streams.stdin.end('private-cookie');
	try {
		expect(await runCli(['login', '--stdin', '--state-dir', stateDir], streams)).toBe(2);
		expect(streams.stderr.read()?.toString()).toMatch(/Session storage is in use/);
		expect(streams.stdout.read()).toBeNull();
		expect(streams.stdin.read()?.toString()).toBe('private-cookie');
	} finally {
		await owner.close();
		rmSync(stateDir, { recursive: true, force: true });
	}
});
