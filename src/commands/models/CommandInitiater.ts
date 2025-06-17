import vscode from "vscode";
import GenericCommand, {
  createCommand,
  CommandContext,
} from "@commands/models/GenericCommand";
import * as Commands from "@commands/index";
import { log } from "log";


export default class CommandInitiater {
  static registerCommands(cmdContext: CommandContext) {
    log.info("registering");

    const types: (new (ctx: CommandContext) => GenericCommand)[] =
      Object.values(Commands);

    types.forEach((type) => {
      const cmd = createCommand(type, cmdContext);
      const name = `${cmdContext.commandPrefix}.${cmd.commandName}`;
      log.info(`Registering command: ${name}`);
      cmdContext.context.subscriptions.push(
        vscode.commands.registerCommand(name, async (...args: any[]) => {
          log.info(`executing cmd ${cmd.commandName}`);
          return await cmd.execute(args);
        })
      );
    });
  }
}
