import { describe, expect, it } from 'vitest';
import { buildUnpackInput, parseCrateDetail } from '../src/crates/crateUnpack.js';
import { normalizePublish } from '../src/workflow/types.js';

describe('standalone workflow and crate domains', () => {
	it('normalizes publish entries from both supported wire shapes', () => {
		expect(normalizePublish({ result: '{{ CTX.result }}' })).toEqual([
			{ key: 'result', value: '{{ CTX.result }}' },
		]);
		expect(normalizePublish([{ key: 'status', value: 'ok' }])).toEqual([{ key: 'status', value: 'ok' }]);
	});

	it('parses crate tokens and serializes defaults into unpack input', () => {
		const crate = parseCrateDetail({
			crate: {
				id: 'crate-1',
				name: 'Example',
				tokens: [
					{
						id: 'token-1',
						name: 'regions',
						type: 'select',
						index: 1,
						isMultiselect: true,
						options: [
							{ value: 'us', isDefault: true },
							{ value: 'eu', isDefault: true },
						],
					},
				],
				crateTriggers: [],
				workflow: { name: 'Example workflow', humanSecondsSaved: 10 },
			},
		});
		expect(crate).toBeDefined();
		expect(buildUnpackInput(crate!, { orgId: 'org-1' }).tokenArguments).toEqual([
			{ crateTokenId: 'token-1', value: '{{ ["us","eu"] }}' },
		]);
	});
});
