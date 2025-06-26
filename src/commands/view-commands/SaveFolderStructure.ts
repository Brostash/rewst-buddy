import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";
import { log } from "@log";
import { storage } from "storage/Storage";
import { Org } from "@fs/models";

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

        // Serialize folder structure using Tree.ts hierarchy
        const serializedStructure = await org.serialize();

        storage.setRewstOrgData(org.id, serializedStructure);
        log.info(`Saved folder structure for org ID: ${org.id}`);
      }

      log.info('SaveFolderStructure command completed (no-op)');
      return true;
    } catch (error) {
      log.error(`SaveFolderStructure command failed: ${error}`);
      throw error;
    }
  }
}
