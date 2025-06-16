import GenericCommand from "../models/GenericCommand.js";
import RewstClient from "../../rewst-client/RewstClient.js";
import { createOrg } from "@fs/models/Org.js";

export class NewClient extends GenericCommand {
  commandName: string = "NewClient";

  async execute(...args: unknown[]) {
    const client = await RewstClient.create(this.context);
    const org = await createOrg(client.orgId);
    this.cmdContext.fs.tree.newOrg(org);
  }
}
