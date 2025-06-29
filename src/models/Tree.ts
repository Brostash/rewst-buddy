import { log } from '@log';
import path from 'path';
import vscode from 'vscode';
import { Entry, RType } from './Entry';
import { AlmostOrg, Org } from './Org';

interface ITree<T extends Entry> {
	lookupEntry(uri: vscode.Uri): Promise<Entry | undefined>;
	insertEntry(t: T): Promise<void>;
	removeEntry(uri: vscode.Uri): Promise<void>;
}

export function getUriParts(uri: vscode.Uri): string[] {
	const parts = uri.path.split('/').filter(part => part !== '');
	// Filter out empty parts caused by trailing slashes
	return parts;
}

export function getParentUri(uri: vscode.Uri): vscode.Uri {
	const dirPath = path.posix.dirname(uri.path);

	const parentUri = uri.with({ path: dirPath });
	return parentUri;
}

export class Tree implements ITree<Entry> {
	orgs = new Map<string, Entry>();
	almostOrgs = new Map<string, AlmostOrg>();
	//   root: vscode.TreeItem = {};
	constructor() {}

	getOrgId(uri: vscode.Uri): string {
		const orgLabel = uri.authority;
		log.info(`Looking up orgId for URI authority (org label): ${orgLabel}`);

		// First check in the orgs map - find by label
		for (const [orgId, org] of this.orgs.entries()) {
			if (org.label.toLowerCase() === orgLabel.toLowerCase()) {
				log.info(`Found org in orgs map: ${org.label} -> ${orgId}`);
				return orgId;
			}
		}

		// Then check in almostOrgs map - find by label
		for (const [orgId, almostOrg] of this.almostOrgs.entries()) {
			if (almostOrg.label?.toString().toLowerCase() === orgLabel) {
				log.info(`Found org in almostOrgs map: ${almostOrg.label} -> ${orgId}`);
				return orgId;
			}
		}

		log.error(`Org not found for label: ${orgLabel}`);
		throw vscode.FileSystemError.FileNotFound(uri);
	}

	async lookupEntry(uri: vscode.Uri): Promise<Entry> {
		const orgId = this.getOrgId(uri);
		log.info(`[SEARCH DEBUG] Looking up entry for URI: ${uri.toString()}, orgId: ${orgId}`);
		const org = this.orgs.get(orgId);

		if (org === undefined) {
			log.error(`[SEARCH DEBUG] Org not found for URI: ${uri.toString()}, orgId: ${orgId}`);
			throw vscode.FileSystemError.FileNotFound(uri);
		}

		const parts = getUriParts(uri);
		log.info(`[SEARCH DEBUG] Traversing ${parts.length} URI parts to find entry`);
		let cur: Entry = org;

		// SEARCH FIX: Ensure the org is initialized before traversing
		if (!cur.initialized && cur.type === vscode.FileType.Directory) {
			log.info(`[SEARCH DEBUG] Initializing directory entry: ${cur.label}`);
			try {
				await cur.initialize();
				log.info(
					`[SEARCH DEBUG] Successfully initialized entry: ${cur.label} (children: ${cur.children.length})`,
				);
			} catch (error) {
				log.error(`[SEARCH DEBUG] Failed to initialize entry ${cur.label}: ${error}`);
			}
		}

		for (const part of parts) {
			log.info(
				`[SEARCH DEBUG] Current entry: ${cur.label} (initialized: ${cur.initialized}, children: ${cur.children.length})`,
			);

			// Handle file extensions - remove extension to get the base label
			const basePart = part.includes('.') ? part.substring(0, part.lastIndexOf('.')) : part;

			// First try to match by label (with or without extension)
			let match = cur.children.filter(c => c.label === basePart || c.label === part);

			// If no match found, try exact URI comparison as fallback
			if (match.length !== 1) {
				match = cur.children.filter(c => c.getUri().toString() === uri.toString());
			}

			if (match.length !== 1) {
				// SEARCH FIX: Try to initialize the parent if it hasn't been initialized
				if (!cur.initialized && cur.type === vscode.FileType.Directory) {
					log.info(`[SEARCH DEBUG] Parent not initialized, attempting to initialize: ${cur.label}`);
					try {
						await cur.initialize();
						log.info(
							`[SEARCH DEBUG] Initialized parent, retrying search. Children: ${cur.children.length}`,
						);

						// Retry the search after initialization
						match = cur.children.filter(c => c.label === basePart || c.label === part);
						if (match.length !== 1) {
							match = cur.children.filter(c => c.getUri().toString() === uri.toString());
						}
					} catch (error) {
						log.error(`[SEARCH DEBUG] Failed to initialize parent ${cur.label}: ${error}`);
					}
				}

				if (match.length !== 1) {
					log.error(
						`[SEARCH DEBUG] Entry not found at URI part: ${part} (base: ${basePart}), in parent: ${cur.label}`,
					);
					log.error(
						`[SEARCH DEBUG] Parent initialized: ${cur.initialized}, children count: ${cur.children.length}`,
					);
					log.error(`[SEARCH DEBUG] Available children: ${cur.children.map(c => c.label).join(', ')}`);
					throw vscode.FileSystemError.FileNotFound(uri);
				}
			}
			cur = match[0];
		}
		log.info(`[SEARCH DEBUG] Successfully found entry: ${cur.label} (${cur.id})`);
		return cur;
	}

	async insertEntry(entry: Entry, parentUri?: vscode.Uri): Promise<void> {
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
		const parent = await this.lookupEntry(parentUri);

		if (parent === undefined) {
			log.error(`Parent not found for URI: ${parentUri.toString()}`);
			throw new Error(`Parent with uri '${parentUri}' could not be found`);
		} else {
			parent.addChild(entry);
			log.info(`Successfully inserted entry "${entry.label}" under parent "${parent.label}"`);
		}
	}

	async removeEntry(uri: vscode.Uri): Promise<void> {
		try {
			const orgId = this.getOrgId(uri);
			const parts = getUriParts(uri);

			log.info(`Attempting to remove entry at URI: ${uri.toString()}`);

			// Handle org-level removal (remove entire organization)
			if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) {
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
			const entry = await this.lookupEntry(uri);
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

	lookupOrg(uri: vscode.Uri): Org {
		const orgId = this.getOrgId(uri);
		const org = this.orgs.get(orgId);
		if (!(org instanceof Org)) {
			throw new Error('Could not find org');
		}
		return org;
	}

	newOrg(org: Entry) {
		log.info(`Converting AlmostOrg to Org: "${org.label}" (${org.orgId})`);
		const wasAlmostOrg = this.almostOrgs.has(org.orgId);
		this.almostOrgs.delete(org.orgId);
		this.orgs.set(org.orgId, org);
		log.info(`Successfully ${wasAlmostOrg ? 'converted AlmostOrg to' : 'added'} Org: "${org.label}"`);
	}

	async deleteTemplate(template: Entry): Promise<void> {
		log.info(`Deleting template: ${template.label} (${template.id})`);

		if (!template.client) {
			throw new Error('Template has no client - cannot delete');
		}

		try {
			// Call the GraphQL API to delete the template
			await template.client.sdk.deleteTemplate({ id: template.id });
			log.info(`Successfully deleted template via API: ${template.id}`);

			// Remove the template from the tree structure
			await this.removeEntry(template.getUri());
			log.info(`Successfully removed template from tree: ${template.label}`);
		} catch (error) {
			log.error(`Failed to delete template ${template.label} (${template.id}): ${error}`);
			throw error;
		}
	}
}
