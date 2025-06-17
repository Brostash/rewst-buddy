import { Entry } from "@fs/models";
import GenericCommand from "../models/GenericCommand";
import * as vscode from "vscode";

export class CopyId extends GenericCommand {
  commandName = "CopyId";
  async execute(...args: any): Promise<void> {
    const entry = args[0][0] ?? undefined;

    if (!(entry instanceof Entry)) {
      const message = "Cannot copy id of that";
      vscode.window.showErrorMessage(message);
      throw new Error(message);
    }
    await vscode.env.clipboard.writeText(entry.id);
    vscode.window.showInformationMessage("Text copied to clipboard!");
  }
}
