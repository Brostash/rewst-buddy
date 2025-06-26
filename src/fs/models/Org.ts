import { Template } from "./Template";
import { Entry, ContextValueParams, RType, EntryInput } from "./Entry";
import { TemplateFolder, SerializableTemplateFolder } from "./TemplateFolder";
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
  type = vscode.FileType.Directory;

  constructor(input: EntryInput) {
    log.info(`Creating Org: ${input.label} (orgId: ${input.client?.orgId})`);
    super(input, {
      hasTemplates: false,
      hasTemplateFolders: false,
      isRenamable: false,
      isTemplateFolder: false,
      isTemplate: false,
      isOrg: true,
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
  async serialize(): Promise<string> {
    log.info(`Serializing Org: ${this.label} (${this.orgId})`);
    try {
      // Get all folders in the org tree using the instance method
      const folderMap = await this.getAllEntriesOfType(RType.TemplateFolder, TemplateFolder);
      log.info(`Found ${folderMap.size} template folders to serialize for org ${this.orgId}`);

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

      const result = JSON.stringify(serializable);
      log.info(`Successfully serialized Org: ${this.label} with ${folderStructure.length} folders`);
      return result;
    } catch (error) {
      log.error(`Failed to serialize Org ${this.label} (${this.orgId}): ${error}`);
      throw error;
    }
  }
  setLabel(label: string): void {
    throw new Error("Method not implemented.");
  }
  async initialize(): Promise<void> {
    if (this.initialized) {
      log.info(`Org ${this.orgId} already initialized`);
      return;
    }

    log.info(`Initializing Org: ${this.orgId}`);
    try {
      //something something create template folder and have it protected.

      try {
        // Load organization data from API
        log.info(`Fetching organization info for ${this.orgId}`);
        const response = await this.client.sdk.UserOrganization();
        if (response.userOrganization === undefined) {
          log.error(`Failed to get org info for ${this.orgId}: API returned undefined`);
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
        log.info(`Successfully initialized Org: "${this.label}" (${this.orgId})`);
        this.initialized = true;
      } catch (error) {
        log.error(`Failed to initialize org '${this.id}': ${error}`, false, true);
        throw error;
      }
    } catch (error) {
      log.error(`Failed to initialize Org ${this.orgId}: ${error}`);
      throw error;
    }
  }



  getUri(): vscode.Uri {
    this.resourceUri = RewstFS.uriOf(`${this.label}`);
    return this.resourceUri;
  }

  static async create(cmdContext: CommandContext, ...args: any): Promise<Org> {
    log.info(`Creating new Org via static create method`);

    let client: RewstClient;
    try {
      if (args[0] instanceof RewstClient) {
        client = args[0];
      } else {
        client = await RewstClient.create(cmdContext.context);
        log.info(`Created RewstClient for org: ${client.orgId}`);
      }

      const orgInput: EntryInput = {
        client: client,
        id: client.orgId,
        label: client.label,
      };

      const org = new Org(orgInput);
      log.info(`Successfully created Org: "${client.label}" (${client.orgId})`);
      return org;
    } catch (error) {
      log.error(`Failed to create Org: ${error}`);
      throw error;
    }
  }
}

