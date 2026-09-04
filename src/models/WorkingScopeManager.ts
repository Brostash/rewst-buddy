import vscode from 'vscode';
import { invoke, subscribe } from '../backend/operations';
import { log } from '@utils';
export type { WorkingScopeState } from '../../packages/mcp-server/src/models/WorkingScopeManager';
import type { WorkingScopeState } from '../../packages/mcp-server/src/models/WorkingScopeManager';
type Snapshot = WorkingScopeState & { namedWorkflows?: { id: string; name: string }[] };

/** UI cache. The server owns the authoritative scope and persists all changes. */
export const WorkingScopeManager = new (class implements vscode.Disposable {
	readonly stateKey = 'RewstWorkingScope';
	private state: WorkingScopeState = { orgs: [], workflows: [] };
	readonly workflowNames = new Map<string, string>();
	private readonly emitter = new vscode.EventEmitter<WorkingScopeState>();
	readonly onDidChangeScope = this.emitter.event;
	private listener?: vscode.Disposable;
	init(): this {
		this.listener = subscribe(event => {
			const value = event as { type?: string; snapshot?: Snapshot };
			if (value.type === 'scope' && value.snapshot) this.accept(value.snapshot);
		});
		void invoke<Snapshot>('scope.snapshot', {})
			.then(snapshot => this.accept(snapshot))
			.catch(error => log.error('Failed to load working scope', error));
		return this;
	}
	private accept(snapshot: Snapshot): void {
		this.state = { orgs: [...snapshot.orgs], workflows: [...snapshot.workflows] };
		this.workflowNames.clear();
		for (const workflow of snapshot.namedWorkflows ?? []) this.workflowNames.set(workflow.id, workflow.name);
		this.emitter.fire(this.snapshot());
	}
	private async change(method: string, args: Record<string, unknown> = {}): Promise<void> {
		this.accept(await invoke<Snapshot>('scope.change', { method, ...args }));
	}
	getOrgs(): string[] {
		return [...this.state.orgs];
	}
	getWorkflows(): string[] {
		return [...this.state.workflows];
	}
	hasOrg(id: string): boolean {
		return this.state.orgs.includes(id);
	}
	hasWorkflow(id: string): boolean {
		return this.state.workflows.includes(id);
	}
	isEmpty(): boolean {
		return this.state.orgs.length === 0 && this.state.workflows.length === 0;
	}
	snapshot(): WorkingScopeState {
		return { orgs: this.getOrgs(), workflows: this.getWorkflows() };
	}
	setOrgs(ids: readonly string[]): Promise<void> {
		return this.change('setOrgs', { ids });
	}
	addOrgs(ids: readonly string[]): Promise<void> {
		return this.change('addOrgs', { ids });
	}
	removeOrgs(ids: readonly string[]): Promise<void> {
		return this.change('removeOrgs', { ids });
	}
	setWorkflows(ids: readonly string[]): Promise<void> {
		return this.change('setWorkflows', { ids });
	}
	addWorkflows(ids: readonly string[]): Promise<void> {
		return this.change('addWorkflows', { ids });
	}
	removeWorkflows(ids: readonly string[]): Promise<void> {
		return this.change('removeWorkflows', { ids });
	}
	applyChange(
		change: { orgs?: readonly string[]; workflows?: readonly string[]; replace?: boolean },
		namedWorkflows?: readonly { id: string; name: string }[],
	): Promise<void> {
		return this.change('applyChange', { change, namedWorkflows });
	}
	clear(): Promise<void> {
		return this.change('clear');
	}
	dispose(): void {
		this.listener?.dispose();
		this.emitter.dispose();
	}
	_resetForTesting(): void {
		this.state = { orgs: [], workflows: [] };
		this.workflowNames.clear();
	}
	_reloadForTesting(): void {
		void invoke<Snapshot>('scope.snapshot', {}).then(value => this.accept(value));
	}
})();
