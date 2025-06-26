import { Org } from "@fs/models";
import {
  CreateOrgVariableMutationVariables,
  OrgVariableCategory,
} from "graphql_sdk";
import RewstClient from "client/RewstClient";
import vscode from "vscode";
import { log } from "@log";

class Storage {
  private context!: vscode.ExtensionContext;
  private initialized = false;
  public key = "RewstOrgData";

  public init(context: vscode.ExtensionContext) {
    this.context = context;
    this.initialized = true;
  }

  private ensureInitialized() {
    if (!this.initialized) {
      throw new Error("Storage not initialized. Call storage.init(context) first.");
    }
  }

  static serializeMap(myMap: Map<string, string>): string {
    return JSON.stringify(Array.from(myMap.entries()));
  }

  static deserializeMap(mapString: string): Map<string, string> {
    return new Map(JSON.parse(mapString));
  }

  getAllOrgData(): Map<string, string> {
    this.ensureInitialized();
    const mapString: string | undefined = this.context.globalState.get(this.key);
    if (mapString && mapString !== "{}") {
      return Storage.deserializeMap(mapString);
    } else {
      return new Map<string, string>();
    }
  }

  setRewstOrgData(orgId: string, data: string): void {
    this.ensureInitialized();
    this.context.globalState.update(`${this.key}-${orgId}`, data);
  }

  getRewstOrgData(orgId: string): string {
    this.ensureInitialized();
    return this.context.globalState.get(`${this.key}-${orgId}`) || '{}';
  }

  getAllOrgs(): string[] {
    this.ensureInitialized();
    // Implementation when ready
    throw new Error("getAllOrgs not implemented yet");
  }
  async upsertOrgVariable(client: RewstClient, name: string, value: string) {
    this.ensureInitialized();
    const input: CreateOrgVariableMutationVariables = {
      orgVariable: {
        cascade: false,
        category: OrgVariableCategory.General,
        id: undefined,
        name: name,
        orgId: client.orgId,
        packConfigId: undefined,
        value: value,
      },
    };

    const response = await client.sdk.createOrgVariable(input);
    return response;
  }

  /**
   * Get an organization variable value by name
   */
  async getOrgVariable(client: RewstClient, name: string): Promise<string | null> {
    try {
      const response = await client.sdk.getOrgVariable({
        orgId: client.orgId,
        name: name
      });
      return response.orgVariable?.value || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if cloud sync is enabled for folder structure (local setting per org)
   */
  isCloudSyncEnabled(client: RewstClient): boolean {
    this.ensureInitialized();
    const key = `cloudSyncEnabled-${client.orgId}`;
    return this.context.globalState.get(key, false);
  }

  /**
   * Set cloud sync setting for folder structure (local setting per org)
   */
  setCloudSyncEnabled(client: RewstClient, enabled: boolean): void {
    this.ensureInitialized();
    const key = `cloudSyncEnabled-${client.orgId}`;
    this.context.globalState.update(key, enabled);
  }

  /**
   * Store last known cloud version for conflict detection
   */
  setLastKnownCloudVersion(client: RewstClient, version: number): void {
    this.ensureInitialized();
    const key = `lastKnownCloudVersion-${client.orgId}`;
    this.context.globalState.update(key, version);
  }

  /**
   * Get last known cloud version for conflict detection
   */
  getLastKnownCloudVersion(client: RewstClient): number {
    this.ensureInitialized();
    const key = `lastKnownCloudVersion-${client.orgId}`;
    return this.context.globalState.get(key, 0);
  }

  /**
   * Save folder structure with conflict detection
   */
  async saveFolderStructureWithConflictCheck(
    client: RewstClient,
    folderStructure: any,
    expectedVersion: number,
    author: string
  ): Promise<{ success: boolean; conflict?: boolean; currentVersion?: number }> {
    try {
      // Check current cloud version
      const currentCloudStructureJson = await this.getOrgVariable(client, "rewst-buddy-folder-structure");
      let currentVersion = 0;

      if (currentCloudStructureJson) {
        try {
          const currentCloudStructure = JSON.parse(currentCloudStructureJson);
          currentVersion = currentCloudStructure.version || 0;
        } catch (error) {
          log.error(`Failed to parse current cloud structure for version check: ${error}`);
        }
      }

      // Check for conflicts
      if (currentVersion > expectedVersion) {
        return { success: false, conflict: true, currentVersion };
      }

      // No conflict - create versioned structure and save
      const versionedStructure = {
        ...folderStructure,
        version: currentVersion + 1,
        author,
        lastUpdated: new Date().toISOString()
      };

      await this.upsertOrgVariable(client, "rewst-buddy-folder-structure", JSON.stringify(versionedStructure));

      // Update our stored version
      this.setLastKnownCloudVersion(client, versionedStructure.version);

      return { success: true };
    } catch (error) {
      log.error(`Failed to save folder structure with conflict check: ${error}`);
      throw error;
    }
  }

  // Additional utility methods for storage management
  clearOrgData(orgId: string): void {
    this.ensureInitialized();
    this.context.globalState.update(`${this.key}-${orgId}`, undefined);
  }

  getAllStoredOrgIds(): string[] {
    this.ensureInitialized();
    const keys = this.context.globalState.keys();
    return keys
      .filter(key => key.startsWith(`${this.key}-`))
      .map(key => key.replace(`${this.key}-`, ''));
  }
}

export const storage = new Storage();
