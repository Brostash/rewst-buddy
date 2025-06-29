import { RewstClient } from '@client';
import { RewstFS } from '@fs';
import { context } from '@global';
import { log } from '@log';
import vscode from 'vscode';
import { Entry, EntryInput, RType } from './Entry';
import { SerializableTemplateFolder, TemplateFolder } from './TemplateFolder/';

export interface SerializableOrg {
	orgId: string;
	orgLabel: string;
	lastSync: number;
	folderStructure: SerializableTemplateFolder[];
}

export interface AlmostOrgInput {
	label: string;
	orgId: string;
}

export class AlmostOrg extends vscode.TreeItem {
	contextValue = 'almost-org';
	collapsibleState = vscode.TreeItemCollapsibleState.None;
	orgId: string;
	command: vscode.Command;

	constructor(input: AlmostOrgInput) {
		super(input.label);
		this.orgId = input.orgId;
		this.command = {
			title: 'Load Org',
			command: 'rewst-buddy.NewClient',
			arguments: [this.orgId],
		};
	}
}

export class Org extends Entry {
	type = vscode.FileType.Directory;

	constructor(input: EntryInput) {
		log.info(`Creating Org: ${input.label} (orgId: ${input.client?.orgId})`);
		super(input, {
			hasTemplates: false,
			hasTemplateFolders: false,
			isRenamable: false,
			isTemplateFolder: false,
			isTemplate: false,
			isOrg: true,
		});
	}

	rtype = RType.Org;
	getCommand(): undefined {
		return undefined;
	}

	readData(): Promise<string> {
		log.error('readData method not implemented for Org', true);
		throw new Error('Reading data is not supported for organizations');
	}

	writeData(_data: string): Promise<boolean> {
		log.error('writeData method not implemented for Org', true);
		throw new Error('Writing data is not supported for organizations');
	}
	async serialize(): Promise<string> {
		log.info(`Serializing Org: ${this.label} (${this.orgId})`);

		try {
			const folderStructure = await this.buildFolderStructure();
			const serializable = this.createSerializableOrg(folderStructure);

			const result = JSON.stringify(serializable);
			log.info(`Successfully serialized Org: ${this.label} with ${folderStructure.length} folders`);

			return result;
		} catch (error) {
			log.error(`Failed to serialize Org ${this.label} (${this.orgId}): ${error}`, true);
			throw error;
		}
	}

	private async buildFolderStructure(): Promise<SerializableTemplateFolder[]> {
		const folderMap = await this.getAllEntriesOfType(RType.TemplateFolder, TemplateFolder);
		log.info(`Found ${folderMap.size} template folders to serialize for org ${this.orgId}`);

		const folderStructure: SerializableTemplateFolder[] = [];

		for (const folder of folderMap.values()) {
			const serializedFolder = await folder.serialize();
			folderStructure.push(JSON.parse(serializedFolder));
		}

		return folderStructure;
	}

	private createSerializableOrg(folderStructure: SerializableTemplateFolder[]): SerializableOrg {
		return {
			orgId: this.orgId,
			orgLabel: this.label,
			lastSync: Date.now(),
			folderStructure,
		};
	}
	setLabel(_label: string): void {
		log.error('setLabel method not implemented for Org', true);
		throw new Error('Renaming organizations is not supported');
	}
	async initialize(): Promise<void> {
		// Guard clause: Already initialized
		if (this.initialized) {
			log.info(`Org ${this.orgId} already initialized`);
			return;
		}

		log.info(`Initializing Org: ${this.orgId}`);

		try {
			await this.loadOrganizationData();
			await this.createRootTemplateFolder();

			this.initialized = true;
			log.info(`Successfully initialized Org: "${this.label}" (${this.orgId})`);
		} catch (error) {
			log.error(`Failed to initialize Org ${this.orgId}: ${error}`, true);
			throw error;
		}
	}

	private async loadOrganizationData(): Promise<void> {
		log.info(`Fetching organization info for ${this.orgId}`);

		const response = await this.client.sdk.UserOrganization();

		if (!response.userOrganization) {
			log.error(`Failed to get org info for ${this.orgId}: API returned undefined`, true);
			throw new Error('Could not retrieve organization information');
		}

		const org = response.userOrganization;

		if (!org?.name) {
			log.error(`Organization name is missing for orgId: ${this.orgId}`, true);
			throw new Error('Organization name could not be retrieved');
		}

		this.label = org.name;
	}

	private async createRootTemplateFolder(): Promise<void> {
		const templateFolderInput: EntryInput = {
			client: this.client,
			label: 'Templates',
			parent: this,
		};

		const rootTemplateFolder = new TemplateFolder(templateFolderInput);
		rootTemplateFolder.contextValueParams.isRenamable = false;
		rootTemplateFolder.contextValue = rootTemplateFolder.getContextValue();

		log.info(`Created root template folder (ID: ${rootTemplateFolder.id}) for org '${this.label}'`);
	}

	getUri(): vscode.Uri {
		this.resourceUri = RewstFS.uriOf(`${this.label}`);
		return this.resourceUri;
	}

	static async create(clientOrOrgId?: RewstClient | string): Promise<Org> {
		log.info(`Creating new Org via static create method`);

		try {
			const client = await Org.getOrCreateClient(clientOrOrgId);
			const org = Org.buildOrgFromClient(client);

			log.info(`Successfully created Org: "${client.label}" (${client.orgId})`);
			return org;
		} catch (error) {
			log.error(`Failed to create Org: ${error}`, true);
			throw error;
		}
	}

	private static async getOrCreateClient(clientOrOrgId?: RewstClient | string): Promise<RewstClient> {
		if (clientOrOrgId instanceof RewstClient) {
			return clientOrOrgId;
		}

		const client = await RewstClient.create(context);
		log.info(`Created RewstClient for org: ${client.orgId}`);

		return client;
	}

	private static buildOrgFromClient(client: RewstClient): Org {
		const orgInput: EntryInput = {
			client: client,
			id: client.orgId,
			label: client.label,
		};

		return new Org(orgInput);
	}
}
