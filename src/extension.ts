// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import RewstView from "@fs/RewstView.js";
import { CommandContext } from "@commands/models/GenericCommand.js";
import CommandInitiater from "@commands/models/CommandInitiater.js";
import RewstClient from "rewst-client/RewstClient.js";
import Storage from "storage/Storage.js";
import { Logger } from "logger.js";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "rewst-buddy" is now active!');

  const log = new Logger(context);
  log.info("test", true);

  const view = new RewstView(context);
  // view.addSampleData();

  const ctx: CommandContext = {
    commandPrefix: "rewst-buddy",
    context: context,
    view: view,
    fs: view.rewstfs,
    storage: new Storage(context),
    log: log,
  };

  CommandInitiater.registerCommands(ctx);

  console.log("Done loading");
}

// This method is called when your extension is deactivated
export function deactivate() {}
