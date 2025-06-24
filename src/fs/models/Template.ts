import { FileType } from "vscode";
import { ContextValueParams, Entry, EntryInput, RType } from "./Entry";
import vscode from "vscode";
import { TemplateFolder } from "./TemplateFolder";
import { log } from '@log';

export class Template extends Entry {
  rtype: RType = RType.Template;
  collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None;

  type: FileType = FileType.File;
  data?: Uint8Array;
  ext = "ps1";

  constructor(input: EntryInput) {
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
    const payload = {
      id: this.id,
      body: data,
    };
    const response = await this.client.sdk.UpdateTemplateBody(payload);
    //some kinda validation
    return true;
  }

  async setLabel(label: string): Promise<boolean> {
    this.label = label;

    const payload = {
      id: this.id,
      name: label,
    };

    const response = await this.client.sdk.UpdateTemplateName(payload);
    if (response.updateTemplate?.name !== label) {
      const message = `failed to update template with new name ${label}`;
      vscode.window.showErrorMessage(message);
      log.info(message);
      return false;
    }
    return true;
  }

  serialize(): Promise<string> {
    throw new Error("Method not implemented.");
  }
  deserialize<T>(): T {
    throw new Error("Method not implemented.");
  }
  initialize(): Promise<void> {
    this.initialized = true;

    if (this.client === undefined) {
      throw new Error("Client should always exist on templates");
    }

    return Promise.resolve();
  }

  static async create(...args: any): Promise<Template> {
    const folder: TemplateFolder = args[0];
    const label: string = args[1];

    const input = {
      name: label,
      orgId: folder.orgId,
    };
    const response = await folder.client.sdk.createTemplateMinimal(input);

    if (!response.template) {
      const message = `Failed to generate template`;
      throw new Error("message");
    }

    const template = response.template;

    const templateInput: EntryInput = {
      client: folder.client,
      id: template.id,
      label: template.name,
      parent: folder,
    };

    return new Template(templateInput);
  }
}

export async function createTemplate(
  folder: TemplateFolder,
  label: string
): Promise<Template> {
  const input = {
    name: label,
    orgId: folder.orgId,
  };
  const response = await folder.client.sdk.createTemplateMinimal(input);

  if (!response.template) {
    const message = `Failed to generate template`;
    throw new Error("message");
  }

  const template = response.template;

  const templateInput: EntryInput = {
    client: folder.client,
    id: template.id,
    label: template.name,
    parent: folder,
  };

  return new Template(templateInput);
}
