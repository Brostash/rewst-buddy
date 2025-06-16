import GenericCommand from "../models/GenericCommand.js";
import * as vscode from "vscode";

export class OpenLogs extends GenericCommand {
  commandName: string = "OpenLogs";

  async execute(): Promise<void> {
    const logfile: vscode.Uri = vscode.Uri.parse(this.cmdContext.log.logFile);
    vscode.commands.executeCommand("vscode.open", logfile);
  }
}
