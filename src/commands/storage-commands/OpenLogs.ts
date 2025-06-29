import GenericCommand from '../GenericCommand';
import vscode from 'vscode';
import { log } from '@log';

export class OpenLogs extends GenericCommand {
	commandName = 'OpenLogs';

	async execute(): Promise<void> {
		const contextName = 'OpenLogs';
		log.info(`${contextName} command started`);

		try {
			log.info(`${contextName}: Opening log file: ${log.logFile}`);
			const logfile: vscode.Uri = vscode.Uri.parse(log.logFile);
			await vscode.commands.executeCommand('vscode.open', logfile);
			log.info(`${contextName}: Successfully opened log file in VS Code`);
		} catch (error) {
			log.error(`${contextName} command failed: ${error}`, true);
			vscode.window.showErrorMessage(`Failed to open log file: ${error}`);
			throw new Error(`Failed to open log file: ${error}`);
		}
	}
}
