import { Template } from "./Template";
import { Entry, ContextValueParams, RType, EntryInput } from "./Entry";
import { TemplateFolder } from "./TemplateFolder";
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
  getCommand(): undefined {

    return undefined;
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

    try {
      // Load organization data from API
      const response = await this.client.sdk.UserOrganization();
      if (response.userOrganization === undefined) {
        throw new Error("could not get org info");
      }
      const org = response.userOrganization;
      this.label = org?.name ?? "";

      // Create the designated root template folder for this organization
      // This is the centralized repository for all templates and subdirectories
      const templateFolderInput: EntryInput = {
        client: this.client,
        // No id provided - will auto-generate UUIDv7 for unique identification
        // TODO: Handle ID persistence from storage/cache for tree reconstruction
        label: "Templates", // Standard name for the root template folder
        parent: this,
      };

      const rootTemplateFolder = new TemplateFolder(templateFolderInput);

      // The template folder will be added as a child via the parent constructor
      // No need to manually call addChild as it's handled in the EntryInput.parent logic

      log.info(`Initialized org '${this.label}' with root template folder (ID: ${rootTemplateFolder.id})`);
      this.initialized = true;
    } catch (error) {
      log.error(`Failed to initialize org '${this.id}': ${error}`, false, true);
      throw error;
    }
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

