import { log } from '@log';
import { CloudOperations } from '@utils';
import GenericCommand from '../GenericCommand';

export class CheckForCloudUpdates extends GenericCommand {
	commandName = 'CheckForCloudUpdates';

	async execute(...args: unknown[]): Promise<boolean> {
		const contextName = 'CheckForCloudUpdates';
		log.info(`${contextName} command started`);

		try {
			const entry = this.extractAndValidateEntry(args, contextName);
			const org = CloudOperations.validateOrgFromEntry(entry, contextName);

			if (!CloudOperations.validateCloudSyncEnabled(entry.client, org.label)) {
				return false;
			}

			const updateResult = await CloudOperations.performUpdateCheck(entry.client, org.label);
			if (!updateResult) {
				return false;
			}

			await CloudOperations.handleUpdateNotification(updateResult, org.label, entry);
			return true;
		} catch (error) {
			log.error(`${contextName} command failed: ${error}`, true);
			throw new Error(`Failed to check for cloud updates: ${error}`);
		}
	}

	private extractAndValidateEntry(args: unknown[], contextName: string): any {
		if (!Array.isArray(args) || args.length === 0) {
			log.error(`${contextName}: No arguments provided`, true);
			throw new Error('No organization selected');
		}

		const firstArg = args[0];
		if (!Array.isArray(firstArg) || firstArg.length === 0) {
			log.error(`${contextName}: Invalid argument structure`, true);
			throw new Error('No organization selected');
		}

		const entry = firstArg[0];
		if (!entry) {
			log.error(`${contextName}: No entry found in arguments`, true);
			throw new Error('No organization selected');
		}

		return entry;
	}
}
