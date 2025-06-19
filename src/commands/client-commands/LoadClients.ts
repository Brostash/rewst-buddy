import GenericCommand from "../models/GenericCommand";
import { RewstClient } from "@client/index";
import { Entry, Org } from "@fs/models";


export class LoadClients extends GenericCommand {
  commandName = "LoadClients";

  async execute(): Promise<unknown> {
    const view = this.cmdContext.view;

    const clients = await RewstClient.LoadClients(this.context);

    for (const client of clients) {
      const org = await Org.create(this.cmdContext, client.orgId);

      view.rewstfs.tree.newOrg(org);
    }

    this.cmdContext.view.refresh();

    return;
  }
}
