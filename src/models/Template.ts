import { FileType } from 'vscode';
import { ContextValueParams, Entry, EntryInput, RType } from './Entry';
import vscode from 'vscode';
import { TemplateFolder } from './TemplateFolder/';
import { log } from '@log';
import { tmpdir } from 'os';

export class Template extends Entry {
	rtype: RType = RType.Template;
	collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None;

	type: FileType = FileType.File;
	data?: Uint8Array;
	private lastKnownUpdatedAt?: string; // Store the updatedAt timestamp for conflict detection

	constructor(input: EntryInput) {
		log.info(`Creating Template: ${input.label} (id: ${input.id}) with extension: ${input.ext || 'ps1'}`);
		super(input, {
			hasTemplates: false,
			hasTemplateFolders: false,
			isRenamable: true,
			isTemplateFolder: false,
			isTemplate: true,
		});

		// Set default extension if not provided
		if (!this.ext) {
			this.ext = 'ps1';
		}
	}

	getCommand(): vscode.Command {
		return {
			title: 'Open File',
			command: 'vscode.open',
			arguments: [this.getUri()],
		};
	}

	async readData(): Promise<string> {
		log.info(`Loading template ${this.id}`);
		const response = await this.client.sdk.getTemplateBody({ id: this.id });
		if (typeof response.template?.body !== 'string') {
			throw new Error(`Couldn't load template ${this.id}`);
		}

		// Store the updatedAt timestamp for conflict detection
		this.lastKnownUpdatedAt = response.template.updatedAt;
		log.info(`Template ${this.id} loaded, updatedAt: ${this.lastKnownUpdatedAt}`);

		return response.template.body;
	}

	async writeData(data: string): Promise<boolean> {
		log.info(`Writing data to Template: ${this.label} (${this.id}), size: ${data.length} chars`);

		try {
			let dataToWrite = data;
			let shouldNotifyFileChange = false;

			// Check for conflicts before writing
			if (this.lastKnownUpdatedAt) {
				const currentResponse = await this.client.sdk.getTemplateBody({
					id: this.id,
				});
				const currentUpdatedAt = currentResponse.template?.updatedAt;

				if (currentUpdatedAt && currentUpdatedAt !== this.lastKnownUpdatedAt) {
					log.info(
						`Conflict detected for template ${this.id}. Expected: ${this.lastKnownUpdatedAt}, Current: ${currentUpdatedAt}`,
					);

					// Show conflict resolution dialog
					const action = await this.showConflictDialog(data, currentResponse.template?.body || '');

					if (action === 'cancel') {
						log.info('User cancelled write operation due to conflict');
						return false;
					} else if (action === 'force') {
						// Check if we have resolved content from conflict resolution
						if ((this as any).resolvedConflictContent) {
							dataToWrite = (this as any).resolvedConflictContent;
							delete (this as any).resolvedConflictContent; // Clean up
							shouldNotifyFileChange = true; // Need to refresh editor since content changed
							log.info('Using resolved conflict content for write');
						}
					}
					// If action is 'force', continue with the write
				}
			}

			const payload = {
				id: this.id,
				body: dataToWrite,
			};

			const response = await this.client.sdk.UpdateTemplateBody(payload);

			// Update our known timestamp
			if (response.updateTemplate?.updatedAt) {
				this.lastKnownUpdatedAt = response.updateTemplate.updatedAt;
				log.info(`Template ${this.id} updated, new updatedAt: ${this.lastKnownUpdatedAt}`);
			}

			// If we used cloud content, notify VS Code to refresh the editor
			if (shouldNotifyFileChange) {
				this.notifyFileChanged();
			}

			log.info(`Successfully wrote data to Template: ${this.label}`);
			return true;
		} catch (error) {
			log.error(`Failed to write data to Template ${this.label} (${this.id}): ${error}`);
			throw error;
		}
	}

	private async showConflictDialog(localData: string, serverData: string): Promise<'force' | 'view-diff' | 'cancel'> {
		const choice = await vscode.window.showWarningMessage(
			`Template "${this.label}" was modified by someone else. Choose which version to keep:`,
			'Use My Version',
			'Use Cloud Version',
			'Cancel',
		);

		switch (choice) {
			case 'Use My Version':
				return 'force'; // Use original local data
			case 'Use Cloud Version':
				// Store server data for writing
				(this as any).resolvedConflictContent = serverData;
				return 'force'; // Use server data
			default:
				return 'cancel';
		}
	}

