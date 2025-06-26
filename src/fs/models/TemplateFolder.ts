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

export interface TemplatePlacement {
  templateId: string;
  folderId: string;
  templateName: string;
}

export interface StoredOrgStructure {
  templateFolderStructure?: {
    folders: SerializableTemplateFolder[];
    templatePlacements: TemplatePlacement[];
    lastUpdated: string;
  };
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
            if (orgData.templateFolderStructure?.folders && Array.isArray(orgData.templateFolderStructure.folders)) {
              log.info(`Found stored folder structure with ${orgData.templateFolderStructure.folders.length} folders for org ${this.parent.id}`);

              // Find the root folder in stored data (one with parentId matching org or null)
              const rootFolder = orgData.templateFolderStructure.folders.find((f: any) =>
                !f.parentId || f.parentId === this.parent?.id
              );

              if (rootFolder) {
                log.info(`Resetting root folder ID from ${this.id} to stored ID ${rootFolder.id}`);
                const oldId = this.id;
                this.id = rootFolder.id;


                // Update parent's children reference if needed
                if (this.parent) {
                  const childIndex = this.parent.children.findIndex(child => child === this);
                  if (childIndex !== -1) {
                    log.info(`Updated parent's child reference for ID change from ${oldId} to ${this.id}`);
                  }
                }
              }

              // Create missing folders recursively using the correct root ID
              await this.createFoldersFromStoredStructure(orgData.templateFolderStructure.folders, this.id);
            } else {
              log.info(`No valid folder structure found in stored data for org ${this.parent.id}`);
            }
          } else {
            log.info(`No stored data found for org ${this.parent.id}`);
          }
        } catch (error) {
          log.error(`Failed to load stored folder structure: ${error}`);
          log.info(`Falling back to API-only initialization for org ${this.parent.id}`);
        }

        // Load templates from API, but only create ones that belong in this folder
        log.info(`Loading templates for org ${this.orgId}`);
        const response = await this.client.sdk.listTemplatesMinimal({
          orgId: this.orgId,
        });
        const allTemplates = response.templates;
        log.info(`Found ${allTemplates.length} total templates for org ${this.orgId}`);

        // Get stored template placements to determine which templates belong here
        const storedData = storage.getRewstOrgData(this.parent.id);
        let templatePlacements: TemplatePlacement[] = [];

        if (storedData && storedData !== '{}') {
          try {
            const orgData: StoredOrgStructure = JSON.parse(storedData);
            templatePlacements = orgData.templateFolderStructure?.templatePlacements || [];
            log.info(`Found ${templatePlacements.length} stored template placements`);
          } catch (error) {
            log.error(`Failed to parse template placements: ${error}`);
          }
        }

        // Filter templates: only create ones that belong in this folder OR ones not placed anywhere (for root)
        const templatesForThisFolder = allTemplates.filter((template: { id: string; name: string }) => {
          const placement = templatePlacements.find(p => p.templateId === template.id);

          if (placement) {
            // Template has a stored placement - only create if it belongs in this folder
            return placement.folderId === this.id;
          } else {
            // Template has no stored placement - only create in root folder
            return this.parent?.rtype === RType.Org;
          }
        });

        log.info(`Creating ${templatesForThisFolder.length} templates in folder "${this.label}" (${this.id})`);

        templatesForThisFolder.forEach((template: { id: string; name: string }) => {
          const input: EntryInput = {
            client: this.client,
            ext: "ps1",
            id: template.id,
            label: template.name,
            parent: this,
          };
          new Template(input);
        });
      } else {
        // Non-root folder initialization - create templates assigned to this folder
        log.info(`Initializing subfolder: ${this.label} (${this.id})`);

        // Get stored template placements to determine which templates belong here
        const orgId = this.orgId;
        const storedData = storage.getRewstOrgData(orgId);
        let templatePlacements: TemplatePlacement[] = [];

        if (storedData && storedData !== '{}') {
          try {
            const orgData: StoredOrgStructure = JSON.parse(storedData);
            templatePlacements = orgData.templateFolderStructure?.templatePlacements || [];
          } catch (error) {
            log.error(`Failed to parse template placements for subfolder: ${error}`);
          }
        }

        // Find templates assigned to this folder
        const templatesForThisFolder = templatePlacements.filter(p => p.folderId === this.id);

        if (templatesForThisFolder.length > 0) {
          log.info(`Creating ${templatesForThisFolder.length} templates in subfolder "${this.label}" (${this.id})`);

          // Load template details from API for the assigned templates
          const response = await this.client.sdk.listTemplatesMinimal({
            orgId: this.orgId,
          });
          const allTemplates = response.templates;

          templatesForThisFolder.forEach(placement => {
            const apiTemplate = allTemplates.find(t => t.id === placement.templateId);
            if (apiTemplate) {
              const input: EntryInput = {
                client: this.client,
                ext: "ps1",
                id: apiTemplate.id,
                label: apiTemplate.name,
                parent: this,
              };
              new Template(input);
            } else {
              log.error(`Template ${placement.templateId} not found in API response for folder ${this.label}`);
            }
          });
        } else {
          log.info(`No templates assigned to subfolder "${this.label}" (${this.id})`);
        }
      }

      this.initialized = true;
      log.info(`Successfully initialized TemplateFolder: ${this.label} (${this.id})`);
    } catch (error) {
      log.error(`Failed to initialize TemplateFolder ${this.label} (${this.id}): ${error}`);
      throw error;
    }
  }
  /**
   * Creates missing folders from stored structure recursively
   */
  private async createFoldersFromStoredStructure(
    storedFolders: SerializableTemplateFolder[],
    parentId: string
  ): Promise<void> {
    const childFolders = storedFolders.filter(f => f.parentId === parentId);

    for (const folderData of childFolders) {
      let existingFolder = this.children.find(
        child => child instanceof TemplateFolder && child.id === folderData.id
      ) as TemplateFolder;

      if (!existingFolder) {
        log.info(`Creating missing child folder: ${folderData.label} (${folderData.id})`);
        const folderInput: EntryInput = {
          client: this.client,
          id: folderData.id,
          label: folderData.label,
          parent: this,
        };
        existingFolder = new TemplateFolder(folderInput);
      } else {
        log.info(`Found existing folder: ${folderData.label} (${folderData.id})`);
      }

      // Recursively create children of this folder
      await existingFolder.createFoldersFromStoredStructure(storedFolders, folderData.id);
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
