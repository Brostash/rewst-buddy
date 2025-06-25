import { FileType } from "vscode";
import { ContextValueParams, Entry, EntryInput, RType } from "./Entry";
import vscode from "vscode";
import { TemplateFolder } from "./TemplateFolder";
import { log } from "@log";

export class Template extends Entry {
  rtype: RType = RType.Template;

  type: FileType = FileType.File;
  data?: Uint8Array;
  ext = "ps1";

  constructor(input: EntryInput) {
    log.info(`Creating Template: ${input.label} (id: ${input.id})`);
    super(input, {
      hasTemplates: false,
      hasTemplateFolders: false,
      isRenamable: true,
      isTemplateFolder: false,
      isTemplate: true,
    });
  }

  getCommand(): vscode.Command {
    return {
      title: "Open File",
      command: "vscode.open",
      arguments: [this.getUri()],
    };
  }

  async readData(): Promise<string> {
    log.info(` loading template ${this.id}`);
    const response = await this.client.sdk.getTemplateBody({ id: this.id });
    if (typeof response.template?.body !== "string") {
      throw new Error(`Couldn't load template ${this.id}`);
    }
    log.info(`Done loading template ${this.id}`);
    return response.template.body;
  }

  async writeData(data: string): Promise<boolean> {
    log.info(`Writing data to Template: ${this.label} (${this.id}), size: ${data.length} chars`);
    try {
      const payload = {
        id: this.id,
        body: data,
      };
      const response = await this.client.sdk.UpdateTemplateBody(payload);
      //some kinda validation
      log.info(`Successfully wrote data to Template: ${this.label}`);
      return true;
    } catch (error) {
      log.error(`Failed to write data to Template ${this.label} (${this.id}): ${error}`);
      throw error;
    }
  }

  async setLabel(label: string): Promise<boolean> {
    log.info(`Setting label for Template ${this.id}: "${this.label}" -> "${label}"`);
    try {
      this.label = label;

      const payload = {
        id: this.id,
        name: label,
      };

      const response = await this.client.sdk.UpdateTemplateName(payload);
      if (response.updateTemplate?.name !== label) {
        const message = `failed to update template with new name ${label}`;
        vscode.window.showErrorMessage(message);
        log.error(message);
        return false;
      }
      log.info(`Successfully updated Template label to: ${label}`);
      return true;
    } catch (error) {
      log.error(`Failed to set label for Template ${this.id}: ${error}`);
      return false;
    }
  }

  async serialize(): Promise<string> {
    return "";
  }

  initialize(): Promise<void> {
    log.info(`Initializing Template: ${this.label} (${this.id})`);
    
    if (this.client === undefined) {
      log.error(`Template ${this.id} has no client - this should never happen`);
      throw new Error("Client should always exist on templates");
    }

    this.initialized = true;
    log.info(`Successfully initialized Template: ${this.label}`);
    return Promise.resolve();
  }

  static async create(...args: any): Promise<Template> {
    const folder: TemplateFolder = args[0];
    const label: string = args[1];
    
    log.info(`Creating new Template "${label}" in folder "${folder.label}" (${folder.orgId})`);
    try {
      const input = {
        name: label,
        orgId: folder.orgId,
      };
      const response = await folder.client.sdk.createTemplateMinimal(input);

      if (!response.template) {
        const message = `Failed to generate template`;
        log.error(message);
        throw new Error("message");
      }

      const template = response.template;
      log.info(`Created template via API: ${template.name} (${template.id})`);

      const templateInput: EntryInput = {
        client: folder.client,
        id: template.id,
        label: template.name,
        parent: folder,
      };

      const newTemplate = new Template(templateInput);
      log.info(`Successfully created Template: ${template.name}`);
      return newTemplate;
    } catch (error) {
      log.error(`Failed to create Template "${label}": ${error}`);
      throw error;
    }
  }
}

export async function createTemplate(
  folder: TemplateFolder,
  label: string
): Promise<Template> {
  log.info(`Creating Template "${label}" in folder "${folder.label}" (${folder.orgId})`);
  try {
    const input = {
      name: label,
      orgId: folder.orgId,
    };
    const response = await folder.client.sdk.createTemplateMinimal(input);

    if (!response.template) {
      const message = `Failed to generate template`;
      log.error(message);
      throw new Error("message");
    }

    const template = response.template;
    log.info(`Template created via API: ${template.name} (${template.id})`);

    const templateInput: EntryInput = {
      client: folder.client,
      id: template.id,
      label: template.name,
      parent: folder,
    };

    const newTemplate = new Template(templateInput);
    log.info(`Successfully created Template: ${template.name}`);
    return newTemplate;
  } catch (error) {
    log.error(`Failed to create Template "${label}": ${error}`);
    throw error;
  }
}
