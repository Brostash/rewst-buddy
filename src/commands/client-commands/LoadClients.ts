import GenericCommand from "../models/GenericCommand.js";
import RewstClient from "../../rewst-client/RewstClient.js";
import { Org, createOrg } from "@fs/models/Org.js";
import RewstFS from "fs/RewstFS.js";

export class LoadClients extends GenericCommand {
  commandName: string = "LoadClients";

  async execute(): Promise<unknown> {
    const view = this.cmdContext.view;

    const clients = await RewstClient.LoadClients(this.context);

    for (const client of clients) {
      const org = await createOrg(client.orgId);
      view.rewstfs.tree.newOrg(org);
    }

    return;
  }
}
