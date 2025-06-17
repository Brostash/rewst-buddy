import PersistentStorage from "PersistentStorage/RewstOrgData.js";
import GenericCommand from "../models/GenericCommand.js";
import { uuidv7 } from "uuidv7";

export class ReadTest extends GenericCommand {
  commandName: string = "ReadTest";

  async execute(): Promise<unknown> {
    const val = this.cmdContext.context.globalState.get("test");
    this.log.info(`reading ${val}`);

    const orgData = this.cmdContext.storage.getAllOrgData();
    this.log.info(orgData);
    return;
  }
}
