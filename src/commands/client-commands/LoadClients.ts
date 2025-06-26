import GenericCommand from "../models/GenericCommand";
import { RewstClient } from "@client/index";
import { Entry, Org } from "@fs/models";
import { log } from "@log";
import { getBackgroundSyncService } from "services/BackgroundSyncService";


export class LoadClients extends GenericCommand {
  commandName = "LoadClients";

  async execute(): Promise<unknown> {
    log.info('LoadClients command started');
    try {
      const view = this.cmdContext.view;

      log.info('Loading clients from storage');
      const clients = await RewstClient.LoadClients(this.context);
      log.info(`Found ${clients.length} clients to load`);

      const backgroundSync = getBackgroundSyncService(this.context);

      for (const client of clients) {
        log.info(`Creating org for client: ${client.orgId}`);
        const org = await Org.create(this.cmdContext, client);

        view.rewstfs.tree.newOrg(org);

        // Register client with background sync service for cloud monitoring
        backgroundSync.addClient(client);

        log.info(`Successfully loaded org: ${org.label} (${org.orgId})`);
      }

      log.info('Refreshing view after loading clients');
      this.cmdContext.view.refresh();

      log.info(`LoadClients command completed successfully - loaded ${clients.length} clients`);
      return;
    } catch (error) {
      log.error(`LoadClients command failed: ${error}`);
      throw error;
    }
  }
}
