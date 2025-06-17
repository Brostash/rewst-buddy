import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";

export class SaveFolderStructure extends GenericCommand {
  commandName = "SaveFolderStructure";
  async execute(...args: any): Promise<unknown> {
    const entry = args[0][0] ?? undefined;

    // if (entry instanceof Entry) {
    //     const org = this.cmdContext.fs.lookupOrg(entry)
    //     const structure = org.getTemplateFolderStructure();

    //     const data = this.cmdContext.storage.getRewstOrgData(org.id);
    //     data.label = org.label
    //     data.templateFolderStructure = structure;
    //     this.cmdContext.storage.setRewstOrgData(data);

    //     return structure;
    // }

    return true;
  }
}
