import RewstClient from "client/RewstClient";
import GenericCommand from "../models/GenericCommand";
import * as vscode from "vscode";
import { createTemplate, Template } from "@fs/models";
import { TemplateFolder } from "@fs/models";

export class CreateTemplate extends GenericCommand {
  commandName = "CreateTemplate";

  async execute(...args: any): Promise<void> {
    const entry = args[0][0] ?? undefined;

    if (!(entry instanceof TemplateFolder)) {
      const message =
        "Cannot create template in something that is not a folder";
      vscode.window.showErrorMessage(message);
      throw new Error(message);
    }

    const label = await vscode.window.showInputBox({
      placeHolder: "Template Name",
      prompt: "Enter a name for the template",
    });

    if (!label) {
      this.log.error("No label provided, exiting Template Creation");
      return;
    }

    const template = await createTemplate(entry, label);
    vscode.commands.executeCommand("rewst-buddy.RefreshView", template);
    vscode.commands.executeCommand("rewst-buddy.SaveFolderStructure", template);
  }
}
