import { Entry, EntryInput, RType } from '../Entry';
import vscode from 'vscode';
import { Template } from '../Template';
import { log } from '@log';
import { DataLoader } from './DataLoader';
import { TemplateManager } from './TemplateManager';
import { FolderStructureManager } from './FolderStructureManager';
import { SerializableTemplateFolder } from './types';

export class TemplateFolder extends Entry {
	type = vscode.FileType.Directory;
	rtype: RType = RType.TemplateFolder;

	private dataLoader: DataLoader;
	private templateManager: TemplateManager;
	private folderManager: FolderStructureManager;

	constructor(input: EntryInput) {
		log.info(`Creating TemplateFolder: ${input.label} (id: ${input.id})`);
		super(input, {
			hasTemplates: true,
			hasTemplateFolders: true,
			isRenamable: true,
			isTemplateFolder: true,
			isTemplate: false,
		});

		this.dataLoader = new DataLoader(this.client);
		this.templateManager = new TemplateManager(this.client);
		this.folderManager = new FolderStructureManager();
	}

	getCommand(): undefined {
		return undefined;
	}

	async serialize(): Promise<string> {
		log.info(`Serializing TemplateFolder: ${this.label} (id: ${this.id})`);

		try {
			const childFolderIds = this.children
				.filter(child => child instanceof TemplateFolder)
				.map(child => child.id);

			const templateIds = this.children.filter(child => child instanceof Template).map(child => child.id);

			const serializable: SerializableTemplateFolder = {
				id: this.id,
				label: this.label,
				parentId: this.parent?.id,
				childFolderIds,
				templateIds,
			};

			const result = JSON.stringify(serializable);
			log.info(`Successfully serialized TemplateFolder: ${this.label}`);
			return result;
		} catch (error) {
			log.error(`Failed to serialize TemplateFolder ${this.label}: ${error}`, true);
			throw new Error(`Serialization failed for folder ${this.label}`);
		}
	}

	setLabel(label: string): void {
		log.info(`Setting label for TemplateFolder ${this.id}: "${this.label}" -> "${label}"`);
		this.label = label;
	}

	async initialize(): Promise<void> {
		if (this.initialized) {
			log.info(`TemplateFolder ${this.label} (${this.id}) already initialized`);
			return;
		}

		log.info(`Initializing TemplateFolder: ${this.label} (${this.id})`);

		try {
			if (this.parent?.rtype === RType.Org) {
				await this.initializeRootFolder();
			} else {
				await this.initializeSubfolder();
			}

			this.initialized = true;
			log.info(`Successfully initialized TemplateFolder: ${this.label} (${this.id})`);
		} catch (error) {
			log.error(`Failed to initialize TemplateFolder ${this.label} (${this.id}): ${error}`, true);
			throw new Error(`Initialization failed for folder ${this.label}`);
		}
	}

	private async initializeRootFolder(): Promise<void> {
		if (!this.parent) {
			log.error('Root folder missing parent reference', true);
			throw new Error('Invalid folder structure');
		}

		log.info(`Top-level TemplateFolder detected for org ${this.parent.id}`);

		const folderStructureData = await this.dataLoader.loadFolderStructure(this.parent.id);
		await this.folderManager.setupFolderStructure(folderStructureData, this, TemplateFolder);

		const templatePlacements = this.dataLoader.extractTemplatePlacements(folderStructureData, this.parent.id);
		await this.templateManager.createTemplatesForFolder(folderStructureData, this, templatePlacements);
	}

	private async initializeSubfolder(): Promise<void> {
		log.info(`Initializing subfolder: ${this.label} (${this.id})`);

		const templatePlacements = await this.dataLoader.loadTemplatePlacements(this.orgId);
		const templatesForFolder = templatePlacements.filter(p => p.folderId === this.id);

		if (templatesForFolder.length === 0) {
			log.info(`No templates assigned to subfolder "${this.label}" (${this.id})`);
			return;
		}

		await this.templateManager.createTemplatesFromPlacements(templatesForFolder, this);
	}

	readData(): Promise<string> {
		log.error('readData not implemented for TemplateFolder', true);
		throw new Error('Method not implemented');
	}

	writeData(): Promise<boolean> {
		log.error('writeData not implemented for TemplateFolder', true);
		throw new Error('Method not implemented');
	}

	async getChildren(): Promise<Entry[]> {
		log.info(`Getting children for TemplateFolder: ${this.label} (${this.id})`);

		if (!this.initialized) {
			await this.initialize();
		}

		const children = [...this.children];
		const sortedChildren = children.sort((a: Entry, b: Entry) => {
			let score = a.label.localeCompare(b.label);
			score -= a instanceof TemplateFolder ? 100 : 0;
			score += b instanceof TemplateFolder ? 100 : 0;
			return score;
		});

		log.info(`Returning ${sortedChildren.length} children for TemplateFolder: ${this.label}`);
		return sortedChildren;
	}

	static async createFolder(folder: Entry, label: string): Promise<TemplateFolder> {
		log.info(`Creating new TemplateFolder "${label}" under parent: ${folder.label} (${folder.id})`);

		try {
			const folderInput: EntryInput = {
				client: folder.client,
				label: label,
				parent: folder,
			};

			const newFolder = new TemplateFolder(folderInput);
			log.info(`Successfully created TemplateFolder: ${label}`);
			return newFolder;
		} catch (error) {
			log.error(`Failed to create TemplateFolder "${label}": ${error}`, true);
			throw new Error(`Failed to create folder ${label}`);
		}
	}
}
