import { Template, TemplateFolder } from "@fs/models";
import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";

export class Rename extends GenericCommand {
  commandName = "Rename";
  async execute(...args: any): Promise<unknown> {
    const entry = args[0][0] ?? undefined;
    console.log(`Rename`);
    console.log(entry);

    if (entry instanceof Template) {
      console.log("Processing a Template");
    } else if (entry instanceof TemplateFolder) {
      console.log("Processing a TemplateFolder");
    } else {
      console.log("Not instance of detected type");
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

    console.log(`new label ${label}`);
    await entry.setLabel(label);

    vscode.commands.executeCommand("rewst-buddy.RefreshView");
    vscode.commands.executeCommand("rewst-buddy.SaveFolderStructure", entry);
    return true;
  }
}
