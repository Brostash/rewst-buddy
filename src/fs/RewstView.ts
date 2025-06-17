import vscode from "vscode";
import RewstFS from "./RewstFS";
import { Entry } from "./models/";
import RewstDragAndDropController from "./RewstDragAndDropController";

export default class RewstView
  implements vscode.TreeDataProvider<vscode.TreeItem> {
  public rewstfs: RewstFS = new RewstFS();

  constructor(private context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider(
        RewstFS.scheme,
        this.rewstfs,
        { isCaseSensitive: true }
      )
    );
    vscode.window.createTreeView("RewstView", {
      treeDataProvider: this,
      dragAndDropController: new RewstDragAndDropController(this.rewstfs),
    });
  }

  public addSampleData() { }

  //#region treedata
  private _onDidChangeTreeData: vscode.EventEmitter<
    Entry | undefined | null | void
  > = new vscode.EventEmitter<Entry | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<Entry | undefined | null | void> =
    this._onDidChangeTreeData.event;

  public refresh(item?: Entry): void {
    this._onDidChangeTreeData.fire(item);
  }

  async getTreeItem(element: Entry): Promise<vscode.TreeItem> {
    if (element instanceof Entry) {
      return await element.getTreeItem();
    }
    return element;
  }

  async getChildren(element?: Entry | undefined): Promise<vscode.TreeItem[]> {
    if (element === undefined) {
      return this.rewstfs.tree.getOrgs();
    }

    return element.getChildren().then((x) => x);
  }

  getParent(element: Entry): Entry | undefined {
    console.log(`getParent ${element}`);
    return element.parent;
  }

  //#endregion
}
