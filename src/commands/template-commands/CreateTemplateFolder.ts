import RewstClient from "client/RewstClient";
import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";
import {
  createTemplateFolder,
  TemplateFolder,
  EntryInput
} from "@fs/models";
import { log } from '@log';


export class CreateTemplateFolder extends GenericCommand {
  commandName = "CreateTemplateFolder";
  async execute(...args: any): Promise<void> {
    log.info('CreateTemplateFolder command started');
    try {
      const entry = args[0][0] ?? undefined;
      log.info(`Creating template folder in: ${entry?.label || 'unknown'} (${entry?.id || 'unknown'})`);

      if (!(entry instanceof TemplateFolder)) {
        const message =
          "Cannot create folder in something that is not a folder";
        log.error(`CreateTemplateFolder failed: ${message}`);
        vscode.window.showErrorMessage(message);
        throw new Error(message);
      }

      log.info('Prompting user for folder name');
      const label = await vscode.window.showInputBox({
        placeHolder: "Folder Name",
        prompt: "Enter a name for the template",
      });

      if (!label) {
        log.info("No label provided, exiting Folder Creation");
        return;
      }

      log.info(`Creating template folder with name: ${label}`);
      const templateFolderInput: EntryInput = {
        client: entry.client,
        parent: entry,
      };

      const folder = await createTemplateFolder(entry, label);
      log.info(`Successfully created template folder: ${folder.label} (${folder.id})`);

      log.info('Refreshing view after folder creation');
      vscode.commands.executeCommand("rewst-buddy.RefreshView", folder);
      
      log.info('CreateTemplateFolder command completed successfully');
    } catch (error) {
      log.error(`CreateTemplateFolder command failed: ${error}`);
      throw error;
    }
  }
}
