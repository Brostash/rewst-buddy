import RewstClient from "client/RewstClient";
import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";

export class DeleteTemplate extends GenericCommand {
  commandName = "DeleteTemplate";
  async execute(): Promise<unknown> {
    return true;
  }
}
