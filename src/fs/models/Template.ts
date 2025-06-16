import { TreeItemCollapsibleState, FileType } from "vscode";
import { ContextValueParams, Entry, EntryInput, RType } from "./Entry.js";
import RewstClient from "../../rewst-client/RewstClient.js";
import * as vscode from "vscode";
import { TemplateFolder } from "./TemplateFolder.js";

export class Template extends Entry {
  rtype: RType = RType.Template;

  contextValueParams: ContextValueParams = {
    hasTemplates: false,
    hasTemplateFolders: false,
    isRenamable: false,
    isTemplateFolder: false,
    isTemplate: true,
  };
  type: FileType = FileType.File;
  data?: Uint8Array;
  ext = "ps1";

  getCommand(): vscode.Command {
    return {
      title: "Open File",
      command: "vscode.open",
      arguments: [this.getUri()],
    };
  }

  async readData(): Promise<string> {
    console.log(` loading template ${this.id}`);
    const response = await this.client.sdk.getTemplateBody({ id: this.id });
    if (typeof response.template?.body !== "string") {
      throw new Error(`Couldn't load template ${this.id}`);
    }
    console.log(`Done loading template ${this.id}`);
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
      console.log(message);
      return false;
    }
    return true;
  }

  serialize(): string {
    throw new Error("Method not implemented.");
  }
  deserialize<T extends Entry>(): T {
    throw new Error("Method not implemented.");
  }
  initialize(): Promise<void> {
    this.initialized = true;

    if (this.client === undefined) {
      throw new Error("Client should always exist on templates");
    }

    return Promise.resolve();
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
