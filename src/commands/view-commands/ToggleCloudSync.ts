import { fs } from '@global';
import { log } from '@log';
import { Org } from '@models';
import { storage } from 'storage/Storage';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class ToggleCloudSync extends GenericCommand {
	commandName = 'ToggleCloudSync';

	async execute(...args: any): Promise<unknown> {
		log.info('ToggleCloudSync command started');
		try {
			const entry = args[0][0] ?? undefined;

			if (!entry) {
				vscode.window.showErrorMessage('No organization selected');
				return false;
			}

			// Get org from the entry's URI using tree lookup
			const org: Org = fs.tree.lookupOrg(entry.getUri());

			// Check current cloud sync status
			const currentStatus = storage.isCloudSyncEnabled(entry.client);
			const newStatus = !currentStatus;

			// Confirm the change with the user
			const action = await vscode.window.showWarningMessage(
				`Cloud sync is currently ${currentStatus ? 'enabled' : 'disabled'} for ${org.label}. ` +
					`Do you want to ${newStatus ? 'enable' : 'disable'} cloud sync for folder structure?`,
				{ modal: true },
				newStatus ? 'Enable Cloud Sync' : 'Disable Cloud Sync',
			);

			if (action) {
				storage.setCloudSyncEnabled(entry.client, newStatus);

				const statusText = newStatus ? 'enabled' : 'disabled';
				log.info(`Cloud sync ${statusText} for org "${org.label}" (${org.id})`);
				vscode.window.showInformationMessage(
					`Cloud sync ${statusText} for ${org.label}. ` +
						(newStatus
							? 'Folder structure will now be saved to organization variables when you save.'
							: 'Folder structure will only be saved locally.'),
				);
			}

			return true;
		} catch (error) {
			log.error(`ToggleCloudSync command failed: ${error}`);
			vscode.window.showErrorMessage(`Failed to toggle cloud sync: ${error}`);
			return false;
		}
	}
}
