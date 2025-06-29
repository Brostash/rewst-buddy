import { commandPrefix, context } from '@global';
import { log } from 'log';
import vscode from 'vscode';
import * as Commands from './exportedCommands';
import GenericCommand, { createCommand } from './GenericCommand';

export default class CommandInitiater {
	static registerCommands() {
		log.info('registering');

		const types: (new () => GenericCommand)[] = Object.values(Commands);

		types.forEach(type => {
			const cmd = createCommand(type);
			const name = `${commandPrefix}.${cmd.commandName}`;
			log.info(`Registering command: ${name}`);
			context.subscriptions.push(
				vscode.commands.registerCommand(name, async (...args: any[]) => {
					log.info(`executing cmd ${cmd.commandName}`);
					return await cmd.execute(args);
				}),
			);
		});
	}
}
