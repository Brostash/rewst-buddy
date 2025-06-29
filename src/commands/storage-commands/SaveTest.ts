import { context } from '@global';
import { log } from '@log';
import { uuidv7 } from 'uuidv7';
import GenericCommand from '../GenericCommand';

export class SaveTest extends GenericCommand {
	commandName = 'SaveTest';

	async execute(): Promise<void> {
		const contextName = 'SaveTest';
		log.info(`${contextName} command started`);

		try {
			const rand = uuidv7();
			await context.globalState.update('test', rand);
			log.info(`${contextName}: saved test value: ${rand}`);
		} catch (error) {
			log.error(`${contextName} command failed: ${error}`, true);
			throw new Error(`Save test failed: ${error}`);
		}
	}
}
