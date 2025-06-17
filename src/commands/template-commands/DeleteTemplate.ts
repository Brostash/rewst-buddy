import RewstClient from "client/RewstClient";
import GenericCommand from "../models/GenericCommand";
import * as vscode from "vscode";

export class DeleteTemplate extends GenericCommand {
  commandName: string = "DeleteTemplate";
  async execute(): Promise<unknown> {
    return true;
  }
}
