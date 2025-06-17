import { Template } from "./Template";
import { Entry, ContextValueParams, RType } from "./Entry";
import Storage from "storage/Storage";
import * as vscode from "vscode";
import RewstFS from "@fs/RewstFS";

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
  getCommand(): vscode.Command {
    throw new Error("Method not implemented.");
  }
  readData(): Promise<string> {
    throw new Error("Method not implemented.");
  }
  writeData(data: string): Promise<boolean> {
    throw new Error("Method not implemented.");
  }
  serialize(): string {
    throw new Error("Method not implemented.");
  }
  deserialize<T extends Entry>(): T {
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

  contextValueParams: ContextValueParams = {
    hasTemplates: false,
    hasTemplateFolders: false,
    isRenamable: false,
    isTemplateFolder: true,
    isTemplate: false,
  };
  rtype = RType.Org;

  getUri(): vscode.Uri {
    return RewstFS.uriOf(`/${this.orgId}`);
  }
}

export async function createOrg(orgId: string): Promise<Org> {
  throw new Error("Not implemented yet");
}
