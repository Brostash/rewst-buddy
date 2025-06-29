import { log } from '@log';
import vscode from 'vscode';

/**
 * Utility functions for managing VS Code editor tabs and documents
 */
export class TabManager {
	/**
	 * Find an open document by URI
	 */
	static findOpenDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
		return vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
	}

	/**
	 * Find a tab by URI
	 */
	static findTab(uri: vscode.Uri): vscode.Tab | undefined {
		const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
		return tabs.find(
			tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString(),
		);
	}

	/**
	 * Close an open editor for the given URI if it exists
	 */
	static async closeEditor(uri: vscode.Uri, resourceName?: string): Promise<boolean> {
		const openDocument = TabManager.findOpenDocument(uri);

		if (!openDocument) {
			return false;
		}

		const displayName = resourceName || uri.path.split('/').pop() || 'file';
		log.info(`Closing open editor for: ${displayName}`);

		const tab = TabManager.findTab(uri);

		if (!tab) {
			log.info(`No tab found for: ${displayName}`);
			return false;
		}

		try {
			await vscode.window.tabGroups.close(tab);
			log.info(`Successfully closed editor tab for: ${displayName}`);
			return true;
		} catch (error) {
			log.error(`Failed to close editor tab for ${displayName}: ${error}`, true);
			return false;
		}
	}

	/**
	 * Check if a document is currently open in an editor
	 */
	static isDocumentOpen(uri: vscode.Uri): boolean {
		return TabManager.findOpenDocument(uri) !== undefined;
	}

	/**
	 * Get all open document URIs
	 */
	static getOpenDocumentUris(): vscode.Uri[] {
		return vscode.workspace.textDocuments.map(doc => doc.uri);
	}

	/**
	 * Close all editors matching a URI pattern
	 */
	static async closeEditorsMatching(predicate: (uri: vscode.Uri) => boolean, resourceType?: string): Promise<number> {
		const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
		const matchingTabs = tabs.filter(tab => tab.input instanceof vscode.TabInputText && predicate(tab.input.uri));

		if (matchingTabs.length === 0) {
			return 0;
		}

		const typeDesc = resourceType || 'matching files';
		log.info(`Closing ${matchingTabs.length} editor tabs for ${typeDesc}`);

		try {
			await vscode.window.tabGroups.close(matchingTabs);
			log.info(`Successfully closed ${matchingTabs.length} editor tabs`);
			return matchingTabs.length;
		} catch (error) {
			log.error(`Failed to close editor tabs for ${typeDesc}: ${error}`, true);
			return 0;
		}
	}
}
