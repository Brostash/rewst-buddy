import { RewstClient } from '@client';
import { context } from '@global';
import { log } from '@log';
import GenericCommand from '../GenericCommand';

export class ClearProfiles extends GenericCommand {
	commandName = 'ClearProfiles';

	async execute(): Promise<boolean> {
		const contextName = 'ClearProfiles';
		log.info(`${contextName} command started`);

		try {
			RewstClient.clearProfiles(context);
			log.info(`${contextName}: Successfully cleared profiles`);
			return true;
		} catch (error) {
			log.error(`${contextName} command failed: ${error}`, true);
			throw new Error(`Failed to clear profiles: ${error}`);
		}
	}
}
