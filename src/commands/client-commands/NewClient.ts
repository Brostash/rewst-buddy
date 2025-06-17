import GenericCommand from "../models/GenericCommand";
import { RewstClient } from "@client/index";
import { createOrg } from "@fs/models";

export class NewClient extends GenericCommand {
  commandName = "NewClient";

  async execute(...args: unknown[]) {
    const client = await RewstClient.create(this.context);
    const org = await createOrg(client.orgId);
    this.cmdContext.fs.tree.newOrg(org);
  }
}
