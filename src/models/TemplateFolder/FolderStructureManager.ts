import { Entry, EntryInput } from '../Entry';
import { log } from '@log';
import { SerializableTemplateFolder } from './types';

export class FolderStructureManager {
	async setupFolderStructure(folderStructureData: any, folder: Entry, TemplateFolderClass: any): Promise<void> {
		if (!folderStructureData?.folders || !Array.isArray(folderStructureData.folders)) {
			log.info(`No valid folder structure found for org ${folder.parent?.id}`);
			return;
		}

		log.info(
			`Found stored folder structure with ${folderStructureData.folders.length} folders for org ${folder.parent?.id}`,
		);

		const rootFolder = folderStructureData.folders.find(
			(f: any) => !f.parentId || f.parentId === folder.parent?.id,
		);

		if (rootFolder) {
			this.updateRootFolderId(rootFolder.id, folder);
		}

		await this.createFoldersFromStoredStructure(
			folderStructureData.folders,
			folder.id,
			folder,
			TemplateFolderClass,
		);
	}

	private updateRootFolderId(newId: string, folder: Entry): void {
		log.info(`Resetting root folder ID from ${folder.id} to stored ID ${newId}`);
		const oldId = folder.id;
		folder.id = newId;

		if (folder.parent) {
			const childIndex = folder.parent.children.findIndex(child => child === folder);
			if (childIndex !== -1) {
				log.info(`Updated parent's child reference for ID change from ${oldId} to ${folder.id}`);
			}
		}
	}

	async createFoldersFromStoredStructure(
		storedFolders: SerializableTemplateFolder[],
		parentId: string,
		parentFolder: Entry,
		TemplateFolderClass: any,
	): Promise<void> {
		const childFolders = storedFolders.filter(f => f.parentId === parentId);

		for (const folderData of childFolders) {
			let existingFolder = parentFolder.children.find(
				child => child.constructor.name === 'TemplateFolder' && child.id === folderData.id,
			) as Entry;

			if (!existingFolder) {
				existingFolder = this.createChildFolder(folderData, parentFolder, TemplateFolderClass);
			} else {
				log.info(`Found existing folder: ${folderData.label} (${folderData.id})`);
			}

			await this.createFoldersFromStoredStructure(
				storedFolders,
				folderData.id,
				existingFolder,
				TemplateFolderClass,
			);
		}
	}

	createChildFolder(folderData: SerializableTemplateFolder, parent: Entry, TemplateFolderClass: any): Entry {
		log.info(`Creating missing child folder: ${folderData.label} (${folderData.id})`);

		const folderInput: EntryInput = {
			client: parent.client,
			id: folderData.id,
			label: folderData.label,
			parent: parent,
		};

		return new TemplateFolderClass(folderInput);
	}
}
