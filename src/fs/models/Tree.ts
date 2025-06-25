import vscode from "vscode";
import { Entry, EntryInput, RType } from "./Entry";
import RewstFS from "../RewstFS";
import path from "path";
import { AlmostOrg, AlmostOrgInput } from "./Org";
import RewstClient from "client/RewstClient";
import { log } from "@log";

interface ITree<T extends Entry> {
  lookupEntry(uri: vscode.Uri): Entry | undefined;
  insertEntry(t: T): void;
  removeEntry(uri: vscode.Uri): void;
}

export function getUriParts(uri: vscode.Uri): string[] {
  const noScheme = uri.toString().replace(RewstFS.schema, "");
  const parts = noScheme.split("/");
  return parts;
}

export function getParentUri(uri: vscode.Uri): vscode.Uri {
  const dirPath = path.posix.dirname(uri.path);

  const parentUri = uri.with({ path: dirPath });
  return parentUri;
}

export function getOrgId(uri: vscode.Uri): string {
  return uri.authority;
}

export class Tree implements ITree<Entry> {
  orgs = new Map<string, Entry>();
  almostOrgs = new Map<string, AlmostOrg>();
  //   root: vscode.TreeItem = {};
  constructor() {
    log.info('Initializing Tree with default AlmostOrgs');
    [
      new AlmostOrg({ label: "t1", orgId: "1" }),
      new AlmostOrg({ label: "t2", orgId: "2" }),
    ].forEach((ao) => this.almostOrgs.set(ao.orgId, ao));
    log.info(`Tree initialized with ${this.almostOrgs.size} AlmostOrgs`);
  }

  lookupEntry(uri: vscode.Uri): Entry {
    const orgId = getOrgId(uri);
    log.info(`Looking up entry for URI: ${uri.toString()}, orgId: ${orgId}`);
    const org = this.orgs.get(orgId);

    if (org === undefined) {
      log.error(`Org not found for URI: ${uri.toString()}, orgId: ${orgId}`);
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const parts = getUriParts(uri);
    log.info(`Traversing ${parts.length} URI parts to find entry`);
    let cur: Entry = org;
    for (const part of parts) {
      const match = cur.children.filter((c) => c.id === part);
      if (match.length !== 1) {
        log.error(`Entry not found at URI part: ${part}, in parent: ${cur.label}`);
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      cur = match[0];
    }
    log.info(`Successfully found entry: ${cur.label} (${cur.id})`);
    return cur;
  }

  insertEntry(entry: Entry, parentUri?: vscode.Uri): void {
    if (parentUri === undefined) {
      log.info(`Inserting entry "${entry.label}" at root level`);
      if (entry.rtype !== RType.Org) {
        log.error(`Cannot add non-Org entry "${entry.label}" to root`);
        throw new Error("yo, can't add something to root that isn't an Org");
      } else {
        this.orgs.set(entry.id, entry);
        log.info(`Successfully added Org "${entry.label}" (${entry.id}) to tree`);
      }
      return;
    }

    log.info(`Inserting entry "${entry.label}" under parent URI: ${parentUri.toString()}`);
    const parent = this.lookupEntry(parentUri);

    if (parent === undefined) {
      log.error(`Parent not found for URI: ${parentUri.toString()}`);
      throw new Error(`Parent with uri '${parentUri}' could not be found`);
    } else {
      parent.addChild(entry);
      log.info(`Successfully inserted entry "${entry.label}" under parent "${parent.label}"`);
    }
  }

  removeEntry(uri: vscode.Uri): void {
    throw new Error("Method not implemented.");
  }

  getOrgs(): vscode.TreeItem[] {
    return [...this.orgs.values(), ...this.almostOrgs.values()];
  }

  newOrg(org: Entry) {
    log.info(`Converting AlmostOrg to Org: "${org.label}" (${org.orgId})`);
    const wasAlmostOrg = this.almostOrgs.has(org.orgId);
    this.almostOrgs.delete(org.orgId);
    this.orgs.set(org.orgId, org);
    log.info(`Successfully ${wasAlmostOrg ? 'converted AlmostOrg to' : 'added'} Org: "${org.label}"`);
  }
}
