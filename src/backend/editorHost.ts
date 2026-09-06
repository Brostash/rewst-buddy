import type { Client as SDKClient } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';
import type { ServerResponse } from 'http';
import vscode from 'vscode';
import type { ApprovalOrigin } from '../../packages/mcp-server/src/capabilities/approvalOrigin';
import type { MutationScope } from '../../packages/mcp-server/src/tools/graphqlTool';
import type {
	NamedOrg,
	NamedWorkflow,
	WorkingScopeChangeRequest,
} from '../../packages/mcp-server/src/capabilities/workingScopeCapability';
import {
	workingScopeApprovalText,
	type WorkingScopeApprovalText,
} from '../../packages/mcp-server/src/capabilities/workingScopeCapability';
import type { Response, OpenTemplateRequest } from '../server/types';
import { handleOpenTemplate } from '../server/handlers';
import {
	OPTIONAL_EDITOR_CAPABILITIES,
	runOptionalEditorCapability,
	type EditorCapabilityRequestContext,
} from '../capabilities/registry';
import type { Capability } from '../capabilities/EditorCapability';

/** The private request sent by the shared MCP server to its editor host. */
const EditorRequestSchema = z.object({
	method: z.literal('rewst/editor'),
	params: z.object({
		operation: z.string(),
		input: z.record(z.string(), z.unknown()),
	}),
});

type EditorRequest = z.infer<typeof EditorRequestSchema>;

/** Serializable editor capability metadata sent to the shared MCP server. */
export type EditorCapabilityDescriptor = Omit<Capability, 'run'>;

/**
 * Install the editor side of the private bridge. The handler deliberately only
 * accepts the one custom method used by the shared server; it does not turn the
 * client into a general command/resource dispatch surface.
 */
export function installEditorHost(client: SDKClient): void {
	client.setRequestHandler(EditorRequestSchema, async (request: EditorRequest) => ({
		result: (await handleEditorRequest(request.params.operation, request.params.input)) ?? null,
	}));
}

/** Return the optional editor catalog without exposing executable functions. */
export function getEditorCapabilities(): EditorCapabilityDescriptor[] {
	return OPTIONAL_EDITOR_CAPABILITIES.map(({ run: _run, ...descriptor }) => descriptor);
}

function objectInput(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
	return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
	return value;
}

function origin(value: unknown): ApprovalOrigin {
	// The shared standalone server is an external MCP caller and older bridge
	// callers omit this field; keep that path explicitly external by default.
	if (value === undefined) return 'mcp';
	if (value === 'chat' || value === 'mcp') return value;
	throw new Error('origin must be "chat" or "mcp"');
}

function mutationScope(value: unknown): MutationScope {
	const scope = objectInput(value, 'scope');
	return {
		scopeId: requiredString(scope.scopeId, 'scope.scopeId'),
		scopeName: requiredString(scope.scopeName, 'scope.scopeName'),
		orgId: requiredString(scope.orgId, 'scope.orgId'),
		orgName: requiredString(scope.orgName, 'scope.orgName'),
	};
}

function namedOrgs(value: unknown): NamedOrg[] {
	if (!Array.isArray(value)) throw new Error('request.orgs must be an array');
	return value.map((entry, index) => {
		const org = objectInput(entry, `request.orgs[${index}]`);
		return {
			id: requiredString(org.id, `request.orgs[${index}].id`),
			name: requiredString(org.name, `request.orgs[${index}].name`),
		};
	});
}

function namedWorkflows(value: unknown): NamedWorkflow[] {
	if (!Array.isArray(value)) throw new Error('request.workflows must be an array');
	return value.map((entry, index) => {
		const workflow = objectInput(entry, `request.workflows[${index}]`);
		const result: NamedWorkflow = {
			id: requiredString(workflow.id, `request.workflows[${index}].id`),
			name: requiredString(workflow.name, `request.workflows[${index}].name`),
		};
		if (workflow.orgId !== undefined)
			result.orgId = requiredString(workflow.orgId, `request.workflows[${index}].orgId`);
		return result;
	});
}

function workingScopeRequest(value: unknown): WorkingScopeChangeRequest {
	const request = objectInput(value, 'request');
	if (typeof request.replace !== 'boolean') throw new Error('request.replace must be a boolean');
	return { orgs: namedOrgs(request.orgs), workflows: namedWorkflows(request.workflows), replace: request.replace };
}

