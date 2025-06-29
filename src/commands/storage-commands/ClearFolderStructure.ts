import { log } from '@log';
import { storage } from '@storage';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class ClearFolderStructure extends GenericCommand {
	commandName = 'ClearFolderStructure';

	async execute(...args: unknown[]): Promise<boolean> {
		const contextName = 'ClearFolderStructure';
		log.info(`${contextName} command started`);

		try {
			const storedOrgIds = storage.getAllStoredOrgIds();
			if (storedOrgIds.length === 0) {
				vscode.window.showInformationMessage('No stored organization data found.');
				return false;
			}

			const orgPickItems = this.createOrgPickItems(storedOrgIds, contextName);
			const selectedOrg = await this.showOrgSelection(orgPickItems, contextName);
			if (!selectedOrg) {
				return false;
			}

			const confirmed = await this.confirmDeletion(selectedOrg.detail!, contextName);
			if (!confirmed) {
				return false;
			}

			await this.clearFolderStructure(selectedOrg.detail!, contextName);
			return true;
		} catch (error) {
			log.error(`${contextName} command failed: ${error}`, true);
			throw new Error(`Clear folder structure failed: ${error}`);
		}
	}

	private createOrgPickItems(storedOrgIds: string[], contextName: string): vscode.QuickPickItem[] {
		const orgPickItems: vscode.QuickPickItem[] = [];

		for (const orgId of storedOrgIds) {
			try {
				const item = this.createOrgPickItem(orgId);
				orgPickItems.push(item);
			} catch (error) {
				log.error(`${contextName}: Failed to parse data for org ${orgId}: ${error}`, true);
				orgPickItems.push({
					label: `Org ID: ${orgId}`,
					description: 'Invalid data (corrupted)',
					detail: orgId,
				});
			}
		}

		return orgPickItems;
	}

	private createOrgPickItem(orgId: string): vscode.QuickPickItem {
		const orgData = storage.getRewstOrgData(orgId);
		const parsedData = JSON.parse(orgData || '{}');

		const label = `Org: ${parsedData.orgLabel || 'Unknown'}`;
		let description = 'No folder structure data';

		if (parsedData.templateFolderStructure) {
			const folderCount = parsedData.templateFolderStructure.folders?.length || 0;
			const templateCount = parsedData.templateFolderStructure.templatePlacements?.length || 0;
			description = `${folderCount} folders, ${templateCount} template placements`;
		}

		return { label, description, detail: orgId };
	}

	private async showOrgSelection(
		orgPickItems: vscode.QuickPickItem[],
		contextName: string,
	): Promise<vscode.QuickPickItem | undefined> {
		const selectedOrg = await vscode.window.showQuickPick(orgPickItems, {
			placeHolder: 'Select organization to clear folder structure',
			title: 'Clear Folder Structure',
		});

		if (!selectedOrg) {
			log.info(`${contextName}: User cancelled org selection`);
			return undefined;
		}

		return selectedOrg;
	}

	private async confirmDeletion(orgId: string, contextName: string): Promise<boolean> {
		const confirmation = await vscode.window.showWarningMessage(
			`Are you sure you want to clear the folder structure for org "${orgId}"?\n\nThis action cannot be undone.`,
			{ modal: true },
			'Clear Structure',
		);

		if (confirmation !== 'Clear Structure') {
			log.info(`${contextName}: User cancelled folder structure clearing`);
			return false;
		}

		return true;
	}

	private async clearFolderStructure(orgId: string, contextName: string): Promise<void> {
		try {
			const existingData = storage.getRewstOrgData(orgId);
			const orgData = existingData !== '{}' ? JSON.parse(existingData) : {};

			delete orgData.templateFolderStructure;

			const updatedData = Object.keys(orgData).length > 0 ? JSON.stringify(orgData) : '{}';
			storage.setRewstOrgData(orgId, updatedData);

			log.info(`${contextName}: Successfully cleared folder structure for org ${orgId}`);
			vscode.window.showInformationMessage(`Folder structure cleared for org "${orgId}"`);
		} catch (error) {
			log.error(`${contextName}: Failed to clear folder structure for org ${orgId}: ${error}`, true);
			vscode.window.showErrorMessage(`Failed to clear folder structure: ${error}`);
			throw error;
		}
	}
}
