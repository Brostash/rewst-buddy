import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";
import { log } from "@log";

export class OpenLogs extends GenericCommand {
  commandName = "OpenLogs";

  async execute(): Promise<void> {
    const logfile: vscode.Uri = vscode.Uri.parse(log.logFile);
    vscode.commands.executeCommand("vscode.open", logfile);
  }
}
