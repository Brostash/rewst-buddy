import { Entry } from '@models';
import GenericCommand from '../GenericCommand';
import vscode from 'vscode';
import { log } from '@log';

export class CopyId extends GenericCommand {
	commandName = 'CopyId';
	async execute(...args: any): Promise<void> {
		log.info('CopyId command started');
		try {
			const entry = args[0][0] ?? undefined;
			log.info(`Attempting to copy ID for entry: ${entry?.label || 'unknown'}`);

			if (!(entry instanceof Entry)) {
				const message = 'Cannot copy id of that';
				log.error(`CopyId failed: ${message}`);
				vscode.window.showErrorMessage(message);
				throw new Error(message);
			}

			log.info(`Copying ID to clipboard: ${entry.id}`);
			await vscode.env.clipboard.writeText(entry.id);

			const successMessage = 'Text copied to clipboard!';
			vscode.window.showInformationMessage(successMessage);
			log.info(`Successfully copied ID for ${entry.label} (${entry.id})`);
		} catch (error) {
			log.error(`CopyId command failed: ${error}`);
			throw error;
		}
	}
}
