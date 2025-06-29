import { context } from '@global';
import { log } from '@log';
import { storage } from '@storage';
import GenericCommand from '../GenericCommand';

export class ReadTest extends GenericCommand {
	commandName = 'ReadTest';

	async execute(): Promise<void> {
		const contextName = 'ReadTest';
		log.info(`${contextName} command started`);

		try {
			const val = context.globalState.get('test');
			log.info(`${contextName}: reading test value: ${val}`);

			const orgData = storage.getAllOrgData();
			log.info(`${contextName}: org data retrieved: ${JSON.stringify(Array.from(orgData.entries()))}`);
		} catch (error) {
			log.error(`${contextName} command failed: ${error}`, true);
			throw new Error(`Read test failed: ${error}`);
		}
	}
}
