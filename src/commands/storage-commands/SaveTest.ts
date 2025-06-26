import { storage } from "storage/Storage";
import GenericCommand from "../models/GenericCommand";
import { uuidv7 } from "uuidv7";
import { log } from "@log";

export class SaveTest extends GenericCommand {
  commandName = "SaveTest";

  async execute(): Promise<unknown> {
    const rand = uuidv7();
    await this.cmdContext.context.globalState.update("test", rand);
    log.info(`saving ${rand}`);
    return;
  }
}
