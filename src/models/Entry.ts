import { RewstClient } from '@client';
import { CommandContext } from '@commands';
import { RewstFS } from '@fs';
import { log } from '@log';
import path from 'path';
import { uuidv7 } from 'uuidv7';
import vscode from 'vscode';
export enum RType {
	Root,
	Org,
	Template,
	TemplateFolder,
}

export interface LabelValidationResult {
	isValid: boolean;
	error?: string;
	conflictingLabel?: string;
}

export interface ContextValueParams {
	isTemplate: boolean;
	hasTemplates: boolean;
	hasTemplateFolders: boolean;
	isRenamable: boolean;
	isTemplateFolder: boolean;
	isOrg?: boolean;
}

export interface EntryInput {
	id?: string;
	label?: string | vscode.TreeItemLabel;
	client: RewstClient;
	ext?: string;
	parent?: Entry;
}

interface IEntry extends EntryInput, vscode.TreeItem, vscode.FileStat {
	rtype: RType;
	orgId: string;

	initialized: boolean;
	initialize(...args: any): Promise<void>;

	getUri(): vscode.Uri;

	getChildren(): Promise<Entry[]>;

	getLabel(): string;
	setLabel(label: string): Promise<boolean> | void;
	isValidLabel(label: string, forbiddenLabels?: string[]): LabelValidationResult;

	contextValueParams: ContextValueParams;
	getContextValue(params: ContextValueParams): string;

	addChild(child: Entry): void;
	removeChild(child: Entry): boolean;
	setParent(newParent: Entry): void;

	serialize(): Promise<string>;

	getCommand(): vscode.Command | undefined | Promise<vscode.Command | undefined>;
	getTreeItem(): Promise<vscode.TreeItem>;

	readData(): string | Promise<string>;
	writeData(data: string): boolean | Promise<boolean>;
}

export abstract class Entry implements IEntry {
	contextValueParams: ContextValueParams;
	abstract rtype: RType;

	initialized = false;

	ctime: number;
	mtime: number;
	size: number;
	permissions?: vscode.FilePermission | undefined;
	type: vscode.FileType = vscode.FileType.Unknown;
	id: string;

	parent?: Entry;
	children: Entry[] = [];

	orgId: string;
	client: RewstClient;
	ext?: string;
	label: string;
	contextValue: string;
	iconPath?: string | vscode.IconPath | undefined;
	description?: string | boolean | undefined;
	resourceUri?: vscode.Uri | undefined;
	tooltip?: string | vscode.MarkdownString | undefined;
	command?: vscode.Command | undefined;
	collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
	accessibilityInformation?: vscode.AccessibilityInformation | undefined;
	checkboxState?:
		| vscode.TreeItemCheckboxState
		| {
				readonly state: vscode.TreeItemCheckboxState;
				readonly tooltip?: string;
				readonly accessibilityInformation?: vscode.AccessibilityInformation;
		  }
		| undefined;

	constructor(input: EntryInput, contextValueParams: ContextValueParams) {
		if (typeof input?.label !== 'string') {
			log.error(`Entry constructor failed: invalid label type ${typeof input?.label}`);
			throw new Error('');
		}

		log.info(`Creating Entry: ${input.label} (id: ${input.id || 'new'}, type: ${this.constructor.name})`);

		this.label = input.label;
		this.client = input.client;
		this.orgId = this.client?.orgId ?? '';
		this.ext = input.ext;
		this.ctime = Date.now();
		this.mtime = Date.now();
		this.size = 0;

		this.id = input.id ?? uuidv7();

		if (input.parent) {
			this.setParent(input.parent);
		}

		this.contextValueParams = contextValueParams ?? {
			isTemplate: false,
			hasTemplates: false,
			hasTemplateFolders: false,
			isRenamable: false,
			isTemplateFolder: false,
		};

		this.contextValue = this.getContextValue();
		log.info(`Successfully created Entry: ${this.label} (${this.id})`);
	}

	async getTreeItem(): Promise<vscode.TreeItem> {
		const item: vscode.TreeItem = {
			...this,
			resourceUri: this.getUri(),
			command: this.getCommand(),
		};
		return item;
	}

	abstract initialize(): Promise<void>;

	abstract getCommand(): vscode.Command | undefined | Promise<vscode.Command | undefined>;

	abstract serialize(): Promise<string>;

	abstract setLabel(label: string): void | Promise<boolean>;

	abstract readData(): Promise<string>;
	abstract writeData(data: string): Promise<boolean>;

