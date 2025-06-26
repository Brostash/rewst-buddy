/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import vscode from "vscode";
import { Template, Tree } from "./models";
import { log } from '@log';

export default class RewstFS implements vscode.FileSystemProvider {
  tree: Tree;
  public static readonly scheme = `rewstfs`;
  public static readonly schema = `${RewstFS.scheme}://`;


  public static uriOf(relPath: string) {
    return vscode.Uri.parse(`${RewstFS.schema}${relPath}`);
  }

  constructor() {
    this.tree = new Tree();
  }
  async readDirectory(
    uri: vscode.Uri
  ): Promise<[string, vscode.FileType][]> {
    log.info(`[SEARCH DEBUG] readDirectory called for URI: ${uri.toString()}`);
    const entry = await this.tree.lookupEntry(uri);
    const result: [string, vscode.FileType][] = [];

    const children = await entry.getChildren();
    log.info(`[SEARCH DEBUG] Found ${children.length} children in ${uri.toString()}`);

    for (const child of children) {
      result.push([child.labelWithExtension(), child.type]);
      log.info(`[SEARCH DEBUG] Child: ${child.labelWithExtension()} (type: ${child.type})`);
    }

    log.info(`[SEARCH DEBUG] Returning ${result.length} entries for ${uri.toString()}`);
    return result;
  }

  createDirectory(uri: vscode.Uri): void | Thenable<void> {
    // Virtual filesystem - directories are created automatically via tree structure
    // No need to implement actual directory creation
    return Promise.resolve();
  }

  //#region fs ops
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    log.info(`[SEARCH DEBUG] stat() called for URI: ${uri.toString()}`);
    const entry = await this.tree.lookupEntry(uri);
    log.info(`[SEARCH DEBUG] stat() found entry: ${entry.label} (type: ${entry.type}, initialized: ${entry.initialized})`);
    return entry;
  }


  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    log.info(`[SEARCH DEBUG] readFile() called for URI: ${uri.toString()}`);
    const entry = await this.tree.lookupEntry(uri);
    log.info(`[SEARCH DEBUG] readFile() found entry: ${entry.label} (type: ${entry.type}, initialized: ${entry.initialized})`);
    const data = await entry.readData();
    log.info(`[SEARCH DEBUG] readFile() returning ${data.length} characters for ${entry.label}`);
    return Buffer.from(data);
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { readonly create: boolean; readonly overwrite: boolean }
  ): Promise<void> {
    const entry = await this.tree.lookupEntry(uri);
    await entry.writeData(content.toString());
  }

  async delete(
    uri: vscode.Uri,
    options: { readonly recursive: boolean }
  ): Promise<void> {
    try {
      await this.tree.removeEntry(uri);
      this._fireSoon({ type: vscode.FileChangeType.Deleted, uri });
    } catch (error) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { readonly overwrite: boolean }
  ): void | Promise<void> {
    // For now, just throw FileSystemError instead of generic Error to avoid crashes
    throw vscode.FileSystemError.Unavailable("Rename operation not supported");
  }

  copy?(
    source: vscode.Uri,
    destination: vscode.Uri,
    options: { readonly overwrite: boolean }
  ): void | Promise<void> {
    // For now, just throw FileSystemError instead of generic Error to avoid crashes
    throw vscode.FileSystemError.Unavailable("Copy operation not supported");
  }

  async move(source: vscode.Uri, destination: vscode.Uri): Promise<void> {
    const srcEntity = await this.tree.lookupEntry(source);
    const destEntity = await this.tree.lookupEntry(destination);

    //maybe this validation should be moved somewhere else?
    // seems like this might grow quite large as things become more complex
    if (srcEntity.orgId !== destEntity.orgId) {
      vscode.window.showErrorMessage("Can't move across orgs");
      throw new Error("Can't move across orgs");
    }

    if (srcEntity instanceof Template) {
      if (destEntity.contextValueParams.hasTemplates) {
        const message = "Can't move template into not a template folder";
        vscode.window.showErrorMessage(message);
        throw new Error(message);
      }
    }

    srcEntity.setParent(destEntity);
  }

  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private _bufferedEvents: vscode.FileChangeEvent[] = [];
  private _fireSoonHandle?: NodeJS.Timeout;

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  watch(_resource: vscode.Uri): vscode.Disposable {
    log.info(`[SEARCH DEBUG] watch() called for URI: ${_resource.toString()}`);
    // ignore, fires for all changes...
    return new vscode.Disposable(() => { });
  }

  private _fireSoon(...events: vscode.FileChangeEvent[]): void {
    this._bufferedEvents.push(...events);

    if (this._fireSoonHandle) {
      clearTimeout(this._fireSoonHandle);
    }

    this._fireSoonHandle = setTimeout(() => {
      this._emitter.fire(this._bufferedEvents);
      this._bufferedEvents.length = 0;
    }, 5);
  }

  //#endregion
}
