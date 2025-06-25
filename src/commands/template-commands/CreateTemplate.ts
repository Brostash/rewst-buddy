import RewstClient from "client/RewstClient";
import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";
import { createTemplate, Template } from "@fs/models";
import { TemplateFolder } from "@fs/models";
import { log } from "@log";


export class CreateTemplate extends GenericCommand {
  commandName = "CreateTemplate";

  async execute(...args: any): Promise<void> {
    log.info('CreateTemplate command started');
    try {
      const entry = args[0][0] ?? undefined;
      log.info(`Creating template in: ${entry?.label || 'unknown'} (${entry?.id || 'unknown'})`);

      if (!(entry instanceof TemplateFolder)) {
        const message =
          "Cannot create template in something that is not a folder";
        log.error(`CreateTemplate failed: ${message}`);
        vscode.window.showErrorMessage(message);
        throw new Error(message);
      }

      log.info('Prompting user for template name');
      const label = await vscode.window.showInputBox({
        placeHolder: "Template Name",
        prompt: "Enter a name for the template",
      });

      if (!label) {
        log.info("No label provided, exiting Template Creation");
        return;
      }

      log.info(`Creating template with name: ${label}`);
      const template = await createTemplate(entry, label);
      log.info(`Successfully created template: ${template.label} (${template.id})`);
      
      log.info('Refreshing view and saving folder structure');
      vscode.commands.executeCommand("rewst-buddy.RefreshView", template);
      vscode.commands.executeCommand("rewst-buddy.SaveFolderStructure", template);
      
      log.info('CreateTemplate command completed successfully');
    } catch (error) {
      log.error(`CreateTemplate command failed: ${error}`);
      throw error;
    }
  }
}
