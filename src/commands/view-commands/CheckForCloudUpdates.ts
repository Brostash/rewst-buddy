import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";
import { log } from "@log";
import { storage } from "storage/Storage";
import { Org } from "@fs/models";

export class CheckForCloudUpdates extends GenericCommand {
    commandName = "CheckForCloudUpdates";

    async execute(...args: any): Promise<unknown> {
        log.info('CheckForCloudUpdates command started');
        try {
            const entry = args[0][0] ?? undefined;

            if (!entry) {
                vscode.window.showErrorMessage("No organization selected");
                return false;
            }

            // Get org from the entry's URI using tree lookup
            const org: Org = this.cmdContext.fs.tree.lookupOrg(entry.getUri());

            // Check if cloud sync is enabled
            if (!storage.isCloudSyncEnabled(entry.client)) {
                vscode.window.showInformationMessage(`Cloud sync is not enabled for ${org.label}`);
                return false;
            }

            vscode.window.showInformationMessage("Checking for cloud updates...", { modal: false });

            // Check for updates
            const updateCheck = await storage.checkForCloudUpdates(entry.client);

            if (updateCheck.hasUpdates) {
                const author = updateCheck.author ? ` by ${updateCheck.author}` : '';
                const action = await vscode.window.showInformationMessage(
                    `Cloud updates found for ${org.label}${author}. Refresh now?`,
                    'Refresh Now',
                    'Later'
                );

                if (action === 'Refresh Now') {
                    await vscode.commands.executeCommand('rewst-buddy.RefreshStructureFromCloud', [entry]);
                }
            } else {
                vscode.window.showInformationMessage(`No cloud updates found for ${org.label}`);
            }

            return true;
        } catch (error) {
            log.error(`CheckForCloudUpdates command failed: ${error}`);
            vscode.window.showErrorMessage(`Failed to check for updates: ${error}`);
            return false;
        }
    }
}