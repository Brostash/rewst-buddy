import { Template } from "./Template";
import { Entry, ContextValueParams, RType, EntryInput } from "./Entry";
import Storage from "storage/Storage";
import vscode from "vscode";
import RewstFS from "@fs/RewstFS";
import { log } from "@log";
import { RewstClient } from "@client/index";
import { CommandContext } from "@commands/models/GenericCommand";

export interface AlmostOrgInput {
  label: string;
  orgId: string;
}

export class AlmostOrg extends vscode.TreeItem {
  contextValue = "almost-org";
  collapsibleState = vscode.TreeItemCollapsibleState.None;
  orgId: string;
  command: vscode.Command;

  constructor(input: AlmostOrgInput) {
    super(input.label);
    this.orgId = input.orgId;
    this.command = {
      title: "Load Org",
      command: "rewst-buddy.NewClient",
      arguments: [this.orgId],
    };
  }
}

export class Org extends Entry {
  constructor(input: EntryInput) {
    super(input, {
      hasTemplates: false,
      hasTemplateFolders: false,
      isRenamable: false,
      isTemplateFolder: false,
      isTemplate: false,
    });
  }

  rtype = RType.Org;
  getCommand(): vscode.Command {
    throw new Error("Method not implemented.");
  }
  readData(): Promise<string> {
    throw new Error("Method not implemented.");
  }
  writeData(data: string): Promise<boolean> {
    throw new Error("Method not implemented.");
  }
  serialize(): Promise<string> {
    throw new Error("Method not implemented.");
  }
  setLabel(label: string): void {
    throw new Error("Method not implemented.");
  }
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    //something something create template folder and have it protected.

    const response = await this.client.sdk.UserOrganization();
    if (response.userOrganization === undefined) {
      throw new Error("could not get org info");
    }
    const org = response.userOrganization;
    this.label = org?.name ?? "";

    this.initialized = true;
  }



  getUri(): vscode.Uri {
    return RewstFS.uriOf(`/${this.orgId}`);
  }

  static async create(cmdContext: CommandContext, ...args: any): Promise<Org> {
    const client = await RewstClient.create(cmdContext.context);

    const orgInput: EntryInput = {
      client: client,
      id: client.orgId,
      label: client.label,
    };

    return new Org(orgInput);
  }
}

