import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";
import { log } from "@log";

export class OpenLogs extends GenericCommand {
  commandName = "OpenLogs";

  async execute(): Promise<void> {
    log.info('OpenLogs command started');
    try {
      log.info(`Opening log file: ${log.logFile}`);
      const logfile: vscode.Uri = vscode.Uri.parse(log.logFile);
      await vscode.commands.executeCommand("vscode.open", logfile);
      log.info('Successfully opened log file in VS Code');
    } catch (error) {
      log.error(`OpenLogs command failed: ${error}`);
      vscode.window.showErrorMessage(`Failed to open log file: ${error}`);
      throw error;
    }
  }
}
