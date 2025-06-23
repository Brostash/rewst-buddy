import { Template } from "./Template";
import { Entry, ContextValueParams, RType, EntryInput } from "./Entry";
import { TemplateFolder, SerializableTemplateFolder } from "./TemplateFolder";
import Storage from "storage/Storage";
import vscode from "vscode";
import RewstFS from "@fs/RewstFS";
import { log } from "@log";
import { RewstClient } from "@client/index";
import { CommandContext } from "@commands/models/GenericCommand";

export interface SerializableOrg {
  orgId: string;
  orgLabel: string;
  lastSync: number;
  folderStructure: SerializableTemplateFolder[];
}

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
  async serialize(): Promise<string> {
    // Get all folders in the org tree using the instance method
    const folderMap = await this.getAllEntriesOfType(RType.TemplateFolder, TemplateFolder);
    
    // Serialize each folder
    const folderStructure: SerializableTemplateFolder[] = [];
    for (const folder of folderMap.values()) {
      const serializedFolder = await folder.serialize();
      folderStructure.push(JSON.parse(serializedFolder));
    }

    const serializable: SerializableOrg = {
      orgId: this.orgId,
      orgLabel: this.label,
      lastSync: Date.now(),
      folderStructure
    };

    return JSON.stringify(serializable);
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

