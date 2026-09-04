import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/crates/unpackClient', () => ({ runUnpackCrate: vi.fn() }));
import { editorDataOperations, clearEditorDataCachesForTesting } from '../src/editorData';
import { runUnpackCrate } from '../src/crates/unpackClient';
import { SessionManager } from '../src/sessions/index';

function installSession(rawGraphql: (query: string, variables?: Record<string, unknown>) => Promise<unknown>): void {
	SessionManager.sessionMap.clear();
	SessionManager.sessionMap.set('user-1', {
		profile: {
			user: { id: 'user-1' },
			org: { id: 'org-1', name: 'Org One' },
			allManagedOrgs: [{ id: 'org-1', name: 'Org One' }],
			region: { graphqlUrl: 'https://api.rewst.io/graphql' },
		},
		ensureValid: vi.fn(async () => true),
		rawGraphql,
	} as never);
}

describe('editor data operations', () => {
	beforeEach(() => {
		clearEditorDataCachesForTesting();
		SessionManager.sessionMap.clear();
	});

	it('exposes the bounded editor operation names and requires an active session', async () => {
		expect(Object.keys(editorDataOperations).sort()).toEqual([
			'crates.detail',
			'crates.list',
			'crates.unpack',
			'jinja.filters',
			'jinja.render',
			'preview.context',
			'preview.executions',
			'preview.workflows',
		]);
		await expect(
			editorDataOperations['preview.workflows'](
				{ sessionId: 'missing', orgId: 'org-1' },
				{
					signal: new AbortController().signal,
					emit: async () => {},
				},
			),
		).rejects.toThrow(/active session/i);
	});

	it('validates organization ownership before running a workflow picker query', async () => {
		const rawGraphql = vi.fn(async () => ({ data: { workflows: [] } }));
		installSession(rawGraphql);
		await expect(
			editorDataOperations['preview.workflows'](
				{ sessionId: 'user-1', orgId: 'other-org' },
				{
					signal: new AbortController().signal,
					emit: async () => {},
				},
			),
		).rejects.toThrow(/does not manage organization/i);
		expect(rawGraphql).not.toHaveBeenCalled();
	});

	it('renders through the session operation and preserves the structured result', async () => {
		const rawGraphql = vi.fn(async (query: string) =>
			query.includes('RewstBuddyRenderJinja')
				? { data: { renderJinja: { result: { answer: 42 } } } }
				: { data: {} },
		);
		installSession(rawGraphql);
		const result = await editorDataOperations['jinja.render'](
			{ sessionId: 'user-1', orgId: 'org-1', template: '{{ CTX.answer }}', vars: {} },
			{ signal: new AbortController().signal, emit: async () => {} },
		);
		expect(result).toEqual({ ok: true, value: { answer: 42 }, hasControlCharacter: false });
		expect(rawGraphql).toHaveBeenCalledWith(expect.stringContaining('RewstBuddyRenderJinja'), {
			orgId: 'org-1',
			template: '{{ CTX.answer }}',
			vars: {},
		});
	});

	it.each([
		{ kind: 'leading and trailing whitespace', template: ' \t{{ CTX.answer }}\r\n ' },
		{ kind: 'whitespace-only text', template: ' \t\r\n ' },
		{ kind: 'empty text', template: '' },
	])('preserves $kind when rendering a template', async ({ template }) => {
		const rawGraphql = vi.fn(async (_query: string, variables?: Record<string, unknown>) => ({
			data: { renderJinja: { result: variables?.template } },
		}));
		installSession(rawGraphql);
		const result = await editorDataOperations['jinja.render'](
			{ sessionId: 'user-1', orgId: 'org-1', template, vars: {} },
			{ signal: new AbortController().signal, emit: async () => {} },
		);
		expect(rawGraphql).toHaveBeenCalledWith(expect.stringContaining('RewstBuddyRenderJinja'), {
			orgId: 'org-1',
			template,
			vars: {},
		});
		expect(result).toEqual({ ok: true, value: template, hasControlCharacter: false });
	});

	it.each([undefined, null, 42, false, {}, []])('rejects a non-string template: %j', async template => {
		const rawGraphql = vi.fn(async () => ({ data: {} }));
		installSession(rawGraphql);
		await expect(
			editorDataOperations['jinja.render'](
				{ sessionId: 'user-1', orgId: 'org-1', template, vars: {} },
				{ signal: new AbortController().signal, emit: async () => {} },
			),
		).rejects.toThrow(/template/);
		expect(rawGraphql).not.toHaveBeenCalled();
	});

	it('requires preview context executions to belong to the requested organization', async () => {
		const rawGraphql = vi.fn(async (query: string) => {
			if (query.includes('RewstBuddyExecutionOwner')) {
				return { data: { workflowExecution: { id: 'exec-1', orgId: 'org-1' } } };
			}
			if (query.includes('RewstBuddyExecutionContexts')) {
				return { data: { workflowExecutionContexts: [{ answer: 42 }] } };
			}
			return { data: {} };
		});
		installSession(rawGraphql);
		await expect(
			editorDataOperations['preview.context'](
				{ sessionId: 'user-1', orgId: 'org-1', executionId: 'exec-1' },
				{ signal: new AbortController().signal, emit: async () => {} },
			),
		).resolves.toEqual({ answer: 42 });

		rawGraphql.mockImplementation(async (query: string) =>
			query.includes('RewstBuddyExecutionOwner')
				? { data: { workflowExecution: { id: 'exec-1', orgId: 'other-org' } } }
				: { data: { workflowExecutionContexts: [{ leaked: true }] } },
		);
		await expect(
			editorDataOperations['preview.context'](
				{ sessionId: 'user-1', orgId: 'org-1', executionId: 'exec-1' },
				{ signal: new AbortController().signal, emit: async () => {} },
			),
		).rejects.toThrow(/not available in organization/i);
		expect(rawGraphql).not.toHaveBeenLastCalledWith(
			expect.stringContaining('RewstBuddyExecutionContexts'),
			expect.anything(),
		);
	});

	it('correlates crate unpack progress with the caller stream', async () => {
		const rawGraphql = vi.fn(async (query: string) =>
			query.includes('RewstBuddyCrateDetail')
				? {
						data: {
							crate: {
								id: 'crate-1',
								name: 'Starter',
								requiredOrgVariables: [],
								tokens: [],
								crateTriggers: [],
								workflow: { name: 'Starter workflow', humanSecondsSaved: 0 },
							},
						},
					}
				: { data: {} },
		);
		installSession(rawGraphql);
		const run = vi.mocked(runUnpackCrate);
		run.mockImplementation(async options => {
			options.onProgress?.('exporting');
			return { id: 'workflow-1' };
		});
		const events: unknown[] = [];
		const result = await editorDataOperations['crates.unpack'](
			{
				sessionId: 'user-1',
				orgId: 'org-1',
				crateId: 'crate-1',
				streamId: 'stream-123',
				tokenValues: {},
				enableTriggers: false,
			},
			{ signal: new AbortController().signal, emit: async event => void events.push(event) },
		);

		expect(result).toEqual({ id: 'workflow-1' });
		expect(events).toEqual([{ type: 'progress', streamId: 'stream-123', label: 'exporting' }]);
		expect(run).toHaveBeenCalledWith(
			expect.objectContaining({ input: expect.objectContaining({ crateId: 'crate-1', orgId: 'org-1' }) }),
		);
	});
});
