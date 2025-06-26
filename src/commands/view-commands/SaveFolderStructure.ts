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
              templateName: template.label
            });
          }
        }

        // Create comprehensive org data structure
        const existingOrgData = storage.getRewstOrgData(org.id);
        const orgData = {
          ...(existingOrgData !== '{}' ? JSON.parse(existingOrgData) : {}),
          templateFolderStructure: {
            folders: folderStructure,
            templatePlacements: templatePlacements,
            lastUpdated: new Date().toISOString()
          }
        };

        storage.setRewstOrgData(org.id, JSON.stringify(orgData));
        log.info(`Saved folder structure for org "${org.label}" (${org.id}) with ${folderStructure.length} folders`);

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
