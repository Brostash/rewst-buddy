import { Template, TemplateFolder } from "@fs/models";
import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";
import { log } from '@log';

export class Rename extends GenericCommand {
  commandName = "Rename";
  async execute(...args: any): Promise<unknown> {
    const entry = args[0][0] ?? undefined;
    log.info(`Rename`);
    log.info(entry);

    if (entry instanceof Template) {
      log.info("Processing a Template");
    } else if (entry instanceof TemplateFolder) {
      log.info("Processing a TemplateFolder");
    } else {
      log.info("Not instance of detected type");
    }

    const label = await vscode.window.showInputBox({
      placeHolder: entry.label,
      prompt: "Enter a new name for the item",
      validateInput: (v) => {
        return entry.isValidLabel(v)
          ? undefined
          : "Please use alpha-numerics or []-";
      },
    });

    log.info(`new label ${label}`);
    await entry.setLabel(label);

    vscode.commands.executeCommand("rewst-buddy.RefreshView");
    vscode.commands.executeCommand("rewst-buddy.SaveFolderStructure", entry);
    return true;
  }
}