	async getChildren(): Promise<Entry[]> {
		if (!this.initialized) {
			await this.initialize();
		}
		return [...this.children];
	}

	getUri(): vscode.Uri {
		if (this.parent === undefined) {
			return RewstFS.uriOf('/');
		}

		const parentUri = this.parent.getUri();
		const newPath = path.posix.join('/', parentUri.path, this.labelWithExtension());

		this.resourceUri = parentUri.with({ path: newPath });
		return this.resourceUri;
	}

	labelWithExtension(): string {
		return this.ext ? `${this.label}.${this.ext}` : this.label;
	}

	getLabel(): string {
		return this.label;
	}

	addChild(child: Entry): void {
		log.info(`Adding child "${child.label}" (${child.id}) to parent "${this.label}" (${this.id})`);
		this.children = this.children.filter(c => c.id !== child.id);
		this.children.push(child);
		child.parent = this;
		log.info(`Successfully added child. Parent "${this.label}" now has ${this.children.length} children`);
	}

	// Remove a child node and clear its parent reference
	removeChild(child: Entry): boolean {
		log.info(`Removing child "${child.label}" (${child.id}) from parent "${this.label}" (${this.id})`);
		const index = this.children.indexOf(child);
		if (index === -1) {
			log.info(`Child "${child.label}" not found in parent "${this.label}" children`);
			return false;
		}
		this.children.splice(index, 1);
		log.info(`Successfully removed child. Parent "${this.label}" now has ${this.children.length} children`);
		return true;
	}

	// Optional: Move a node to a new parent
	setParent(newParent: Entry): void {
		const oldParentLabel = this.parent?.label || 'none';
		log.info(
			`Moving "${this.label}" (${this.id}) from parent "${oldParentLabel}" to "${newParent.label}" (${newParent.id})`,
		);
		if (this.parent) {
			this.parent.removeChild(this);
		}
		newParent.addChild(this);
	}

	isValidLabel(label: string, forbiddenLabels?: readonly string[]): LabelValidationResult {
		// Normalize the input by trimming whitespace
		const normalizedLabel = label.trim();

		// Check for empty label
		if (!normalizedLabel) {
			return {
				isValid: false,
				error: 'Label cannot be empty',
			};
		}

		// Check character validation
		if (!/^[a-zA-Z0-9[\]\-_ ]+$/.test(normalizedLabel)) {
			return {
				isValid: false,
				error: 'Label contains invalid characters. Only letters, numbers, spaces, hyphens, underscores, and brackets are allowed',
			};
		}

		// Check against forbidden labels (case-insensitive)
		if (forbiddenLabels && forbiddenLabels.length > 0) {
			for (const forbidden of forbiddenLabels) {
				if (forbidden.trim().toLowerCase() === normalizedLabel.toLowerCase()) {
					return {
						isValid: false,
						error: `A ${this.constructor.name.toLowerCase()} named "${forbidden.trim()}" already exists in this location`,
						conflictingLabel: forbidden.trim(),
					};
				}
			}
		}

		return {
			isValid: true,
		};
	}

	getContextValue(params: ContextValueParams = this.contextValueParams): string {
		const classes = [
			params.hasTemplateFolders ? 'has-templatefolders' : '',
			params.hasTemplates ? 'has-templates' : '',
			params.isTemplateFolder ? 'is-templatefolder' : '',
			params.isRenamable ? 'renamable' : '',
			params.isTemplate ? 'is-template' : '',
			params.isOrg ? 'is-org' : '',
		].filter(Boolean);

		return classes.join(' ');
	}

	async getAllEntriesOfType<T extends Entry>(
		rtype: RType,
		TypeClass: new (...args: any[]) => T,
	): Promise<Map<string, T>> {
		log.info(`Searching for entries of type ${RType[rtype]} under "${this.label}" (${this.id})`);
		const results = new Map<string, T>();

		const queue: Entry[] = await this.getChildren();
		let processed = 0;

		while (queue.length) {
			const top = queue.shift();
			processed++;
			if (top === undefined) {
				continue;
			} else if (top.rtype === rtype && top instanceof TypeClass) {
				results.set(top.id, top);
			}
			queue.push(...top.children);
		}

		log.info(`Found ${results.size} entries of type ${RType[rtype]} after processing ${processed} entries`);
		return results;
	}

	static async create(...args: any): Promise<Entry> {
		log.error("Can't create abstract Entry", false, true);
		throw new Error('');
	}
}
