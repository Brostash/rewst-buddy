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
    try {
      const orgId = getOrgId(uri);
      const parts = getUriParts(uri);

      log.info(`Attempting to remove entry at URI: ${uri.toString()}`);

      // Handle org-level removal (remove entire organization)
      if (parts.length === 0 || (parts.length === 1 && parts[0] === "")) {
        const org = this.orgs.get(orgId);
        if (org) {
          log.info(`Removing organization: ${org.label} (${orgId})`);
          // Remove org from tree
          this.orgs.delete(orgId);
          // Clear all children to prevent memory leaks
          org.children.forEach(child => {
            child.parent = undefined;
          });
          org.children = [];
          log.info(`Successfully removed organization: ${orgId}`);
        } else {
          log.error(`Organization not found for removal: ${orgId}`);
          throw vscode.FileSystemError.FileNotFound(uri);
        }
        return;
      }

      // Handle child entry removal (template, template folder, etc.)
      const entry = this.lookupEntry(uri);
      if (!entry) {
        log.error(`Entry not found for removal at URI: ${uri.toString()}`);
        throw vscode.FileSystemError.FileNotFound(uri);
      }

      log.info(`Removing entry: ${entry.label} (${entry.id}) of type ${RType[entry.rtype]}`);

      // Remove entry from its parent's children array
      if (entry.parent) {
        const removed = entry.parent.removeChild(entry);
        if (!removed) {
          log.error(`Failed to remove entry '${entry.id}' from parent '${entry.parent.id}'`);
          throw new Error(`Failed to remove entry '${entry.id}' from parent`);
        }
        log.info(`Removed entry '${entry.id}' from parent '${entry.parent.id}'`);
      } else {
        log.info(`Entry '${entry.id}' has no parent, skipping parent removal`);
      }

      // Clear the entry's parent reference
      entry.parent = undefined;

      // If the entry has children, clear their parent references to prevent memory leaks
      if (entry.children.length > 0) {
        log.info(`Clearing ${entry.children.length} child references for entry '${entry.id}'`);
        entry.children.forEach(child => {
          child.parent = undefined;
        });
        entry.children = [];
      }

      log.info(`Successfully removed entry: ${entry.id}`);

    } catch (error) {
      if (error instanceof vscode.FileSystemError) {
        log.error(`FileSystemError during removal: ${error.message}`);
        throw error;
      }
      const errorMessage = `Failed to remove entry at URI '${uri.toString()}': ${error}`;
      log.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  getOrgs(): vscode.TreeItem[] {
    return [...this.orgs.values(), ...this.almostOrgs.values()];
  }

  newOrg(org: Entry) {
    this.almostOrgs.delete(org.orgId);
    this.orgs.set(org.orgId, org);
  }
}
