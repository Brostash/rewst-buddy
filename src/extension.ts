// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import vscode from "vscode";

import RewstView from "@fs/RewstView";
import { CommandContext } from "@commands/models/GenericCommand";
import CommandInitiater from "@commands/models/CommandInitiater";
import { RewstClient } from "@client/index";
import Storage from "storage/Storage";
import { log } from "@log";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "rewst-buddy" is now active!');

  log.info("test", true);
  log.init(context);
  log.info("test");

  const view = new RewstView(context);
  // view.addSampleData();

  const ctx: CommandContext = {
    commandPrefix: "rewst-buddy",
    context: context,
    view: view,
    fs: view.rewstfs,
    storage: new Storage(context),
  };


  CommandInitiater.registerCommands(ctx);

  console.log("Done loading");
}

// This method is called when your extension is deactivated
export function deactivate() { }
