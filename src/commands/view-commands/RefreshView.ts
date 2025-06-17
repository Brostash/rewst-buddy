import { log } from "@log";
import GenericCommand from "../models/GenericCommand";

export class RefreshView extends GenericCommand {
  commandName = "RefreshView";

  async execute(): Promise<unknown> {
    this.cmdContext.view.refresh();
    log.info(`Refreshed View`, true);
    return;
  }
}
