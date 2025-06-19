import GenericCommand from "../models/GenericCommand";
import { Org } from "@fs/models";
import vscode from 'vscode';

export class NewClient extends GenericCommand {
  commandName = "NewClient";

  async execute(...args: unknown[]) {

    const org = await Org.create(this.cmdContext);
    this.cmdContext.fs.tree.newOrg(org);
    vscode.commands.executeCommand("rewst-buddy.RefreshView");
  }
}
