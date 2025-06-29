import { fs } from '@global';
import { log } from '@log';
import { RType, TemplateFolder } from '@models';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class DeleteFolder extends GenericCommand {
	commandName = 'DeleteFolder';

	async execute(...args: any): Promise<unknown> {
		log.info('DeleteFolder command started');

		try {
			const entry = args[0][0] ?? undefined;
			log.info(`DeleteFolder requested for entry: ${entry?.label || 'unknown'}`);

			if (!entry || !(entry instanceof TemplateFolder)) {
				const message = 'Can only delete template folders';
				log.error(message);
				vscode.window.showErrorMessage(message);
				return false;
			}

			// Prevent deletion of root folder (org-level folder)
			if (entry.parent?.rtype === RType.Org) {
				const message = 'Cannot delete the root template folder';
				log.error(message);
				vscode.window.showErrorMessage(message);
				return false;
			}

			// Ensure the folder is initialized so we can check if it's empty
			await entry.initialize();

			// Check if folder is empty (no children)
			if (entry.children.length > 0) {
				const childCount = entry.children.length;
				const folderCount = entry.children.filter(child => child instanceof TemplateFolder).length;
				const templateCount = entry.children.length - folderCount;

				let message = `Cannot delete folder "${entry.label}" because it contains `;
				const parts = [];
				if (folderCount > 0) {
					parts.push(`${folderCount} folder${folderCount > 1 ? 's' : ''}`);
				}
				if (templateCount > 0) {
					parts.push(`${templateCount} template${templateCount > 1 ? 's' : ''}`);
				}
				message += parts.join(' and ');
				message += '. Please move or delete the contents first.';

				log.error(`${message} (${childCount} total children)`);
				vscode.window.showErrorMessage(message);
				return false;
			}

			// Show confirmation dialog
			const folderName = entry.label;
			const confirmAction = await vscode.window.showWarningMessage(
				`Are you sure you want to delete the folder "${folderName}"?`,
				{ modal: true },
				'Delete Folder',
			);

			if (confirmAction !== 'Delete Folder') {
				log.info(`User cancelled deletion of folder "${folderName}"`);
				return false;
			}

			// Remove the folder from its parent's children array
			const parent = entry.parent;
			if (!parent) {
				const message = 'Cannot delete folder without parent';
				log.error(message);
				vscode.window.showErrorMessage(message);
				return false;
			}

			fs.tree.removeEntry(entry.getUri());

			// Save the updated folder structure
			log.info(`Saving folder structure after deleting "${folderName}"`);
			await vscode.commands.executeCommand('rewst-buddy.SaveFolderStructure', entry);

			// Refresh the view to reflect changes
			await vscode.commands.executeCommand('rewst-buddy.RefreshView');

			vscode.window.showInformationMessage(`Folder "${folderName}" deleted successfully`);
			log.info(`Successfully deleted folder "${folderName}" (${entry.id})`);

			return true;
		} catch (error) {
			log.error(`DeleteFolder command failed: ${error}`);
			vscode.window.showErrorMessage(`Failed to delete folder: ${error}`);
			return false;
		}
	}
}