/** Shared VS Code mutation approval UI used by local and remote MCP paths. */
export async function requestEditorMutationApproval(
	scope: MutationScope,
	operation: string,
	requestOrigin: ApprovalOrigin,
): Promise<boolean> {
	const requester = requestOrigin === 'chat' ? 'Cage-Free Rewsty' : 'An external MCP client';
	const choice = await vscode.window.showWarningMessage(
		`${requester} wants to run a mutation against ${scope.scopeName} (${scope.scopeId}) in org ${scope.orgName} (${scope.orgId}).`,
		{ modal: true, detail: operation },
		'Approve',
	);
	return choice === 'Approve';
}

/** Shared VS Code working-scope approval UI used by local and remote MCP paths. */
export async function requestEditorWorkingScopeApproval(
	request: WorkingScopeChangeRequest,
	requestOrigin: ApprovalOrigin,
): Promise<boolean> {
	const approvalText: WorkingScopeApprovalText = {
		...workingScopeApprovalText(request, requestOrigin),
	};
	const choice = await vscode.window.showWarningMessage(
		approvalText.message,
		{ modal: true, detail: approvalText.detail },
		'Approve',
	);
	return choice === 'Approve';
}

/** Request a session token through VS Code's password input. */
export async function requestEditorToken(): Promise<string> {
	const token = await vscode.window.showInputBox({
		prompt: 'Paste your Rewst session token or cookie',
		password: true,
		ignoreFocusOut: true,
	});
	if (!token) throw new Error('Session creation cancelled');
	return token;
}

/** Preserve the existing expired-session notification and focus action. */
export function notifyEditorSessionExpired(label: string): void {
	void vscode.window
		.showErrorMessage(
			`Rewst Buddy session "${label}" has expired. Re-authenticate to continue syncing.`,
			'Re-authenticate',
		)
		.then(choice => {
			if (choice === 'Re-authenticate') void vscode.commands.executeCommand('rewst-buddy.FocusSidebar');
		});
}

function captureOpenTemplateResponse(): {
	res: ServerResponse;
	getResponse(): { statusCode: number; body: Response } | undefined;
	response: (res: ServerResponse, statusCode: number, body: Response) => void;
} {
	let captured: { statusCode: number; body: Response } | undefined;
	return {
		res: {} as ServerResponse,
		getResponse: () => captured,
		response: (_res, statusCode, body) => {
			captured = { statusCode, body };
		},
	};
}

async function openTemplate(input: Record<string, unknown>): Promise<Response> {
	const request: OpenTemplateRequest = {
		action: 'openTemplate',
		orgId: requiredString(input.orgId, 'orgId'),
		templateId: requiredString(input.templateId, 'templateId'),
	};
	const capture = captureOpenTemplateResponse();
	await handleOpenTemplate(request, capture.res, capture.response);
	const result = capture.getResponse();
	if (!result) throw new Error('Open-template handler returned no response');
	return result.body;
}

function capabilityContext(input: Record<string, unknown>): EditorCapabilityRequestContext {
	const context = objectInput(input.context, 'context');
	const orgId = requiredString(context.orgId, 'context.orgId');
	if (!Array.isArray(context.profiles)) throw new Error('context.profiles must be an array');
	const profiles = context.profiles as EditorCapabilityRequestContext['profiles'];
	const profile = context.profile as EditorCapabilityRequestContext['profile'];
	return { orgId, profile, profiles };
}

async function runCapability(input: Record<string, unknown>): Promise<string> {
	const name = requiredString(input.name, 'name');
	const args = objectInput(input.args, 'args');
	const capability = OPTIONAL_EDITOR_CAPABILITIES.find(candidate => candidate.spec.name === name);
	if (!capability) throw new Error(`Unknown editor capability: ${name}`);
	return runOptionalEditorCapability(capability, args, capabilityContext(input));
}

/** Dispatch one private editor operation, allowing only explicitly supported operations. */
export async function handleEditorRequest(operation: string, input: Record<string, unknown>): Promise<unknown> {
	switch (operation) {
		case 'capability.run':
			return runCapability(input);
		case 'approval.mutation':
			return requestEditorMutationApproval(
				mutationScope(input.scope),
				requiredString(input.operation, 'operation'),
				origin(input.origin),
			);
		case 'approval.scope':
			return requestEditorWorkingScopeApproval(workingScopeRequest(input.request), origin(input.origin));
		case 'token.request':
			return requestEditorToken();
		case 'browser.openTemplate':
			return openTemplate(input);
		case 'session.expired':
			notifyEditorSessionExpired(requiredString(input.label, 'label'));
			return undefined;
		default:
			throw new Error(`Unknown editor operation: ${operation}`);
	}
}
