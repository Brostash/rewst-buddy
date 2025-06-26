// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import vscode from "vscode";

import RewstView from "@fs/RewstView";
import { CommandContext } from "@commands/models/GenericCommand";
import CommandInitiater from "@commands/models/CommandInitiater";
import { RewstClient } from "@client/index";
import { storage } from "storage/Storage";
import { log } from "@log";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (log.info) and errors (console.error)
  // This line of code will only be executed once when your extension is activated

  // Store context globally for access by Template conflict modal
  (globalThis as any).rewstBuddyContext = context;

  log.init(context);
  storage.init(context);
  log.info('Congratulations, your extension "rewst-buddy" is now active!');

  const view = new RewstView(context);

  const ctx: CommandContext = {
    commandPrefix: "rewst-buddy",
    context: context,
    view: view,
    fs: view.rewstfs,
  };


  CommandInitiater.registerCommands(ctx);

  vscode.commands.executeCommand('rewst-buddy.LoadClients');

  log.info("Done loading");
}

// This method is called when your extension is deactivated
export function deactivate() {
  // Filesystem provider is automatically disposed via RewstView's context.subscriptions
  log.info('Deactivating rewst-buddy extension');
}
