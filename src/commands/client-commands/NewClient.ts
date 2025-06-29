import GenericCommand from '../GenericCommand';
import { Org } from '@models';
import vscode from 'vscode';
import { log } from '@log';
import { fs } from '@global';

export class NewClient extends GenericCommand {
	commandName = 'NewClient';

	async execute(...args: unknown[]): Promise<void> {
		const contextName = 'NewClient';
		log.info(`${contextName} command started with ${args.length} args`);

		try {
			log.info(`${contextName}: Creating new organization`);
			const org = await Org.create();

			if (!org) {
				log.error(`${contextName}: Failed to create organization - null result`, true);
				throw new Error('Failed to create organization');
			}

			log.info(`${contextName}: Successfully created org: ${org.label} (${org.orgId})`);

			log.info(`${contextName}: Adding new org to tree`);
			fs.tree.newOrg(org);

			log.info(`${contextName}: Refreshing view after creating new client`);
			await vscode.commands.executeCommand('rewst-buddy.RefreshView');

			log.info(`${contextName} command completed successfully`);
		} catch (error) {
			log.error(`${contextName} command failed: ${error}`, true);
			throw new Error(`Failed to create new client: ${error}`);
		}
	}
}
