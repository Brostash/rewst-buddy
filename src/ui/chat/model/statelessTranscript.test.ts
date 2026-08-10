import * as assert from 'assert';
import * as Mocha from 'mocha';
import { initTestEnvironment } from '@test';
import vscode from 'vscode';
import { serializeVisibleChat } from './statelessTranscript';

const { suite, test, setup } = Mocha;
const { User, Assistant } = vscode.LanguageModelChatMessageRole;
// The installed API enum only declares User/Assistant; system prompts arrive
// with a role outside that set, so tests simulate them with a raw value.
const System = 3 as unknown as vscode.LanguageModelChatMessageRole;

function message(role: vscode.LanguageModelChatMessageRole, content: unknown[]) {
	return { role, content, name: undefined };
}

function text(value: string): vscode.LanguageModelTextPart {
	return new vscode.LanguageModelTextPart(value);
}

suite('Unit: statelessTranscript', () => {
	setup(initTestEnvironment);

	test('serializes text as role-aware seed chunks and skips system messages', () => {
		const chunks = serializeVisibleChat([
			message(System, [text('hidden system prompt')]),
			message(User, [text('what is a trigger?')]),
			message(Assistant, [text('An event that starts a workflow.')]),
		]);

		assert.deepStrictEqual(chunks, [
			{ role: 'USER', content: 'what is a trigger?' },
			{ role: 'ASSISTANT', content: 'An event that starts a workflow.' },
		]);
	});

	test('serializes tool calls and results as USER entries', () => {
		const call = new vscode.LanguageModelToolCallPart('call-1', 'read_file', { path: 'a.txt' });
		const result = new vscode.LanguageModelToolResultPart('call-1', [text('file contents')]);
		const chunks = serializeVisibleChat([
			message(User, [text('check a.txt')]),
			message(Assistant, [text('Looking.'), call]),
			message(User, [result]),
		]);

		assert.deepStrictEqual(chunks, [
			{ role: 'USER', content: 'check a.txt' },
			{ role: 'ASSISTANT', content: 'Looking.' },
			{
				role: 'USER',
				content:
					'Requested editor tool: read_file {"path":"a.txt"}\nEditor tool result: read_file {"path":"a.txt"}\nfile contents',
			},
		]);
	});

	test('chunks only at entry boundaries and keeps every chunk within 50k', () => {
		const chunks = serializeVisibleChat([
			message(User, [text('a'.repeat(30_000))]),
			message(User, [text('b'.repeat(30_000))]),
			message(Assistant, [text('answer')]),
		]);

		assert.deepStrictEqual(
			chunks.map(chunk => chunk.content.length),
			[30_000, 30_000, 6],
		);
		assert.ok(chunks.every(chunk => chunk.content.length <= 50_000));
	});

	test('truncates a single oversized entry below 50k with an explicit marker', () => {
		const [chunk] = serializeVisibleChat([message(User, [text('x'.repeat(60_000))])]);
		assert.strictEqual(chunk.role, 'USER');
		assert.ok(chunk.content.endsWith('...(truncated)'));
		assert.ok(chunk.content.length <= 48_000);
	});

	test('drops oldest entries above the total ceiling and adds an omission marker', () => {
		const messages = Array.from({ length: 10 }, (_, i) => message(User, [text(`${i}:` + 'x'.repeat(44_000))]));
		const chunks = serializeVisibleChat(messages);
		const content = chunks.map(chunk => chunk.content).join('\n');
		assert.match(content, /^\(\d+ earlier message\(s\) omitted\)/);
		assert.ok(!content.includes('0:'), 'oldest entry is dropped');
		assert.ok(content.includes('9:'), 'newest entry is retained');
		assert.ok(chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) <= 400_000);
	});

	test('strips activity and tightly frames terminal output', () => {
		const call = new vscode.LanguageModelToolCallPart('call-1', 'run_in_terminal', { command: 'ls' });
		const result = new vscode.LanguageModelToolResultPart('call-1', [text('x'.repeat(5_000))]);
		const chunks = serializeVisibleChat([
			message(Assistant, [text('Before\n> _Searching documentation..._\nAfter'), call]),
			message(User, [result]),
		]);
		const content = chunks.map(chunk => chunk.content).join('\n');
		assert.ok(!content.includes('Searching documentation'));
		assert.match(content, /raw terminal output — likely unrelated/);
		assert.ok(content.includes('...(truncated)'));
	});
});
