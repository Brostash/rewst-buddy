import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import ts from 'typescript';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const distRoot = join(packageRoot, 'dist');
const packageVersion = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version;

/**
 * Keep the package independent from VS Code. A transitive vscode import would
 * otherwise produce a bundle that only works inside an extension host.
 */
const rejectVscodePlugin = {
	name: 'reject-vscode-imports',
	setup(build) {
		build.onResolve({ filter: /^vscode(?:\/|$)/ }, args => {
			throw new Error(
				`The standalone MCP package cannot import vscode (from ${args.importer || '<entrypoint>'})`,
			);
		});
	},
};

const baseOptions = {
	absWorkingDir: repoRoot,
	platform: 'node',
	target: 'node22',
	format: 'cjs',
	bundle: true,
	minify: false,
	sourcemap: false,
	legalComments: 'eof',
	define: { __PACKAGE_VERSION__: JSON.stringify(packageVersion) },
	tsconfig: join(packageRoot, 'tsconfig.json'),
	// ws loads these native addons optionally. Keep the optional require in the
	// bundle so installing this package never needs a compiler or native module.
	external: ['bufferutil', 'utf-8-validate'],
	plugins: [rejectVscodePlugin],
};

function assertSafeMetafile(metafile) {
	const vscodeInput = Object.keys(metafile.inputs ?? {}).find(input => /(?:^|[\\/])vscode(?:[\\/]|$)/.test(input));
	if (vscodeInput) {
		throw new Error(`The standalone MCP bundle contains a vscode input: ${vscodeInput}`);
	}
}

function emitDeclarations() {
	const configPath = join(packageRoot, 'tsconfig.json');
	const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
	if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
	const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, packageRoot);
	const program = ts.createProgram(parsed.fileNames, {
		...parsed.options,
		noEmit: false,
		declaration: true,
		emitDeclarationOnly: true,
		declarationMap: false,
		outDir: join(distRoot, 'types'),
	});
	const diagnostics = [...program.getOptionsDiagnostics(), ...program.getSyntacticDiagnostics()];
	if (diagnostics.length > 0) {
		throw new Error(
			ts.formatDiagnosticsWithColorAndContext(diagnostics, {
				getCurrentDirectory: () => repoRoot,
				getCanonicalFileName: file => file,
				getNewLine: () => '\n',
			}),
		);
	}
	const emitted = program.emit(undefined, undefined, undefined, true);
	if (emitted.diagnostics.length > 0) {
		throw new Error(
			ts.formatDiagnosticsWithColorAndContext(emitted.diagnostics, {
				getCurrentDirectory: () => repoRoot,
				getCanonicalFileName: file => file,
				getNewLine: () => '\n',
			}),
		);
	}
	writeFileSync(join(distRoot, 'types', 'package.json'), '{"type":"commonjs"}\n');
}

async function build() {
	rmSync(distRoot, { recursive: true, force: true });
	mkdirSync(distRoot, { recursive: true });

	const [indexResult, cliResult] = await Promise.all([
		esbuild.build({
			...baseOptions,
			entryPoints: [join(packageRoot, 'src/index.ts')],
			outfile: join(distRoot, 'index.cjs'),
			metafile: true,
		}),
		esbuild.build({
			...baseOptions,
			entryPoints: [join(packageRoot, 'src/cli.ts')],
			outfile: join(distRoot, 'cli.cjs'),
			banner: { js: '#!/usr/bin/env node' },
			metafile: true,
		}),
	]);

	const metafile = {
		inputs: { ...(indexResult.metafile?.inputs ?? {}), ...(cliResult.metafile?.inputs ?? {}) },
		outputs: { ...(indexResult.metafile?.outputs ?? {}), ...(cliResult.metafile?.outputs ?? {}) },
	};
	assertSafeMetafile(metafile);
	writeFileSync(join(distRoot, 'metafile.json'), `${JSON.stringify(metafile, null, 2)}\n`);
	emitDeclarations();
	// Keep the package license beside package.json so npm includes it in the
	// candidate. README.md is maintained as standalone package documentation.
	copyFileSync(join(repoRoot, 'LICENSE'), join(packageRoot, 'LICENSE'));
	chmodSync(join(distRoot, 'cli.cjs'), 0o755);
}

await build();
