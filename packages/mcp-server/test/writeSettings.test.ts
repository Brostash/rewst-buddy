import { describe, expect, it, vi } from 'vitest';
import { RuntimeWriteSettings } from '../src/writeSettings';

const initial = { orgs: [], allowWrites: false, approveWrites: false, allowGraphqlMutations: false };
describe('runtime write settings validation', () => {
	it('rejects malformed and inconsistent updates atomically', () => {
		const invalidate = vi.fn();
		const settings = new RuntimeWriteSettings(initial, invalidate);
		for (const input of [
			{ allowWrites: 'true' },
			{ orgs: [' '] },
			{ orgs: [1] },
			{ unexpected: true },
			{ allowWrites: true },
			{ approveWrites: true, orgs: ['a'] },
			{ allowGraphqlMutations: true, orgs: ['a'] },
		]) {
			expect(() => settings.update(input)).toThrow();
			expect(settings.get()).toEqual(initial);
		}
		expect(invalidate).not.toHaveBeenCalled();
	});
	it('replaces orgs, preserves omitted settings, and protects snapshots from mutation', () => {
		const settings = new RuntimeWriteSettings(initial, vi.fn());
		settings.update({ orgs: [' a ', 'a'], allowWrites: true, approveWrites: true });
		const snapshot = settings.get();
		snapshot.orgs.push('unexpected');
		expect(settings.get().orgs).toEqual(['a']);
		expect(settings.update({ orgs: ['b'] })).toMatchObject({ orgs: ['b'], approveWrites: true });
	});
});
