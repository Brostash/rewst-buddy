import { RewstClient } from '@client';
import { storage } from '@storage';
import { log } from '@log';
import { TemplatePlacement, StoredOrgStructure } from './types';

export class DataLoader {
	constructor(private client: RewstClient) {}

	async loadFolderStructure(parentId: string): Promise<any> {
		try {
			const cloudSyncEnabled = storage.isCloudSyncEnabled(this.client);

			if (cloudSyncEnabled) {
				const cloudData = await this.loadFromCloud(parentId);
				if (cloudData) {
					return cloudData;
				}
			}

			return await this.loadFromLocalStorage(parentId);
		} catch (error) {
			log.error(`Failed to load stored folder structure: ${error}`, true);
			log.info(`Falling back to API-only initialization for org ${parentId}`);
			return null;
		}
	}

	async loadFromCloud(parentId: string): Promise<any> {
		log.info(`Cloud sync enabled for org ${parentId}, checking cloud storage`);

		const cloudStructureJson = await storage.getOrgVariable(this.client, 'rewst-buddy-folder-structure');

		if (!cloudStructureJson) {
			log.info(`No cloud folder structure found for org ${parentId}, falling back to local`);
			return null;
		}

		const folderStructureData = JSON.parse(cloudStructureJson);
		log.info(`Loaded folder structure from cloud for org ${parentId}`);

		this.handleVersionTracking(folderStructureData);
		return folderStructureData;
	}

	private handleVersionTracking(folderStructureData: any): void {
		if (folderStructureData.version) {
			storage.setLastKnownCloudVersion(this.client, folderStructureData.version);
			log.info(`Stored cloud version ${folderStructureData.version} for conflict detection`);
		} else {
			storage.setLastKnownCloudVersion(this.client, 1);
			log.info(`No version found in cloud data, assuming version 1 for backward compatibility`);
		}
	}

	async loadFromLocalStorage(parentId: string): Promise<any> {
		const storedData = storage.getRewstOrgData(parentId);
		if (!storedData || storedData === '{}') {
			return null;
		}

		const orgData = JSON.parse(storedData);
		if (!orgData.templateFolderStructure?.folders || !Array.isArray(orgData.templateFolderStructure.folders)) {
			return null;
		}

		log.info(`Loaded folder structure from local storage for org ${parentId}`);
		return orgData.templateFolderStructure;
	}

	extractTemplatePlacements(folderStructureData: any, parentId: string): TemplatePlacement[] {
		try {
			const cloudSyncEnabled = storage.isCloudSyncEnabled(this.client);

			if (cloudSyncEnabled && folderStructureData?.templatePlacements) {
				log.info(`Using ${folderStructureData.templatePlacements.length} cloud template placements`);
				return folderStructureData.templatePlacements;
			}

			return this.getLocalTemplatePlacements(parentId);
		} catch (error) {
			log.error(`Failed to parse template placements: ${error}`, true);
			return [];
		}
	}

	private getLocalTemplatePlacements(parentId: string): TemplatePlacement[] {
		const storedData = storage.getRewstOrgData(parentId);
		if (!storedData || storedData === '{}') {
			return [];
		}

		const orgData: StoredOrgStructure = JSON.parse(storedData);
		const placements = orgData.templateFolderStructure?.templatePlacements || [];
		log.info(`Found ${placements.length} local template placements`);
		return placements;
	}

	async loadTemplatePlacements(orgId: string): Promise<TemplatePlacement[]> {
		const storedData = storage.getRewstOrgData(orgId);

		if (!storedData || storedData === '{}') {
			return [];
		}

		try {
			const orgData: StoredOrgStructure = JSON.parse(storedData);
			return orgData.templateFolderStructure?.templatePlacements || [];
		} catch (error) {
			log.error(`Failed to parse template placements for subfolder: ${error}`, true);
			return [];
		}
	}
}