	private notifyFileChanged(): void {
		// This will trigger VS Code to re-read the file and update the editor
		const uri = this.getUri();
		log.info(`Notifying VS Code of file change for template: ${this.label} (${uri.toString()})`);

		// Force VS Code to refresh the document by closing and reopening it
		// This is a workaround since we can't directly access the file system provider from here
		setTimeout(async () => {
			try {
				// Find the document if it's open
				const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
				if (document) {
					// Close the document first
					await vscode.window.showTextDocument(document);
					await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

					// Then reopen it to show the updated content
					setTimeout(async () => {
						await vscode.commands.executeCommand('vscode.open', uri);
					}, 50);
				}
			} catch (error) {
				log.error(`Failed to refresh editor for template ${this.label}: ${error}`);
			}
		}, 100);
	}

	async setLabel(label: string): Promise<boolean> {
		log.info(`Setting label for Template ${this.id}: "${this.label}" -> "${label}"`);
		try {
			this.label = label;

			const payload = {
				id: this.id,
				name: label,
			};

			const response = await this.client.sdk.UpdateTemplateName(payload);
			if (response.updateTemplate?.name !== label) {
				const message = `failed to update template with new name ${label}`;
				vscode.window.showErrorMessage(message);
				log.error(message);
				return false;
			}

			// Update timestamp after successful rename
			if (response.updateTemplate?.updatedAt) {
				this.lastKnownUpdatedAt = response.updateTemplate.updatedAt;
			}

			log.info(`Successfully updated Template label to: ${label}`);
			return true;
		} catch (error) {
			log.error(`Failed to set label for Template ${this.id}: ${error}`);
			return false;
		}
	}

	async serialize(): Promise<string> {
		return '';
	}

	initialize(): Promise<void> {
		log.info(`Initializing Template: ${this.label} (${this.id})`);

		if (this.client === undefined) {
			log.error(`Template ${this.id} has no client - this should never happen`);
			throw new Error('Client should always exist on templates');
		}

		this.initialized = true;
		log.info(`Successfully initialized Template: ${this.label}`);
		return Promise.resolve();
	}

	static async create(...args: any): Promise<Template> {
		const folder: TemplateFolder = args[0];
		const label: string = args[1];

		log.info(`Creating new Template "${label}" in folder "${folder.label}" (${folder.orgId})`);
		try {
			const input = {
				name: label,
				orgId: folder.orgId,
			};
			const response = await folder.client.sdk.createTemplateMinimal(input);

			if (!response.template) {
				const message = `Failed to generate template`;
				log.error(message);
				throw new Error('message');
			}

			const template = response.template;
			log.info(`Created template via API: ${template.name} (${template.id})`);

			const templateInput: EntryInput = {
				client: folder.client,
				id: template.id,
				label: template.name,
				parent: folder,
			};

			const newTemplate = new Template(templateInput);

			// Set initial timestamp if available
			if (template.updatedAt) {
				newTemplate.lastKnownUpdatedAt = template.updatedAt;
			}

			log.info(`Successfully created Template: ${template.name}`);
			return newTemplate;
		} catch (error) {
			log.error(`Failed to create Template "${label}": ${error}`);
			throw error;
		}
	}
}

export async function createTemplate(folder: TemplateFolder, label: string): Promise<Template> {
	log.info(`Creating Template "${label}" in folder "${folder.label}" (${folder.orgId})`);
	try {
		const input = {
			name: label,
			orgId: folder.orgId,
		};
		const response = await folder.client.sdk.createTemplateMinimal(input);

		if (!response.template) {
			const message = `Failed to generate template`;
			log.error(message);
			throw new Error('message');
		}

		const template = response.template;
		log.info(`Template created via API: ${template.name} (${template.id})`);

		const templateInput: EntryInput = {
			client: folder.client,
			id: template.id,
			label: template.name,
			parent: folder,
		};

		const newTemplate = new Template(templateInput);

		// Set initial timestamp if available
		if (template.updatedAt) {
			(newTemplate as any).lastKnownUpdatedAt = template.updatedAt;
		}

		log.info(`Successfully created Template: ${template.name}`);
		return newTemplate;
	} catch (error) {
		log.error(`Failed to create Template "${label}": ${error}`);
		throw error;
	}
}
