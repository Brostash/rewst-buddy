import RewstClient from "rewst-client/RewstClient.js";
import GenericCommand from "../models/GenericCommand.js";
import * as vscode from "vscode";

export class DeleteTemplate extends GenericCommand {
  commandName: string = "DeleteTemplate";
  async execute(): Promise<unknown> {
    return true;
  }
}
