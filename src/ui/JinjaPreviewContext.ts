/**
 * Pure helpers for the Jinja preview panel's context-pick flow.
 * No VS Code QuickPick UI here — only data assembly and cache-key logic
 * that can be unit-tested without a real webview.
 */

import vscode from 'vscode';
import { editorDataClient } from '../backend/editorDataClient';
import type { JinjaPreviewContextEntry } from '../models/JinjaPreviewContextStore';
import type {
	PreviewExecutionRow as ExecutionRow,
	PreviewWorkflowRow as WorkflowRow,
} from '../backend/editorDataClient';

// ---------------------------------------------------------------------------
// mergeExecutionContext
// ---------------------------------------------------------------------------

/**
 * Fetch and merge all context snapshots for an execution into one object.
 * Later snapshots win on key conflicts (same semantics as runRenderJinja).
 */
export function mergeExecutionContext(
	sessionId: string,
	orgId: string,
	executionId: string,
): Promise<Record<string, unknown>>;
/** @deprecated Kept as a type-compatible migration seam; data access requires a session id. */
export function mergeExecutionContext(legacyDeps: unknown, executionId: string): Promise<Record<string, unknown>>;
export async function mergeExecutionContext(
	sessionOrLegacy: unknown,
	orgIdOrExecutionId: string,
	executionId?: string,
): Promise<Record<string, unknown>> {
	if (typeof sessionOrLegacy !== 'string' || executionId === undefined) {
		throw new Error('Jinja preview context now requires sessionId and orgId.');
	}
	return editorDataClient.getPreviewContext({
		sessionId: sessionOrLegacy,
		orgId: orgIdOrExecutionId,
		executionId,
	});
}

// ---------------------------------------------------------------------------
// buildExecutionQuickPickItems
// ---------------------------------------------------------------------------

export interface ExecutionQuickPickItem extends vscode.QuickPickItem {
	executionId: string;
	orgId?: string;
}

/**
 * Convert a list of ExecutionRow objects into VS Code QuickPickItems,
 * sorted newest-first by createdAt.
 */
export function buildExecutionQuickPickItems(rows: ExecutionRow[]): ExecutionQuickPickItem[] {
	const sorted = [...rows].sort((a, b) => {
		const ta = Number(a.createdAt ?? 0);
		const tb = Number(b.createdAt ?? 0);
		return tb - ta;
	});
	return sorted.map(row => ({
		label: `$(history) ${row.status ?? 'unknown'} — ${row.id ?? '?'}`,
		detail: row.createdAt ? new Date(Number(row.createdAt)).toLocaleString() : undefined,
		description: row.id ?? undefined,
		executionId: row.id ?? '',
		orgId: row.orgId ?? undefined,
	}));
}

// ---------------------------------------------------------------------------
// buildWorkflowQuickPickItems
// ---------------------------------------------------------------------------

export interface JinjaPreviewOrgPickItem extends vscode.QuickPickItem {
	orgId: string;
	orgName: string;
	sessionId?: string;
}

interface WorkflowQuickPickItem extends vscode.QuickPickItem {
	workflowId: string;
	workflowName: string;
	orgId: string;
}

function buildWorkflowQuickPickItems(rows: WorkflowRow[], orgId: string): WorkflowQuickPickItem[] {
	return rows.map(row => ({
		label: row.name ?? '(unnamed)',
		description: row.id ?? undefined,
		workflowId: row.id ?? '',
		workflowName: row.name ?? '(unnamed)',
		orgId: row.orgId ?? orgId,
	}));
}

function optionsSessionId(
	resolver: ((orgId: string) => string | undefined) | undefined,
	item: JinjaPreviewOrgPickItem,
): string | undefined {
	return resolver?.(item.orgId) ?? item.sessionId;
}

// ---------------------------------------------------------------------------
// pickJinjaExecutionContext
// ---------------------------------------------------------------------------

export interface PickJinjaExecutionContextOptions {
	orgItems: JinjaPreviewOrgPickItem[];
	sessionIdForOrg?: (orgId: string) => string | undefined;
	/** @deprecated Data access is handled by editorDataClient. */
	depsForOrg?: unknown;
	initialOrgId?: string;
}

/**
 * Full three-step QuickPick flow: pick an org, pick one workflow in that org,
 * then pick an execution. Returns undefined if the user cancels any step.
 */
export async function pickJinjaExecutionContext({
	orgItems,
	sessionIdForOrg,
	initialOrgId,
}: PickJinjaExecutionContextOptions): Promise<JinjaPreviewContextEntry | undefined> {
	if (orgItems.length === 0) {
		void vscode.window.showWarningMessage('No organizations are available for Jinja preview context.');
		return undefined;
	}

	const pickedOrg = await vscode.window.showQuickPick(orgItems, {
		placeHolder: 'Select an organization to load workflows from',
		title: 'Jinja Preview: Pick Org',
	});
	if (!pickedOrg) return undefined;

	const sessionId = optionsSessionId(sessionIdForOrg, pickedOrg);
	if (!sessionId) throw new Error(`No active session found for organization "${pickedOrg.orgId}".`);
	const workflowRows = await editorDataClient.listPreviewWorkflows({ sessionId, orgId: pickedOrg.orgId });
	const workflowItems = buildWorkflowQuickPickItems(workflowRows, pickedOrg.orgId);
	if (workflowItems.length === 0) {
		void vscode.window.showWarningMessage(`No workflows found for organization "${pickedOrg.orgName}".`);
		return undefined;
	}

	const pickedWorkflow = await vscode.window.showQuickPick(workflowItems, {
		placeHolder: 'Select a workflow to pick an execution context from',
		title: 'Jinja Preview: Pick Workflow',
		matchOnDescription: true,
	});
	if (!pickedWorkflow) return undefined;

	// Step 2: execution pick. The backend checks the selected org first; a
	// workflow that only ever runs as a sub-workflow can then fall back to its
	// workflow id alone (mirrors buddy_workflow_executions' rootOnly:false behavior).
	const execRows = await editorDataClient.listPreviewExecutions({
		sessionId,
		orgId: pickedWorkflow.orgId,
		workflowId: pickedWorkflow.workflowId,
	});

	const execItems = buildExecutionQuickPickItems(execRows);

	if (execItems.length === 0) {
		void vscode.window.showWarningMessage(
			`No recent executions found for workflow "${pickedWorkflow.workflowName}".`,
		);
		return undefined;
	}

	const pickedExec = await vscode.window.showQuickPick(execItems, {
		placeHolder: 'Select an execution to use as render context',
		title: 'Jinja Preview: Pick Execution',
	});
	if (!pickedExec) return undefined;

	return {
		workflowId: pickedWorkflow.workflowId,
		workflowName: pickedWorkflow.workflowName,
		orgId: pickedExec.orgId || pickedWorkflow.orgId || initialOrgId || pickedOrg.orgId,
		executionId: pickedExec.executionId,
	};
}
