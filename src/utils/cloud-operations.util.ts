import { RewstClient } from '@client';
import { fs } from '@global';
import { log } from '@log';
import { Org } from '@models';
import { storage } from '@storage';
import vscode from 'vscode';

export interface CloudUpdateResult {
	hasUpdates: boolean;
	author?: string;
}

/**
 * Utility functions for cloud synchronization operations
 */
export class CloudOperations {
	/**
	 * Checks if cloud sync is enabled for a client and shows appropriate message
	 *
	 * @param client - Rewst client to check
	 * @param orgLabel - Organization label for user messages
	 * @returns true if cloud sync is enabled, false otherwise
	 */
	static validateCloudSyncEnabled(client: RewstClient, orgLabel: string): boolean {
		if (!storage.isCloudSyncEnabled(client)) {
			vscode.window.showInformationMessage(`Cloud sync is not enabled for ${orgLabel}`);
			return false;
		}
		return true;
	}

	/**
	 * Performs cloud update check with user feedback
	 *
	 * @param client - Rewst client to check updates for
	 * @param orgLabel - Organization label for user messages
	 * @returns Promise resolving to update check result or null if failed
	 */
	static async performUpdateCheck(client: RewstClient, orgLabel: string): Promise<CloudUpdateResult | null> {
		vscode.window.showInformationMessage('Checking for cloud updates...', { modal: false });

		try {
			const updateCheck = await storage.checkForCloudUpdates(client);
			log.info(`Cloud update check completed for ${orgLabel}: hasUpdates=${updateCheck.hasUpdates}`);
			return updateCheck;
		} catch (error) {
			log.error(`Failed to check cloud updates for ${orgLabel}: ${error}`, true);
			vscode.window.showErrorMessage(`Failed to check for updates: ${error}`);
			return null;
		}
	}

	/**
	 * Handles cloud update notification and user interaction
	 *
	 * @param updateResult - Result from cloud update check
	 * @param orgLabel - Organization label for user messages
	 * @param contextEntry - Entry context for refresh command
	 * @returns Promise resolving to true if updates were processed, false otherwise
	 */
	static async handleUpdateNotification(
		updateResult: CloudUpdateResult,
		orgLabel: string,
		contextEntry: unknown,
	): Promise<boolean> {
		if (!updateResult.hasUpdates) {
			vscode.window.showInformationMessage(`No cloud updates found for ${orgLabel}`);
			return false;
		}

		const author = updateResult.author ? ` by ${updateResult.author}` : '';
		const action = await vscode.window.showInformationMessage(
			`Cloud updates found for ${orgLabel}${author}. Refresh now?`,
			'Refresh Now',
			'Later',
		);

		if (action === 'Refresh Now') {
			await vscode.commands.executeCommand('rewst-buddy.RefreshStructureFromCloud', [contextEntry]);
			return true;
		}

		return false;
	}

	/**
	 * Validates and extracts organization from tree lookup
	 *
	 * @param fs - Filesystem instance for tree lookup
	 * @param entry - Entry to extract org from
	 * @param contextName - Context name for error logging
	 * @returns Validated organization instance
	 * @throws Error if org cannot be found or is invalid
	 */
	static validateOrgFromEntry(entry: any, contextName: string): Org {
		if (!entry?.getUri) {
			log.error(`${contextName}: Entry missing getUri method`, true);
			throw new Error('Invalid entry structure');
		}

		const org = fs.tree.lookupOrg(entry.getUri());
		if (!org) {
			log.error(`${contextName}: Could not find organization for entry`, true);
			throw new Error('Organization not found');
		}

		if (!(org instanceof Org)) {
			log.error(`${contextName}: Invalid organization type`, true);
			throw new Error('Invalid organization structure');
		}

		return org;
	}
}
