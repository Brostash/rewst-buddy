import { ContextValueParams, Entry, EntryInput, RType } from "./Entry";
import * as vscode from "vscode";
import { Template } from "./Template";

export async function getTemplateMap(
  folder: TemplateFolder
): Promise<Map<string, Template>> {
  const templates = new Map<string, Template>();

  const queue: Entry[] = await folder.getChildren();

  while (queue.length) {
    const top = queue.shift();
    if (top === undefined) {
      continue;
    } else if (top.rtype === RType.Template && top instanceof Template) {
      templates.set(top.id, top);
    } else {
      queue.push(...top.children);
    }
  }

  return templates;
}

export class TemplateFolder extends Entry {
  getCommand(): vscode.Command {
    return {
      title: "",
      command: "",
    };
  }
  rtype: RType = RType.TemplateFolder;
  contextValueParams: ContextValueParams = {
    hasTemplates: true,
    hasTemplateFolders: true,
    isRenamable: true,
    isTemplateFolder: true,
    isTemplate: false,
  };
  async serialize(): Promise<string> {
    throw new Error("Method not implemented.");
  }
  deserialize<T extends Entry>(): T {
    throw new Error("Method not implemented.");
  }
  setLabel(label: string): void {
    this.label = label;
  }
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.parent?.rtype === RType.Org) {
      //top level template folder not renamable
      this.contextValueParams.isRenamable = false;
      this.contextValue = this.getContextValue();

      //load in all the templates
      const response = await this.client.sdk.listTemplatesMinimal({
        orgId: this.id,
      });
      const templates = response.templates;

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
  }
  readData(): Promise<string> {
    throw new Error("Method not implemented.");
  }
  writeData(data: string): Promise<boolean> {
    throw new Error("Method not implemented.");
  }

  async getChildren(): Promise<Entry[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    const children = [...this.children];
    return children.sort((a: Entry, b: Entry) => {
      let score = a.label.localeCompare(b.label);
      score -= a instanceof TemplateFolder ? 100 : 0;
      score += b instanceof TemplateFolder ? 100 : 0;
      return score;
    });
  }
}

export async function createTemplateFolder(
  folder: Entry,
  label: string
): Promise<TemplateFolder> {
  const folderInput: EntryInput = {
    client: folder.client,
    label: label,
    parent: folder,
  };

  return new TemplateFolder(folderInput);
}
