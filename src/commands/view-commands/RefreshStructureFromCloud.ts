import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";
import { log } from "@log";
import { storage } from "storage/Storage";
import { Org, Entry } from "@fs/models";
import RewstClient from "client/RewstClient";

export class RefreshStructureFromCloud extends GenericCommand {
    commandName = "RefreshStructureFromCloud";

    async execute(...args: any): Promise<unknown> {
        log.info('RefreshStructureFromCloud command started');

        try {
            // Both call paths pass a RewstClient as the first argument
            const client = args[0][0] as RewstClient;

            if (!client || !client.orgId) {
                vscode.window.showErrorMessage("Invalid client provided");
                return false;
            }

            const orgId = client.orgId;
            log.info(`Processing refresh for org ${orgId}`);

            // Check if cloud sync is enabled
            if (!storage.isCloudSyncEnabled(client)) {
                vscode.window.showWarningMessage("Cloud sync is not enabled for this organization");
                return false;
            }

            // Get current cloud structure
            const cloudStructure = await storage.getCurrentCloudStructure(client);
            if (!cloudStructure) {
                vscode.window.showInformationMessage("No cloud folder structure found");
                return false;
            }

            // Update local storage with cloud structure
            const existingOrgData = storage.getRewstOrgData(orgId);
            const orgData = {
                ...(existingOrgData !== '{}' ? JSON.parse(existingOrgData) : {}),
                templateFolderStructure: cloudStructure
            };

            storage.setRewstOrgData(orgId, JSON.stringify(orgData));

            // Update stored version
            if (cloudStructure.version) {
                storage.setLastKnownCloudVersion(client, cloudStructure.version);
            }

            log.info(`Refreshed folder structure from cloud for org ${orgId}, version ${cloudStructure.version}`);

            // Force rebuild of in-memory tree structure
            await this.rebuildOrgStructure(orgId);

            // Refresh the view to show updated structure
            await vscode.commands.executeCommand('rewst-buddy.RefreshView');

            const author = cloudStructure.author ? ` (updated by ${cloudStructure.author})` : '';
            vscode.window.showInformationMessage(`Folder structure refreshed from cloud${author}`);

            return true;
        } catch (error) {
            log.error(`RefreshStructureFromCloud command failed: ${error}`);
            vscode.window.showErrorMessage(`Failed to refresh from cloud: ${error}`);
            return false;
        }
    }

    /**
     * Reset initialization state of org and all children to force rebuild from updated storage
     */
    private async rebuildOrgStructure(orgId: string): Promise<void> {
        try {
            // Find the org in the tree
            const tree = this.cmdContext.fs.tree;
            const org = tree.orgs.get(orgId);

            if (!org) {
                log.error(`Org ${orgId} not found in tree for rebuild`);
                return;
            }

            log.info(`Rebuilding org structure for ${org.label} (${orgId})`);

            // Reset initialization state recursively
            this.resetInitializationState(org);

            // Force re-initialization of the org and its children
            await org.initialize();

            log.info(`Successfully rebuilt org structure for ${orgId}`);
        } catch (error) {
            log.error(`Failed to rebuild org structure for ${orgId}: ${error}`);
            throw error;
        }
    }

    /**
     * Recursively reset initialization state for an entry and all its children
     */
    private resetInitializationState(entry: any): void {
        // Reset the entry's initialization state
        entry.initialized = false;

        // Clear children array to force rebuild
        const childrenToReset = [...entry.children];
        entry.children = [];

        // Recursively reset children
        childrenToReset.forEach(child => {
            this.resetInitializationState(child);
        });

        log.info(`Reset initialization state for ${entry.label} (${entry.id})`);
    }
}