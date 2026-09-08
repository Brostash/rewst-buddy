import { z } from 'zod';
import { parseCapabilityInput, toInputSchema } from './capabilities/inputHelpers';
import type { ExtraTool } from './mcpServer';

const schema = z
	.object({
		orgs: z.array(z.string().trim().min(1)).optional(),
		allowWrites: z.boolean().optional(),
		approveWrites: z.boolean().optional(),
		allowGraphqlMutations: z.boolean().optional(),
	})
	.strict();

export interface WriteSettings {
	orgs: string[];
	allowWrites: boolean;
	approveWrites: boolean;
	allowGraphqlMutations: boolean;
}

/** Process-local policy, shared by all connections to a standalone owner. */
export class RuntimeWriteSettings {
	private value: WriteSettings;
	private generation = 0;
	get revision(): number {
		return this.generation;
	}
	private listeners = new Set<() => void>();
	constructor(
		initial: WriteSettings,
		private readonly invalidateApprovals: () => void,
	) {
		this.value = {
			orgs: [...initial.orgs],
			allowWrites: initial.allowWrites,
			approveWrites: initial.approveWrites,
			allowGraphqlMutations: initial.allowGraphqlMutations,
		};
	}
	get(): WriteSettings {
		return { ...this.value, orgs: [...this.value.orgs] };
	}
	onChanged(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	update(input: Record<string, unknown>): WriteSettings {
		const patch = parseCapabilityInput(schema, input);
		const next = { ...this.value, ...patch };
		next.orgs = [...new Set(next.orgs)];
		if ((next.allowWrites || next.approveWrites || next.allowGraphqlMutations) && next.orgs.length === 0)
			throw new Error('Write settings require at least one org.');
		if ((next.approveWrites || next.allowGraphqlMutations) && !next.allowWrites)
			throw new Error('approveWrites and allowGraphqlMutations require allowWrites.');
		const currentOrgs = new Set(this.value.orgs);
		if (
			next.allowWrites === this.value.allowWrites &&
			next.approveWrites === this.value.approveWrites &&
			next.allowGraphqlMutations === this.value.allowGraphqlMutations &&
			next.orgs.length === currentOrgs.size &&
			next.orgs.every(org => currentOrgs.has(org))
		) {
			return this.get();
		}
		this.generation++;
		this.invalidateApprovals();
		this.value = next;
		for (const listener of this.listeners) listener();
		return this.get();
	}
	tools(): ExtraTool[] {
		return [
			{
				name: 'buddy_get_write_settings',
				description:
					'Inspect the standalone server write settings shared by all connected clients. No Rewst session required.',
				inputSchema: { type: 'object', properties: {}, additionalProperties: false },
				run: async () => this.get(),
			},
			{
				name: 'buddy_set_write_settings',
				description:
					'Change standalone server write permissions and org allowlist for ALL connected clients until restart. Request only changes authorized by the user. MCP approval is handled by client tool permissions regardless of approveWrites; built-in editor actions retain host approval. approveWrites is a legacy compatibility setting. Raw GraphQL can affect orgs outside the declared scope. Omitted fields stay unchanged; orgs replaces the allowlist. Clears remembered approvals and pinned working scope. Call tools/list after changing exposure.',
				inputSchema: toInputSchema(schema),
				run: async input => this.update(input),
			},
		];
	}
}
