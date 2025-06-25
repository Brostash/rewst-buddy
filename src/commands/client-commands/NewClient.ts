import GenericCommand from "../models/GenericCommand";
import { Org } from "@fs/models";
import vscode from 'vscode';
import { log } from "@log";

export class NewClient extends GenericCommand {
  commandName = "NewClient";

  async execute(...args: unknown[]) {
    log.info(`NewClient command started with ${args.length} args`);
    try {
      log.info('Creating new organization');
      const org = await Org.create(this.cmdContext);
      log.info(`Successfully created org: ${org.label} (${org.orgId})`);
      
      log.info('Adding new org to tree');
      this.cmdContext.fs.tree.newOrg(org);
      
      log.info('Refreshing view after creating new client');
      vscode.commands.executeCommand("rewst-buddy.RefreshView");
      
      log.info('NewClient command completed successfully');
    } catch (error) {
      log.error(`NewClient command failed: ${error}`);
      throw error;
    }
  }
}
