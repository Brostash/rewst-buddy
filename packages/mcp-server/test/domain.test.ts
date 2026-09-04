import { describe, expect, it } from 'vitest';

describe('standalone server domain', () => {
	it('does not import the VS Code runtime', async () => {
		const fs = await import('node:fs/promises');
		const path = await import('node:path');
		const root = path.resolve(import.meta.dirname, '../src');
		const domainDirs = ['workflow', 'crates', 'tools', 'utils', 'providers'];
		const standaloneFiles = ['editorData.ts'];
		const files: string[] = [];
		async function collect(dir: string): Promise<void> {
			for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) await collect(full);
				else if (entry.name.endsWith('.ts')) files.push(full);
			}
		}
		for (const dir of domainDirs) await collect(path.join(root, dir));
		files.push(...standaloneFiles.map(name => path.join(root, name)));
		for (const file of files) {
			const source = await fs.readFile(file, 'utf8');
			expect(source).not.toMatch(/(?:from\s+|import\s*\()(['"])vscode\1/);
		}
	});

	it('keeps template reference extraction available', async () => {
		const { findAllTemplateReferences } = await import('../src/providers/templatePatternUtils.js');
		expect(
			findAllTemplateReferences(
				'{{ template(\'11111111-1111-1111-1111-111111111111\') }} {{ template("22222222-2222-2222-2222-222222222222") }}',
			),
		).toEqual(['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']);
	});
});
