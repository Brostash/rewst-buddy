import { view } from '@global';
import { log } from '@log';
import { Entry } from '@models';
import vscode from 'vscode';

/**
 * Utility functions for common command operations
 */
export class CommandOperations {
	/**
	 * Refreshes the UI by executing SaveFolderStructure and RefreshView commands
	 * This pattern is used across multiple commands after structural changes
	 *
	 * @param contextItem - Item context to pass to the commands
	 * @param contextName - Context name for logging purposes
	 */
	static async refreshUI(contextItem: Entry | undefined, contextName: string): Promise<void> {
		log.info(`${contextName}: Refreshing view and saving folder structure`);

		try {
			await vscode.commands.executeCommand('rewst-buddy.SaveFolderStructure', contextItem);
			view.refresh(contextItem);
			log.info(`${contextName}: UI refresh completed successfully`);
		} catch (error) {
			log.error(`${contextName}: Failed to refresh UI: ${error}`, true);
			// Don't throw here - the main operation was successful, UI refresh is secondary
		}
	}
}
