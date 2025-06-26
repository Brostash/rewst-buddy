import { Template, TemplateFolder, LabelValidationResult } from "@fs/models";
import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";
import { log } from '@log';

export class Rename extends GenericCommand {
  commandName = "Rename";

  private validationTimeout: NodeJS.Timeout | undefined;

  async execute(...args: any): Promise<unknown> {
    const entry = args[0][0] ?? undefined;
    log.info(`Rename command started for: ${entry?.label} (${entry?.id})`);

    if (!entry || !(entry instanceof Template || entry instanceof TemplateFolder)) {
      const message = "Can only rename templates and template folders";
      log.error(message);
      vscode.window.showErrorMessage(message);
      throw new Error(message);
    }

    // Get sibling names for validation (excluding the current entry)
    const parentFolder = entry.parent;
    if (!parentFolder) {
      const message = "Cannot rename entry without parent";
      log.error(message);
      vscode.window.showErrorMessage(message);
      throw new Error(message);
    }

    await parentFolder.initialize(); // Ensure children are loaded
    const siblingNames = parentFolder.children
      .filter(child => child.id !== entry.id && child.constructor === entry.constructor)
      .map(sibling => sibling.label);

    log.info(`Found ${siblingNames.length} sibling ${entry.constructor.name.toLowerCase()}s for validation`);

    // Show input box with real-time validation
    const newLabel = await this.showValidatedRenameInput(entry, siblingNames);

    if (!newLabel) {
      log.info("No new label provided, exiting rename operation");
      return false;
    }

    if (newLabel === entry.label) {
      log.info("New label is same as current label, no changes needed");
      return true;
    }

    log.info(`Renaming "${entry.label}" to "${newLabel}"`);
    await entry.setLabel(newLabel);

    vscode.commands.executeCommand("rewst-buddy.RefreshView");
    vscode.commands.executeCommand("rewst-buddy.SaveFolderStructure", entry);

    log.info(`Successfully renamed to: ${newLabel}`);
    return true;
  }

  private async showValidatedRenameInput(
    entry: Template | TemplateFolder,
    forbiddenLabels: string[]
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      const inputBox = vscode.window.createInputBox();
      inputBox.title = `Rename ${entry.constructor.name}`;
      inputBox.value = entry.label;
      inputBox.placeholder = entry.label;
      inputBox.prompt = `Enter a new name for the ${entry.constructor.name.toLowerCase()}`;

      let isValid = false;
      let currentValue = entry.label;

      // Handle input validation with debouncing
      const validateInput = (value: string) => {
        // Clear existing timeout
        if (this.validationTimeout) {
          clearTimeout(this.validationTimeout);
        }

        // Set new timeout for debounced validation
        this.validationTimeout = setTimeout(() => {
          const validationResult = entry.isValidLabel(value, forbiddenLabels);

          if (!validationResult.isValid) {
            inputBox.validationMessage = validationResult.error || 'Invalid name';
            isValid = false;
            log.info(`Rename validation failed for "${value}": ${validationResult.error}`);
          } else {
            inputBox.validationMessage = '';
            isValid = true;
            log.info(`Rename validation passed for "${value}"`);
          }
        }, 300); // 300ms debounce delay
      };

      // Handle input changes
      inputBox.onDidChangeValue((value) => {
        currentValue = value;
        validateInput(value);
      });

      // Handle submission
      inputBox.onDidAccept(() => {
        if (isValid && currentValue.trim()) {
          log.info(`Rename to "${currentValue.trim()}" accepted`);
          inputBox.hide();
          resolve(currentValue.trim());
        } else {
          // Prevent submission if invalid
          log.info(`Rename to "${currentValue}" rejected - validation failed`);
        }
      });

      // Handle cancellation
      inputBox.onDidHide(() => {
        if (this.validationTimeout) {
          clearTimeout(this.validationTimeout);
        }
        resolve(undefined);
      });

      // Initial validation
      validateInput(entry.label);

      // Select all text for easy replacement
      inputBox.show();
      // Note: VS Code doesn't have a direct API to select all text, but users can Ctrl+A
    });
  }
}
