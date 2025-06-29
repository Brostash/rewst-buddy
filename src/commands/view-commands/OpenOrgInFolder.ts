import { Org } from '@models';
import GenericCommand from '../GenericCommand';
import vscode from 'vscode';
import { log } from '@log';

export class OpenOrgInFolder extends GenericCommand {
	commandName = 'OpenOrgInFolder';

	async execute(...args: any): Promise<void> {
		log.info('OpenOrgInFolder command started');
		try {
			const entry = args[0][0] ?? undefined;
			log.info(`Attempting to open org in folder for entry: ${entry?.label || 'unknown'}`);

			if (!(entry instanceof Org)) {
				const message = 'Cannot open folder for non-organization entry';
				log.error(`OpenOrgInFolder failed: ${message}`);
				vscode.window.showErrorMessage(message);
				return; // Don't throw, just return to avoid extension crashes
			}

			// Get the organization's virtual URI
			const orgUri = entry.getUri();
			log.info(`Using org virtual URI: ${orgUri.toString()}`);

			// Add the virtual folder to the current workspace
			try {
				// Check if this workspace folder already exists
				const existingFolder = vscode.workspace.workspaceFolders?.find(
					folder => folder.uri.toString() === orgUri.toString(),
				);

				if (existingFolder) {
					const message = `Organization "${entry.label}" is already open in workspace`;
					log.info(message);
					vscode.window.showInformationMessage(message);
					return;
				}

				const success = await vscode.workspace.updateWorkspaceFolders(
					vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0,
					0,
					{ uri: orgUri, name: entry.label },
				);

				if (success) {
					log.info(`Successfully added org folder to workspace: ${entry.label} (${entry.orgId})`);
					const successMessage = `Added organization "${entry.label}" to workspace`;
					vscode.window.showInformationMessage(successMessage);
				} else {
					const message = 'Failed to add folder to workspace';
					log.error(message);
					vscode.window.showErrorMessage(message);
				}
			} catch (error) {
				const message = `Failed to add organization folder to workspace: ${error}`;
				log.error(message);
				vscode.window.showErrorMessage(message);
				// Don't re-throw to avoid extension crashes
			}
		} catch (error) {
			log.error(`OpenOrgInFolder command failed: ${error}`);
			// Don't re-throw to avoid extension crashes
		}
	}
}
