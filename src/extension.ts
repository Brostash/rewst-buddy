// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { CommandInitiater } from '@commands';
import { RewstView } from '@fs';
import { fs, context as globalVSContext, view } from '@global';
import { log } from '@log';
import * as vscode from 'vscode';
import { getBackgroundSyncService } from './services/BackgroundSyncService';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (log.info) and errors (console.error)
	// This line of code will only be executed once when your extension is activated

	globalVSContext.init(context);
	log.init();
	log.info('Congratulations, your extension "rewst-buddy" is now active!');

	const rewstView = new RewstView();

	// Initialize global objects
	view.init(rewstView);
	fs.init(rewstView.rewstfs);

	CommandInitiater.registerCommands();

	// Initialize background sync service
	const backgroundSync = getBackgroundSyncService();
	backgroundSync.start();
	context.subscriptions.push({
		dispose: () => backgroundSync.dispose(),
	});

	vscode.commands.executeCommand('rewst-buddy.LoadClients');

	log.info('Done loading');
}

// This method is called when your extension is deactivated
export function deactivate() {
	// Filesystem provider is automatically disposed via RewstView's context.subscriptions
	log.info('Deactivating rewst-buddy extension');
}
