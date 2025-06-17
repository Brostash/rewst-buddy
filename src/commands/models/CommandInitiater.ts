import * as vscode from "vscode";
import GenericCommand, {
  createCommand,
  CommandContext,
} from "@commands/models/GenericCommand";
import * as Commands from "@commands/index";

export default class CommandInitiater {
  static registerCommands(cmdContext: CommandContext) {
    cmdContext.log.info("registering");

    const types: (new (ctx: CommandContext) => GenericCommand)[] =
      Object.values(Commands);

    types.forEach((type) => {
      const cmd = createCommand(type, cmdContext);
      const name = `${cmdContext.commandPrefix}.${cmd.commandName}`;
      cmdContext.log.info(`Registering command: ${name}`);
      cmdContext.context.subscriptions.push(
        vscode.commands.registerCommand(name, async (...args: any[]) => {
          cmdContext.log.info(`executing cmd ${cmd.commandName}`);
          return await cmd.execute(args);
        })
      );
    });
  }
}
