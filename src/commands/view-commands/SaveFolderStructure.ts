import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";
import { log } from "@log";
import { storage } from "storage/Storage";
import { Org, TemplateFolder, RType, Template } from "@fs/models";

export class SaveFolderStructure extends GenericCommand {
  commandName = "SaveFolderStructure";
  async execute(...args: any): Promise<unknown> {
    log.info('SaveFolderStructure command started');
    try {
      const entry = args[0][0] ?? undefined;
      log.info(`SaveFolderStructure requested for entry: ${entry?.label || 'unknown'}`);

      if (entry) {
        // Get org ID from the entry's URI using tree lookup
        const org: Org = this.cmdContext.fs.tree.lookupOrg(entry.getUri());

        // Collect all folders and their structure
        const allFolders = await org.getAllEntriesOfType(RType.TemplateFolder, TemplateFolder);
        const folderStructure = [];

        for (const [id, folder] of allFolders) {
          const serializedFolder = JSON.parse(await folder.serialize());
          folderStructure.push(serializedFolder);
        }

        // Collect template placements (which folder each template is in)
        const allTemplates = await org.getAllEntriesOfType(RType.Template, Template);
        const templatePlacements = [];

        for (const [templateId, template] of allTemplates) {
          if (template.parent && template.parent.rtype === RType.TemplateFolder) {
            templatePlacements.push({
              templateId: templateId,
              folderId: template.parent.id,
              templateName: template.label,
              templateExt: template.ext || 'ps1' // Save extension, default to ps1
            });
          }
        }

        // Create comprehensive org data structure
        const existingOrgData = storage.getRewstOrgData(org.id);
        const templateFolderStructure = {
          folders: folderStructure,
          templatePlacements: templatePlacements,
          lastUpdated: new Date().toISOString()
        };

        const orgData = {
          ...(existingOrgData !== '{}' ? JSON.parse(existingOrgData) : {}),
          templateFolderStructure
        };

        // Always save locally
        storage.setRewstOrgData(org.id, JSON.stringify(orgData));
        log.info(`Saved folder structure locally for org "${org.label}" (${org.id}) with ${folderStructure.length} folders`);

        // Check if cloud sync is enabled and save to cloud if so
        try {
          const cloudSyncEnabled = storage.isCloudSyncEnabled(entry.client);
          if (cloudSyncEnabled) {
            // Get last known version for conflict detection
            const lastKnownVersion = storage.getLastKnownCloudVersion(entry.client);
            const author = "VS Code User"; // TODO: Get actual user info if available

            // Attempt to save with conflict detection
            const saveResult = await storage.saveFolderStructureWithConflictCheck(
              entry.client,
              templateFolderStructure,
              lastKnownVersion,
              author
            );

            if (saveResult.success) {
              log.info(`Saved folder structure to cloud for org "${org.label}" (${org.id})`);
              vscode.window.showInformationMessage(`Folder structure saved locally and to cloud for ${org.label}`);
            } else if (saveResult.conflict) {
              // Handle conflict - show resolution dialog
              const action = await vscode.window.showWarningMessage(
                `Folder structure for "${org.label}" was modified by someone else. Choose which version to keep:`,
                'Use My Changes',
                'Use Cloud Changes',
                'Cancel'
              );

              if (action === 'Use My Changes') {
                // Force save with current version
                const forceResult = await storage.saveFolderStructureWithConflictCheck(
                  entry.client,
                  templateFolderStructure,
                  saveResult.currentVersion || 0,
                  author
                );
                if (forceResult.success) {
                  vscode.window.showInformationMessage(`Folder structure forcibly saved to cloud for ${org.label}`);
                }
              } else if (action === 'Use Cloud Changes') {
                vscode.window.showInformationMessage(
                  `Local changes discarded. Please refresh to see cloud changes for ${org.label}`
                );
              }
              // If Cancel, do nothing
            }
          } else {
            log.info(`Cloud sync disabled for org "${org.label}" (${org.id}) - only saved locally`);
            vscode.window.showInformationMessage(`Folder structure saved locally for ${org.label}`);
          }
        } catch (error) {
          log.error(`Failed to save folder structure to cloud for org "${org.label}": ${error}`);
          vscode.window.showWarningMessage(`Folder structure saved locally but failed to sync to cloud: ${error}`);
        }

        // Test deserialization
        const storedData = storage.getRewstOrgData(org.id);
        try {
          const deserializedStructure = JSON.parse(storedData);
          log.info(`Deserialization test succeeded. Structure has ${deserializedStructure.templateFolderStructure?.folders?.length || 0} folders`);
        } catch (error) {
          log.error(`Deserialization test failed: ${error}`);
        }
      }

      log.info('SaveFolderStructure command completed (no-op)');
      return true;
    } catch (error) {
      log.error(`SaveFolderStructure command failed: ${error}`);
      throw error;
    }
  }
}
