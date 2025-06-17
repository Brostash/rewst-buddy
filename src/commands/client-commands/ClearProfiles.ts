import RewstClient from "client/RewstClient";
import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";
import { log } from "@log";

export class ClearProfiles extends GenericCommand {
  commandName = "ClearProfiles";

  async execute(): Promise<unknown> {
    RewstClient.clearProfiles(this.context);
    log.info(`Cleared profiles`);
    return true;
  }
}
