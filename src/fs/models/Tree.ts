import vscode from "vscode";
import { Entry, EntryInput, RType } from "./Entry";
import RewstFS from "../RewstFS";
import path from "path";
import { AlmostOrg, AlmostOrgInput } from "./Org";
import RewstClient from "client/RewstClient";

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
    [
      new AlmostOrg({ label: "t1", orgId: "1" }),
      new AlmostOrg({ label: "t2", orgId: "2" }),
    ].forEach((ao) => this.almostOrgs.set(ao.orgId, ao));
  }

  lookupEntry(uri: vscode.Uri): Entry {
    const orgId = getOrgId(uri);
    const org = this.orgs.get(orgId);

    if (org === undefined) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const parts = getUriParts(uri);
    let cur: Entry = org;
    for (const part of parts) {
      const match = cur.children.filter((c) => c.id === part);
      if (match.length !== 1) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      cur = match[0];
    }
    return cur;
  }

  insertEntry(entry: Entry, parentUri?: vscode.Uri): void {
    if (parentUri === undefined) {
      if (entry.rtype !== RType.Org) {
        throw new Error("yo, can't add something to root that isn't an Org");
      } else {
        this.orgs.set(entry.id, entry);
      }
      return;
    }

    const parent = this.lookupEntry(parentUri);

    if (parent === undefined) {
      throw new Error(`Parent with uri '${parentUri}' could not be found`);
    } else {
      parent.addChild(entry);
    }
  }

  removeEntry(uri: vscode.Uri): void {
    throw new Error("Method not implemented.");
  }

  getOrgs(): vscode.TreeItem[] {
    return [...this.orgs.values(), ...this.almostOrgs.values()];
  }

  newOrg(org: Entry) {
    this.almostOrgs.delete(org.orgId);
    this.orgs.set(org.orgId, org);
  }
}
