import path from "path";
import vscode from "vscode";
import RewstFS from "../RewstFS";
import { uuidv7 } from "uuidv7";
import { isDirective } from "graphql";
import { RewstClient } from "@client/index";
import { log } from "@log";
import { CommandContext } from "@commands/models/GenericCommand";

export enum RType {
  Root,
  Org,
  Template,
  TemplateFolder,
}

export interface ContextValueParams {
  isTemplate: boolean;
  hasTemplates: boolean;
  hasTemplateFolders: boolean;
  isRenamable: boolean;
  isTemplateFolder: boolean;
}

export interface EntryInput {
  id?: string;
  label?: string | vscode.TreeItemLabel;
  client: RewstClient;
  ext?: string;
  parent?: Entry;
}

interface IEntry extends EntryInput, vscode.TreeItem, vscode.FileStat {
  rtype: RType;
  orgId: string;

  initialized: boolean;
  initialize(...args: any): Promise<void>;

  getUri(): vscode.Uri;

  getChildren(): Promise<Entry[]>;

  getLabel(): string;
  setLabel(label: string): Promise<boolean> | void;
  isValidLabel(label: string): boolean;

  contextValueParams: ContextValueParams;
  getContextValue(params: ContextValueParams): string;

  addChild(child: Entry): void;
  removeChild(child: Entry): boolean;
  setParent(newParent: Entry): void;

  serialize(): Promise<string>;

  getCommand(): vscode.Command | Promise<vscode.Command>;
  getTreeItem(): Promise<vscode.TreeItem>;

  readData(): string | Promise<string>;
  writeData(data: string): boolean | Promise<boolean>;
}

export abstract class Entry implements IEntry {
  contextValueParams: ContextValueParams;
  abstract rtype: RType;

  initialized = false;

  ctime: number;
  mtime: number;
  size: number;
  permissions?: vscode.FilePermission | undefined;
  type: vscode.FileType = vscode.FileType.Unknown;
  id: string;

  parent?: Entry;
  children: Entry[] = [];

  orgId: string;
  client: RewstClient;
  ext?: string;
  label: string;
  contextValue: string;
  iconPath?: string | vscode.IconPath | undefined;
  description?: string | boolean | undefined;
  resourceUri?: vscode.Uri | undefined;
  tooltip?: string | vscode.MarkdownString | undefined;
  command?: vscode.Command | undefined;
  collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
  accessibilityInformation?: vscode.AccessibilityInformation | undefined;
  checkboxState?:
    | vscode.TreeItemCheckboxState
    | {
        readonly state: vscode.TreeItemCheckboxState;
        readonly tooltip?: string;
        readonly accessibilityInformation?: vscode.AccessibilityInformation;
      }
    | undefined;

  constructor(input: EntryInput, contextValueParams: ContextValueParams) {
    if (typeof input?.label !== "string") {
      throw new Error("");
    }

    this.label = input.label;
    this.client = input.client;
    this.orgId = this.client?.orgId ?? "";
    this.ext = input.ext;
    this.ctime = Date.now();
    this.mtime = Date.now();
    this.size = 0;

    this.id = input.id ?? uuidv7();

    if (input.parent) {
      this.setParent(input.parent);
    }

    this.contextValueParams = contextValueParams ?? {
      isTemplate: false,
      hasTemplates: false,
      hasTemplateFolders: false,
      isRenamable: false,
      isTemplateFolder: false,
    };

    this.contextValue = this.getContextValue();
  }

  async getTreeItem(): Promise<vscode.TreeItem> {
    const item: vscode.TreeItem = {
      ...this,
      resourceUri: this.getUri(),
      command: this.getCommand(),
    };
    return item;
  }

  abstract initialize(): Promise<void>;

  abstract getCommand(): vscode.Command;

  abstract serialize(): Promise<string>;

  abstract setLabel(label: string): void | Promise<boolean>;

  abstract readData(): Promise<string>;
  abstract writeData(data: string): Promise<boolean>;

  async getChildren(): Promise<Entry[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return [...this.children];
  }

  getUri(): vscode.Uri {
    if (this.parent === undefined) {
      return RewstFS.uriOf("/");
    }

    const parentUri = this.parent.getUri();
    const newPath = path.posix.join(
      "/",
      parentUri.path,
      this.ext ? `${this.id}.${this.ext}` : this.id
    );
    return parentUri.with({ path: newPath });
  }

  getLabel(): string {
    return this.label;
  }

  addChild(child: Entry): void {
    this.children = this.children.filter((c) => c.id !== child.id);
    this.children.push(child);
    child.parent = this;
  }

  // Remove a child node and clear its parent reference
  removeChild(child: Entry): boolean {
    const index = this.children.indexOf(child);
    if (index === -1) {
      return false;
    }
    this.children.splice(index, 1);
    return true;
  }

  // Optional: Move a node to a new parent
  setParent(newParent: Entry): void {
    if (this.parent) {
      this.parent.removeChild(this);
    }
    newParent.addChild(this);
  }

  isValidLabel(label: string): boolean {
    return /^[a-zA-Z0-9[\]\- ]*$/.test(label);
  }

  getContextValue(
    params: ContextValueParams = this.contextValueParams
  ): string {
    const classes = [
      params.hasTemplateFolders ? "has-templatefolders" : "",
      params.hasTemplates ? "has-templates" : "",
      params.isTemplateFolder ? "is-TemplateFolder" : "",
      params.isRenamable ? "renamable" : "",
      params.isTemplate ? "is-template" : "",
    ].filter(Boolean);

    return classes.join(" ");
  }

  async getAllEntriesOfType<T extends Entry>(
    rtype: RType,
    TypeClass: new (...args: any[]) => T
  ): Promise<Map<string, T>> {
    const results = new Map<string, T>();

    const queue: Entry[] = await this.getChildren();

    while (queue.length) {
      const top = queue.shift();
      if (top === undefined) {
        continue;
      } else if (top.rtype === rtype && top instanceof TypeClass) {
        results.set(top.id, top);
      }
      queue.push(...top.children);
    }

    return results;
  }

  static async create(
    cmdContext: CommandContext,
    ...args: any
  ): Promise<Entry> {
    log.error("Can't create abstract Entry", false, true);
    throw new Error("");
  }
}
