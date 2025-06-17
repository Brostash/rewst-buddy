import RewstClient from "client/RewstClient";
import GenericCommand from "../models/GenericCommand";
import * as vscode from "vscode";
import {
  createTemplateFolder,
  TemplateFolder,
  EntryInput
} from "@fs/models";

export class CreateTemplateFolder extends GenericCommand {
  commandName = "CreateTemplateFolder";
  async execute(...args: any): Promise<void> {
    const entry = args[0][0] ?? undefined;

    if (!(entry instanceof TemplateFolder)) {
      const message =
        "Cannot create folder in something that is not a folder";
      vscode.window.showErrorMessage(message);
      throw new Error(message);
    }

    const label = await vscode.window.showInputBox({
      placeHolder: "Folder Name",
      prompt: "Enter a name for the template",
    });

    if (!label) {
      console.log("No label provided, exiting Folder Creation");
      return;
    }

    const templateFolderInput: EntryInput = {
      client: entry.client,
      parent: entry,
    };

    const folder = await createTemplateFolder(entry, label);

    vscode.commands.executeCommand("rewst-buddy.RefreshView", folder);
  }
}
