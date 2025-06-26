import { storage } from "storage/Storage";
import GenericCommand from "../models/GenericCommand";
import { uuidv7 } from "uuidv7";
import { log } from "@log";

export class ReadTest extends GenericCommand {
  commandName = "ReadTest";

  async execute(): Promise<unknown> {
    const val = this.cmdContext.context.globalState.get("test");
    log.info(`reading ${val}`);

    const orgData = storage.getAllOrgData();
    log.info(orgData);
    return;
  }
}
