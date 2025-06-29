import { context } from '@global';
import { log } from '@log';
import { Entry } from '@models';
import vscode from 'vscode';
import RewstDragAndDropController from './RewstDragAndDropController';
import RewstFS from './RewstFS';

export default class RewstView implements vscode.TreeDataProvider<vscode.TreeItem> {
	public rewstfs: RewstFS = new RewstFS();

	constructor() {
		context.subscriptions.push(
			vscode.workspace.registerFileSystemProvider(RewstFS.scheme, this.rewstfs, {
				isCaseSensitive: false,
			}),
		);
		vscode.window.createTreeView('RewstView', {
			treeDataProvider: this,
			dragAndDropController: new RewstDragAndDropController(this.rewstfs),
		});
	}

	public addSampleData() {}

	//#region treedata
	private _onDidChangeTreeData = new vscode.EventEmitter<Entry | undefined | null | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	public refresh(item?: Entry): void {
		this._onDidChangeTreeData.fire(item);
	}

	// Handle move operations by refreshing both source and destination parents
	public refreshMove(movedItem: Entry, oldParent?: Entry, newParent?: Entry): void {
		// Reset initialization for the moved item

		// Refresh old parent if it exists
		if (oldParent) {
			this.refresh(oldParent);
		}

		// Refresh new parent if it exists and is different from old parent
		if (newParent && newParent !== oldParent) {
			this.refresh(newParent);
		}

		log.info(`Refreshed move operation: ${movedItem.getLabel()} moved between parents`);
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

		return element.getChildren().then(x => x);
	}

	getParent(element: Entry): Entry | undefined {
		log.info(`getParent ${element}`);
		return element.parent;
	}

	//#endregion
}
