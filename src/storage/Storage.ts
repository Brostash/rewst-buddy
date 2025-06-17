import { Org } from "@fs/models";
import {
  CreateOrgVariableMutationVariables,
  OrgVariableCategory,
} from "graphql_sdk";
import RewstClient from "client/RewstClient";
import vscode from "vscode";

export default class Storage {
  key = "RewstOrgData";

  constructor(private context: vscode.ExtensionContext) { }

  static serializeMap(myMap: Map<string, string>): string {
    throw new Error("not made yet");
    return JSON.stringify(Array.from(myMap.entries()));
  }

  static deserializedMap(mapString: string): Map<string, string> {
    return new Map(JSON.parse(mapString));
  }

  getAllOrgData(): Map<string, string> {
    const mapString: string | undefined = this.context.globalState.get(
      this.key
    );
    if (mapString && mapString !== "{}") {
      return Storage.deserializedMap(mapString);
    } else {
      return new Map<string, string>();
    }
  }

  setRewstOrgData(org: Org): void {
    throw new Error("not made yet");
  }

  getRewstOrgData(orgId: string): string {
    throw new Error("not made yet");
  }

  getAllOrgs(context: vscode.ExtensionContext): string[] {
    throw new Error("not made yet");
  }

  async upsertOrgVariable(client: RewstClient, value: string) {
    const input: CreateOrgVariableMutationVariables = {
      orgVariable: {
        cascade: false,
        category: OrgVariableCategory.General,
        id: undefined,
        name: "rewst-buddy-config",
        orgId: client.orgId,
        packConfigId: undefined,
        value: value,
      },
    };

    const response = await client.sdk.createOrgVariable(input);
  }
}
