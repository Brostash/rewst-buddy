import GenericCommand from "../models/GenericCommand";

export class RefreshView extends GenericCommand {
  commandName: string = "RefreshView";

  async execute(): Promise<unknown> {
    this.cmdContext.view.refresh();
    this.log.info(`Refreshed View`, true);
    return;
  }
}
