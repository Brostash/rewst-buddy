import { view } from '@global';
import { log } from '@log';
import { Entry, TemplateFolder } from '@models';
import vscode from 'vscode';
import RewstFS from './RewstFS';

// Types for better type safety
interface DragItem {
	readonly uri: vscode.Uri;
	readonly entry: Entry;
}

interface ConflictResolution {
	readonly conflicts: readonly string[];
	readonly validItems: readonly DragItem[];
	readonly shouldProceed: boolean;
}

export default class RewstDragAndDropController implements vscode.TreeDragAndDropController<Entry> {
	dropMimeTypes = ['application/vnd.code.tree.RewstView'];
	dragMimeTypes = ['text/uri-list'];
	constructor(public fs: RewstFS) {}

	handleDrag?(source: readonly Entry[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void {
		if (!source.length) {
			log.error('HandleDrag: No source items provided', true);
			return;
		}

		try {
			const uriList = source.map(item => item.getUri().toString());
			dataTransfer.set('text/uri-list', new vscode.DataTransferItem(JSON.stringify(uriList)));
			log.info(`Dragging ${source.length} item(s): ${source.map(s => s.label).join(', ')}`);
		} catch (error) {
			log.error(`HandleDrag: Failed to serialize drag data - ${error}`, true);
			throw new Error('Failed to prepare items for dragging');
		}
	}

	async handleDrop?(
		target: Entry | undefined,
		dataTransfer: vscode.DataTransfer,
		_token: vscode.CancellationToken,
	): Promise<void> {
		if (!this.validateDropTarget(target)) {
			return;
		}

		const dropData = await this.extractDropData(dataTransfer);
		if (!dropData) {
			return;
		}

		const targetFolder = target as TemplateFolder;
		log.info(
			`Attempting to drop ${dropData.length} item(s) into folder: ${targetFolder.label} (${targetFolder.id})`,
		);

		await targetFolder.initialize();
		const resolution = await this.validateAndResolveConflicts(dropData, targetFolder);

		if (!resolution.shouldProceed) {
			return;
		}

		await this.executeDropOperation(resolution.validItems, targetFolder);
	}

	private validateDropTarget(target: Entry | undefined): target is TemplateFolder {
		if (!(target instanceof TemplateFolder)) {
			const message = 'Can only drop items into template folders';
			log.error(`HandleDrop: ${message}`, true);
			vscode.window.showErrorMessage(message);
			return false;
		}
		return true;
	}

	private async extractDropData(dataTransfer: vscode.DataTransfer): Promise<vscode.Uri[] | null> {
		const data = dataTransfer.get('text/uri-list');
		if (!data) {
			const message = 'No items to drop';
			log.error(`HandleDrop: ${message}`, true);
			return null;
		}

		try {
			const uriStrings: string[] = JSON.parse(await data.asString());
			return uriStrings.map(uriString => vscode.Uri.parse(uriString));
		} catch (error) {
			log.error(`HandleDrop: Failed to parse drop data - ${error}`, true);
			throw new Error('Invalid drop data format');
		}
	}

	private async validateAndResolveConflicts(
		uris: readonly vscode.Uri[],
		targetFolder: TemplateFolder,
	): Promise<ConflictResolution> {
		const conflicts: string[] = [];
		const validItems: DragItem[] = [];
		const existingNames = targetFolder.children.map(child => child.label);

		for (const uri of uris) {
			const validationResult = await this.validateSingleItem(uri, targetFolder, existingNames);

			if (validationResult.isValid && validationResult.entry) {
				validItems.push({ uri, entry: validationResult.entry });
				existingNames.push(validationResult.entry.label);
			} else if (validationResult.error) {
				conflicts.push(validationResult.error);
			}
		}

		return this.resolveConflictsWithUser(conflicts, validItems);
	}

	private async validateSingleItem(
		uri: vscode.Uri,
		targetFolder: TemplateFolder,
		existingNames: readonly string[],
	): Promise<{ isValid: boolean; entry?: Entry; error?: string }> {
		try {
			const entry = await this.fs.tree.lookupEntry(uri);

			if (entry.parent?.id === targetFolder.id) {
				log.info(`Skipping ${entry.label} - already in target folder`);
				return { isValid: false };
			}

			if (entry instanceof TemplateFolder && this.isDescendantOf(targetFolder, entry)) {
				return {
					isValid: false,
					error: `Cannot move folder "${entry.label}" into itself or its subfolder`,
				};
			}

			// Check for name conflicts in target folder (case-insensitive)
			const nameConflict = existingNames.some(
				existingName => existingName.toLowerCase() === entry.label.toLowerCase(),
			);

			if (nameConflict) {
				return {
					isValid: false,
					error: `Cannot move "${entry.label}": An item with this name already exists in the target folder`,
				};
			}

			return { isValid: true, entry };
		} catch (error) {
			log.error(`Failed to lookup entry for URI ${uri.toString()}: ${error}`);
			return {
				isValid: false,
				error: `Failed to find item for moving: ${error}`,
			};
		}
	}

	private async resolveConflictsWithUser(
		conflicts: readonly string[],
		validItems: readonly DragItem[],
	): Promise<ConflictResolution> {
		if (conflicts.length === 0) {
			return { conflicts, validItems, shouldProceed: true };
		}

		const conflictMessage = `Drop operation conflicts:\n\n${conflicts.join('\n')}`;

		if (validItems.length === 0) {
			vscode.window.showErrorMessage(conflictMessage);
			return { conflicts, validItems, shouldProceed: false };
		}

		const proceed = await vscode.window.showWarningMessage(
			conflictMessage + `\n\nProceed with moving ${validItems.length} valid item(s)?`,
			{ modal: true },
			'Move Valid Items',
		);

		const shouldProceed = proceed === 'Move Valid Items';
		if (!shouldProceed) {
			log.info('User cancelled drop operation due to conflicts');
		}

		return { conflicts, validItems, shouldProceed };
	}

	private async executeDropOperation(validItems: readonly DragItem[], targetFolder: TemplateFolder): Promise<void> {
		if (validItems.length === 0) {
			return;
		}

		log.info(`Moving ${validItems.length} valid item(s) to folder: ${targetFolder.label}`);

		const successfullyMoved: DragItem[] = [];

		for (const { uri, entry } of validItems) {
			try {
				const oldParent = entry.parent;
				await this.fs.move(uri, targetFolder.getUri());

				log.info(`Successfully moved "${entry.label}" to "${targetFolder.label}"`);

				// Use the new refreshMove method to handle both old and new parent refresh
				view.refreshMove(entry, oldParent, targetFolder);
				successfullyMoved.push({ uri, entry });
			} catch (error) {
				log.error(`Failed to move "${entry.label}": ${error}`);
				vscode.window.showErrorMessage(`Failed to move "${entry.label}": ${error}`);
			}
		}

		if (successfullyMoved.length > 0) {
			this.showMoveCompletionMessage(successfullyMoved, targetFolder);
		}
	}

	private showMoveCompletionMessage(movedItems: readonly DragItem[], targetFolder: TemplateFolder): void {
		if (movedItems.length === 1) {
			vscode.window.showInformationMessage(`Moved "${movedItems[0].entry.label}" to "${targetFolder.label}"`);
		} else {
			vscode.window.showInformationMessage(`Moved ${movedItems.length} items to "${targetFolder.label}"`);
		}
	}

	/**
	 * Check if targetFolder is a descendant of sourceFolder (prevents moving folder into itself)
	 */
	private isDescendantOf(targetFolder: Entry, sourceFolder: Entry): boolean {
		let current = targetFolder.parent;
		while (current) {
			if (current.id === sourceFolder.id) {
				return true;
			}
			current = current.parent;
		}
		return false;
	}
}
