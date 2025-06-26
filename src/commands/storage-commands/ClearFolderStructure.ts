import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";
import { log } from "@log";
import { storage } from "storage/Storage";

export class ClearFolderStructure extends GenericCommand {
    commandName = "ClearFolderStructure";

    async execute(...args: any): Promise<unknown> {
        log.info('ClearFolderStructure command started');
        try {
            // Get all stored org IDs
            const storedOrgIds = storage.getAllStoredOrgIds();

            if (storedOrgIds.length === 0) {
                vscode.window.showInformationMessage('No stored organization data found.');
                return;
            }

            // Create quick pick items with org info
            const orgPickItems: vscode.QuickPickItem[] = [];

            for (const orgId of storedOrgIds) {
                try {
                    const orgData = storage.getRewstOrgData(orgId);
                    const parsedData = JSON.parse(orgData || '{}');

                    const label = `Org: ${parsedData.orgLabel}`;
                    let description = 'No folder structure data';

                    if (parsedData.templateFolderStructure) {
                        const folderCount = parsedData.templateFolderStructure.folders?.length || 0;
                        const templateCount = parsedData.templateFolderStructure.templatePlacements?.length || 0;
                        description = `${folderCount} folders, ${templateCount} template placements`;
                    }

                    orgPickItems.push({
                        label,
                        description,
                        detail: orgId
                    });
                } catch (error) {
                    log.error(`Failed to parse data for org ${orgId}: ${error}`);
                    orgPickItems.push({
                        label: `Org ID: ${orgId}`,
                        description: 'Invalid data (corrupted)',
                        detail: orgId
                    });
                }
            }

            // Show org selection
            const selectedOrg = await vscode.window.showQuickPick(orgPickItems, {
                placeHolder: 'Select organization to clear folder structure',
                title: 'Clear Folder Structure'
            });

            if (!selectedOrg) {
                log.info('User cancelled org selection');
                return;
            }

            const orgIdToClear = selectedOrg.detail!;

            // Confirm deletion
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to clear the folder structure for org "${orgIdToClear}"?\n\nThis action cannot be undone.`,
                { modal: true },
                'Clear Structure',
                'Cancel'
            );

            if (confirmation !== 'Clear Structure') {
                log.info('User cancelled folder structure clearing');
                return;
            }

            // Clear the folder structure
            try {
                const existingData = storage.getRewstOrgData(orgIdToClear);
                const orgData = existingData !== '{}' ? JSON.parse(existingData) : {};

                // Remove the templateFolderStructure property
                delete orgData.templateFolderStructure;

                // Save the updated data (or empty object if no other data)
                const updatedData = Object.keys(orgData).length > 0 ? JSON.stringify(orgData) : '{}';
                storage.setRewstOrgData(orgIdToClear, updatedData);

                log.info(`Successfully cleared folder structure for org ${orgIdToClear}`);
                vscode.window.showInformationMessage(`Folder structure cleared for org "${orgIdToClear}"`);

            } catch (error) {
                log.error(`Failed to clear folder structure for org ${orgIdToClear}: ${error}`);
                vscode.window.showErrorMessage(`Failed to clear folder structure: ${error}`);
                throw error;
            }

            return true;
        } catch (error) {
            log.error(`ClearFolderStructure command failed: ${error}`);
            vscode.window.showErrorMessage(`Clear folder structure failed: ${error}`);
            throw error;
        }
    }
}