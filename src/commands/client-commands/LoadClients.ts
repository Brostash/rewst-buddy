import { RewstClient } from '@client';
import { context, fs, view } from '@global';
import { log } from '@log';
import { Org } from '@models';
import { getBackgroundSyncService } from '../../services/BackgroundSyncService';
import GenericCommand from '../GenericCommand';

export class LoadClients extends GenericCommand {
	commandName = 'LoadClients';

	async execute(): Promise<void> {
		const contextName = 'LoadClients';
		log.info(`${contextName} command started`);

		try {
			const clients = await this.loadClientsFromStorage(contextName);
			if (clients.length === 0) {
				log.info(`${contextName}: No clients found to load`);
				return;
			}

			const backgroundSync = getBackgroundSyncService();
			await this.processClients(clients, backgroundSync, contextName);

			this.refreshView(contextName);
			log.info(`${contextName} command completed successfully - loaded ${clients.length} clients`);
		} catch (error) {
			log.error(`${contextName} command failed: ${error}`, true);
			throw new Error(`Failed to load clients: ${error}`);
		}
	}

	private async loadClientsFromStorage(contextName: string): Promise<RewstClient[]> {
		log.info(`${contextName}: Loading clients from storage`);
		const clients = await RewstClient.LoadClients(context);

		if (!Array.isArray(clients)) {
			log.error(`${contextName}: Invalid clients data - not an array`, true);
			throw new Error('Invalid clients data received from storage');
		}

		log.info(`${contextName}: Found ${clients.length} clients to load`);
		return clients;
	}

	private async processClients(clients: RewstClient[], backgroundSync: any, contextName: string): Promise<void> {
		for (const client of clients) {
			if (!client?.orgId) {
				log.error(`${contextName}: Invalid client - missing orgId`, true);
				continue;
			}

			await this.processSingleClient(client, backgroundSync, contextName);
		}
	}

	private async processSingleClient(client: RewstClient, backgroundSync: any, contextName: string): Promise<void> {
		log.info(`${contextName}: Creating org for client: ${client.orgId}`);
		const org = await Org.create(client);

		if (!org) {
			log.error(`${contextName}: Failed to create org for client: ${client.orgId}`, true);
			throw new Error(`Failed to create organization for client ${client.orgId}`);
		}

		fs.tree.newOrg(org);
		backgroundSync.addClient(client);

		log.info(`${contextName}: Successfully loaded org: ${org.label} (${org.orgId})`);
	}

	private refreshView(contextName: string): void {
		try {
			log.info(`${contextName}: Refreshing view after loading clients`);
			view.refresh();
		} catch (error) {
			log.error(`${contextName}: Failed to refresh view: ${error}`, true);
			// Don't throw here - main operation was successful
		}
	}
}
