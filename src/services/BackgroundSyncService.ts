import vscode from "vscode";
import { storage } from "storage/Storage";
import { log } from "@log";
import RewstClient from "client/RewstClient";

export class BackgroundSyncService {
    private context: vscode.ExtensionContext;
    private syncInterval?: NodeJS.Timeout;
    private clients = new Set<RewstClient>();
    private readonly SYNC_INTERVAL_MS = 1 * 60 * 1000; // 3 minutes

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public start(): void {
        if (this.syncInterval) {
            return; // Already started
        }

        log.info("Starting background sync service");
        this.syncInterval = setInterval(() => {
            this.checkForUpdates();
        }, this.SYNC_INTERVAL_MS);

        // Initial check after 30 seconds
        setTimeout(() => {
            this.checkForUpdates();
        }, 30000);
    }

    public stop(): void {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = undefined;
            log.info("Stopped background sync service");
        }
    }

    public addClient(client: RewstClient): void {
        this.clients.add(client);
        log.info(`Added client to background sync: ${client.orgId}`);
    }

    public removeClient(client: RewstClient): void {
        this.clients.delete(client);
        log.info(`Removed client from background sync: ${client.orgId}`);
    }

    private async checkForUpdates(): Promise<void> {
        if (this.clients.size === 0) {
            return;
        }

        log.info(`Checking for cloud updates across ${this.clients.size} organizations`);

        for (const client of this.clients) {
            try {
                const updateCheck = await storage.checkForCloudUpdates(client);

                if (updateCheck.hasUpdates) {
                    log.info(`Cloud updates detected for org ${client.orgId} (version ${updateCheck.currentVersion} by ${updateCheck.author})`);

                    // Show non-intrusive notification
                    const action = await vscode.window.showInformationMessage(
                        `Folder structure updated by ${updateCheck.author || 'another user'}. Refresh to see changes?`,
                        'Refresh Now',
                        'Later'
                    );

                    if (action === 'Refresh Now') {
                        await this.refreshStructureFromCloud(client);
                    }
                }
            } catch (error) {
                log.error(`Error checking for updates for org ${client.orgId}: ${error}`);
            }
        }
    }

    private async refreshStructureFromCloud(client: RewstClient): Promise<void> {
        try {
            log.info(`Refreshing folder structure from cloud for org ${client.orgId}`);

            // Trigger a refresh of the view
            await vscode.commands.executeCommand('rewst-buddy.RefreshStructureFromCloud', client);

            vscode.window.showInformationMessage('Folder structure refreshed from cloud');
        } catch (error) {
            log.error(`Failed to refresh structure from cloud for org ${client.orgId}: ${error}`);
            vscode.window.showErrorMessage(`Failed to refresh folder structure: ${error}`);
        }
    }

    public dispose(): void {
        this.stop();
        this.clients.clear();
    }
}

// Singleton instance
let backgroundSyncService: BackgroundSyncService | undefined;

export function getBackgroundSyncService(context: vscode.ExtensionContext): BackgroundSyncService {
    if (!backgroundSyncService) {
        backgroundSyncService = new BackgroundSyncService(context);
    }
    return backgroundSyncService;
}