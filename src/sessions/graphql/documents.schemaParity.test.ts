import * as assert from 'node:assert';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSchema, parse, validate } from 'graphql';
import ts from 'typescript';
import { suite, test } from '../../test/tdd';

const SOURCE_ROOTS = ['src'];

async function sourceFiles(root: string): Promise<string[]> {
	const entries = await readdir(root, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (entry.isDirectory() && !['test', 'generated'].includes(entry.name))
			files.push(...(await sourceFiles(path)));
		else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(path);
	}
	return files;
}

function declarationsByName(sourceFile: ts.SourceFile): Map<string, ts.Expression> {
	const declarations = new Map<string, ts.Expression>();
	const duplicates = new Set<string>();
	const visit = (node: ts.Node): void => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			const name = node.name.text;
			if (declarations.has(name)) duplicates.add(name);
			else declarations.set(name, node.initializer);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	for (const duplicate of duplicates) declarations.delete(duplicate);
	return declarations;
}

function evaluateStaticString(
	expression: ts.Expression,
	declarations: ReadonlyMap<string, ts.Expression>,
	seen = new Set<string>(),
): string | undefined {
	if (ts.isStringLiteralLike(expression)) return expression.text;
	if (ts.isParenthesizedExpression(expression)) {
		return evaluateStaticString(expression.expression, declarations, seen);
	}
	if (ts.isIdentifier(expression)) {
		if (seen.has(expression.text)) return undefined;
		const initializer = declarations.get(expression.text);
		if (!initializer) return undefined;
		const nextSeen = new Set(seen);
		nextSeen.add(expression.text);
		return evaluateStaticString(initializer, declarations, nextSeen);
	}
	if (ts.isTemplateExpression(expression)) {
		let value = expression.head.text;
		for (const span of expression.templateSpans) {
			const interpolated = evaluateStaticString(span.expression, declarations, seen);
			if (interpolated === undefined) return undefined;
			value += interpolated + span.literal.text;
		}
		return value;
	}
	if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
		const left = evaluateStaticString(expression.left, declarations, seen);
		const right = evaluateStaticString(expression.right, declarations, seen);
		return left === undefined || right === undefined ? undefined : left + right;
	}
	if (
		ts.isCallExpression(expression) &&
		expression.arguments.length === 0 &&
		ts.isPropertyAccessExpression(expression.expression) &&
		expression.expression.name.text === 'trim'
	) {
		return evaluateStaticString(expression.expression.expression, declarations, seen)?.trim();
	}
	return undefined;
}

interface StaticDocument {
	file: string;
	name: string;
	document: string;
}

async function staticGraphqlDocuments(file: string): Promise<StaticDocument[]> {
	const source = await readFile(file, 'utf8');
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const declarations = declarationsByName(sourceFile);
	const documents: StaticDocument[] = [];
	const seen = new Set<string>();
	const add = (expression: ts.Expression, name: string): void => {
		const document = evaluateStaticString(expression, declarations)?.trim();
		if (
			document &&
			/^(query|mutation|subscription)\b/.test(document) &&
			document.includes('{') &&
			!seen.has(document)
		) {
			seen.add(document);
			documents.push({ file, name, document });
		}
	};
	const visit = (node: ts.Node): void => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			add(node.initializer, node.name.text);
		}
		if (ts.isCallExpression(node)) {
			for (const argument of node.arguments)
				add(argument, `inline at ${sourceFile.getLineAndCharacterOfPosition(node.pos).line + 1}`);
		}
		if (ts.isTaggedTemplateExpression(node)) {
			add(node.template, `tagged at ${sourceFile.getLineAndCharacterOfPosition(node.pos).line + 1}`);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return documents;
}

suite('Unit: committed GraphQL document/schema parity', () => {
	test('every static runtime GraphQL document validates against the committed schema', async () => {
		const schema = buildSchema(await readFile('src/sessions/graphql/schema.graphql', 'utf8'));
		const files = (await Promise.all(SOURCE_ROOTS.map(sourceFiles))).flat();
		const documents = (await Promise.all(files.map(staticGraphqlDocuments))).flat();
		assert.ok(documents.length >= 45, `expected broad runtime coverage, found only ${documents.length} documents`);

		const failures: string[] = [];
		for (const { file, name, document } of documents) {
			let parsed;
			try {
				parsed = parse(document);
			} catch (error) {
				failures.push(`${file}:${name}: parse failed: ${String(error)}`);
				continue;
			}
			for (const error of validate(schema, parsed)) {
				failures.push(`${file}:${name}: ${error.message}`);
			}
		}

		assert.deepStrictEqual(failures, []);
	});

	test('typed SDK operation files and fragments validate together against the snapshot', async () => {
		const root = 'src/sessions/graphql';
		const schema = buildSchema(await readFile(join(root, 'schema.graphql'), 'utf8'));
		const documents = (await readdir(root)).filter(file => file.endsWith('.graphql') && file !== 'schema.graphql');
		assert.ok(documents.length > 0);
		const parsed = parse((await Promise.all(documents.map(file => readFile(join(root, file), 'utf8')))).join('\n'));
		assert.deepStrictEqual(
			validate(schema, parsed).map(error => error.message),
			[],
		);
	});
});
