import RewstClient from "client/RewstClient";
import GenericCommand from "../models/GenericCommand";
import * as vscode from "vscode";

export class ClearProfiles extends GenericCommand {
  commandName: string = "ClearProfiles";

  async execute(): Promise<unknown> {
    RewstClient.clearProfiles(this.context);
    this.log.info(`Cleared profiles`);
    return true;
  }
}
