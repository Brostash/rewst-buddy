import { ContextValueParams, Entry, EntryInput, RType } from "./Entry";
import vscode from "vscode";
import { Template } from "./Template";
import { storage } from "storage/Storage";
import { log } from "@log";

export interface SerializableTemplateFolder {
  id: string;
  label: string;
  parentId?: string;
  childFolderIds: string[];
  templateIds: string[];
}

export class TemplateFolder extends Entry {
  type = vscode.FileType.Directory;

  getCommand(): undefined {
    return undefined;
  }
  rtype: RType = RType.TemplateFolder;

  constructor(input: EntryInput) {
    log.info(`Creating TemplateFolder: ${input.label} (id: ${input.id})`);
    super(input, {
      hasTemplates: true,
      hasTemplateFolders: true,
      isRenamable: true,
      isTemplateFolder: true,
      isTemplate: false,
    });
  }

  async serialize(): Promise<string> {
    log.info(`Serializing TemplateFolder: ${this.label} (id: ${this.id})`);
    try {
      const childFolderIds = this.children
        .filter((child) => child instanceof TemplateFolder)
        .map((child) => child.id);

      const templateIds = this.children
        .filter((child) => child instanceof Template)
        .map((child) => child.id);

      const serializable: SerializableTemplateFolder = {
        id: this.id,
        label: this.label,
        parentId: this.parent?.id,
        childFolderIds,
        templateIds,
      };

      const result = JSON.stringify(serializable);
      log.info(`Successfully serialized TemplateFolder: ${this.label}`);
      return result;
    } catch (error) {
      log.error(`Failed to serialize TemplateFolder ${this.label}: ${error}`);
      throw error;
    }
  }
  setLabel(label: string): void {
    log.info(`Setting label for TemplateFolder ${this.id}: "${this.label}" -> "${label}"`);
    this.label = label;
  }
  async initialize(): Promise<void> {
    if (this.initialized) {
      log.info(`TemplateFolder ${this.label} (${this.id}) already initialized`);
      return;
    }

    log.info(`Initializing TemplateFolder: ${this.label} (${this.id})`);
    try {
      if (this.parent?.rtype === RType.Org) {
        log.info(`Top-level TemplateFolder detected for org ${this.parent.id}`);

        // Fetch stored folder structure from global storage
        try {
          const storedData = storage.getRewstOrgData(this.parent.id);
          if (storedData && storedData !== '{}') {
            const orgData = JSON.parse(storedData);
            if (orgData.folderStructure && Array.isArray(orgData.folderStructure)) {
              log.info(`Found stored folder structure with ${orgData.folderStructure.length} folders for org ${this.parent.id}`);

              // Process stored folder structure to create missing child folders
              for (const folderData of orgData.folderStructure) {
                if (folderData.parentId === this.id) {
                  // This folder should be a child of the current template folder
                  let childFolder = this.children.find(child => child instanceof TemplateFolder && child.id === folderData.id) as TemplateFolder;

                  if (!childFolder) {
                    log.info(`Creating missing child folder: ${folderData.label} (${folderData.id})`);
                    const folderInput: EntryInput = {
                      client: this.client,
                      id: folderData.id,
                      label: folderData.label,
                      parent: this,
                    };
                    childFolder = new TemplateFolder(folderInput);
                  }
                }
              }
            }
          }
        } catch (error) {
          log.error(`Failed to load stored folder structure: ${error}`);
        }

        // Top level template folder not renamable
        this.contextValueParams.isRenamable = false;
        this.contextValue = this.getContextValue();

        // Load in all the templates from API
        log.info(`Loading templates for org ${this.orgId}`);
        const response = await this.client.sdk.listTemplatesMinimal({
          orgId: this.orgId,
        });
        const templates = response.templates;
        log.info(`Found ${templates.length} templates for org ${this.orgId}`);

        templates.forEach((template: { id: string; name: string }) => {
          const input: EntryInput = {
            client: this.client,
            ext: "ps1",
            id: template.id,
            label: template.name,
            parent: this,
          };
          new Template(input);
        });
      }

      this.initialized = true;
      log.info(`Successfully initialized TemplateFolder: ${this.label} (${this.id})`);
    } catch (error) {
      log.error(`Failed to initialize TemplateFolder ${this.label} (${this.id}): ${error}`);
      throw error;
    }
  }
  readData(): Promise<string> {
    throw new Error("Method not implemented.");
  }
  writeData(data: string): Promise<boolean> {
    throw new Error("Method not implemented.");
  }

  async getChildren(): Promise<Entry[]> {
    log.info(`Getting children for TemplateFolder: ${this.label} (${this.id})`);
    if (!this.initialized) {
      await this.initialize();
    }

    const children = [...this.children];
    const sortedChildren = children.sort((a: Entry, b: Entry) => {
      let score = a.label.localeCompare(b.label);
      score -= a instanceof TemplateFolder ? 100 : 0;
      score += b instanceof TemplateFolder ? 100 : 0;
      return score;
    });

    log.info(`Returning ${sortedChildren.length} children for TemplateFolder: ${this.label}`);
    return sortedChildren;
  }
}

export async function createTemplateFolder(
  folder: Entry,
  label: string
): Promise<TemplateFolder> {
  log.info(`Creating new TemplateFolder "${label}" under parent: ${folder.label} (${folder.id})`);
  try {
    const folderInput: EntryInput = {
      client: folder.client,
      label: label,
      parent: folder,
    };

    const newFolder = new TemplateFolder(folderInput);
    log.info(`Successfully created TemplateFolder: ${label}`);
    return newFolder;
  } catch (error) {
    log.error(`Failed to create TemplateFolder "${label}": ${error}`);
    throw error;
  }
}
