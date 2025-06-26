import vscode from "vscode";
import RewstFS from "./RewstFS";
import { Entry, TemplateFolder, Template } from "./models";
import { log } from '@log';

export default class RewstDragAndDropController
  implements vscode.TreeDragAndDropController<Entry> {
  dropMimeTypes = ["application/vnd.code.tree.RewstView"];
  dragMimeTypes = ["text/uri-list"];
  constructor(public fs: RewstFS) { }

  handleDrag?(
    source: readonly Entry[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Thenable<void> | void {
    dataTransfer.set(
      "text/uri-list",
      new vscode.DataTransferItem(
        JSON.stringify(source.map((s) => s.getUri().toString()))
      )
    );
    log.info(`Dragging ${source.length} item(s): ${source.map(s => s.label).join(', ')}`);
  }

  async handleDrop?(
    target: Entry | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): Promise<void> {
    if (!(target instanceof TemplateFolder)) {
      const message = "Can only drop items into template folders";
      log.error(message);
      vscode.window.showErrorMessage(message);
      throw new Error(message);
    }

    const data = dataTransfer.get("text/uri-list");
    if (!data) {
      const message = "No items to drop";
      log.error(message);
      throw new Error(message);
    }

    const uriStrings: string[] = JSON.parse(await data.asString());
    const uris = uriStrings.map((s) => vscode.Uri.parse(s));

    log.info(`Attempting to drop ${uris.length} item(s) into folder: ${target.label} (${target.id})`);

    // Validate each item before moving
    const conflicts: string[] = [];
    const itemsToMove: { uri: vscode.Uri, entry: Entry }[] = [];

    // Ensure target folder is initialized to get current children
    await target.initialize();

    // Get existing names in target folder for validation
    const existingNames = target.children.map(child => child.label);

    for (const uri of uris) {
      try {
        const entry = await this.fs.tree.lookupEntry(uri);

        // Skip if trying to move into the same parent
        if (entry.parent?.id === target.id) {
          log.info(`Skipping ${entry.label} - already in target folder`);
          continue;
        }

        // Skip if trying to move a folder into itself or its descendants
        if (entry instanceof TemplateFolder && this.isDescendantOf(target, entry)) {
          conflicts.push(`Cannot move folder "${entry.label}" into itself or its subfolder`);
          continue;
        }

        // Validate name conflicts using the enhanced validation
        const validationResult = target.isValidLabel(entry.label, existingNames);

        if (!validationResult.isValid) {
          conflicts.push(`Cannot move "${entry.label}": ${validationResult.error}`);
          continue;
        }

        itemsToMove.push({ uri, entry });
        // Add to existing names to prevent conflicts between multiple moved items
        existingNames.push(entry.label);

      } catch (error) {
        conflicts.push(`Failed to find item for moving: ${error}`);
        log.error(`Failed to lookup entry for URI ${uri.toString()}: ${error}`);
      }
    }

    // Show conflicts if any
    if (conflicts.length > 0) {
      const conflictMessage = `Drop operation conflicts:\n\n${conflicts.join('\n')}`;

      if (itemsToMove.length === 0) {
        // All items have conflicts, show error and abort
        vscode.window.showErrorMessage(conflictMessage);
        return;
      } else {
        // Some items can be moved, ask user to proceed with valid items
        const proceed = await vscode.window.showWarningMessage(
          conflictMessage + `\n\nProceed with moving ${itemsToMove.length} valid item(s)?`,
          { modal: true },
          'Move Valid Items',
          'Cancel'
        );

        if (proceed !== 'Move Valid Items') {
          log.info('User cancelled drop operation due to conflicts');
          return;
        }
      }
    }

    // Perform the moves for valid items
    if (itemsToMove.length > 0) {
      log.info(`Moving ${itemsToMove.length} valid item(s) to folder: ${target.label}`);

      for (const { uri, entry } of itemsToMove) {
        try {
          await this.fs.move(uri, target.getUri());
          log.info(`Successfully moved "${entry.label}" to "${target.label}"`);
        } catch (error) {
          log.error(`Failed to move "${entry.label}": ${error}`);
          vscode.window.showErrorMessage(`Failed to move "${entry.label}": ${error}`);
        }
      }

      vscode.commands.executeCommand("rewst-buddy.RefreshView");
      vscode.commands.executeCommand("rewst-buddy.SaveFolderStructure", target);

      if (itemsToMove.length === 1) {
        vscode.window.showInformationMessage(`Moved "${itemsToMove[0].entry.label}" to "${target.label}"`);
      } else {
        vscode.window.showInformationMessage(`Moved ${itemsToMove.length} items to "${target.label}"`);
      }
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
