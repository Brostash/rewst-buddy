import RewstClient from "client/RewstClient";
import GenericCommand from "../models/GenericCommand";
import vscode from "vscode";
import {
  createTemplateFolder,
  TemplateFolder,
  EntryInput,
  LabelValidationResult
} from "@fs/models";
import { log } from '@log';

export class CreateTemplateFolder extends GenericCommand {
  commandName = "CreateTemplateFolder";

  private validationTimeout: NodeJS.Timeout | undefined;

  async execute(...args: any): Promise<void> {
    log.info('CreateTemplateFolder command started');
    try {
      const entry = args[0][0] ?? undefined;
      log.info(`Creating template folder in: ${entry?.label || 'unknown'} (${entry?.id || 'unknown'})`);

      if (!(entry instanceof TemplateFolder)) {
        const message = "Cannot create folder in something that is not a folder";
        log.error(`CreateTemplateFolder failed: ${message}`);
        vscode.window.showErrorMessage(message);
        throw new Error(message);
      }

      // Get existing sibling folder names for validation
      await entry.initialize(); // Ensure children are loaded
      const siblingFolderNames = entry.children
        .filter(child => child instanceof TemplateFolder)
        .map(folder => folder.label);

      log.info(`Found ${siblingFolderNames.length} existing sibling folders for validation`);

      // Show input box with real-time validation
      const label = await this.showValidatedInputBox(entry, siblingFolderNames);

      if (!label) {
        log.info("No label provided, exiting Folder Creation");
        return;
      }

      log.info(`Creating template folder with name: ${label}`);
      const folder = await createTemplateFolder(entry, label);
      log.info(`Successfully created template folder: ${folder.label} (${folder.id})`);

      log.info('Refreshing view after folder creation');
      vscode.commands.executeCommand("rewst-buddy.RefreshView", folder);
      vscode.commands.executeCommand("rewst-buddy.SaveFolderStructure", folder);


      log.info('CreateTemplateFolder command completed successfully');
    } catch (error) {
      log.error(`CreateTemplateFolder command failed: ${error}`);
      throw error;
    }
  }

  private async showValidatedInputBox(
    parentFolder: TemplateFolder,
    forbiddenLabels: string[]
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      const inputBox = vscode.window.createInputBox();
      inputBox.title = 'Create Template Folder';
      inputBox.placeholder = 'Folder Name';
      inputBox.prompt = 'Enter a name for the template folder';

      let isValid = false;
      let currentValue = '';

      // Handle input validation with debouncing
      const validateInput = (value: string) => {
        // Clear existing timeout
        if (this.validationTimeout) {
          clearTimeout(this.validationTimeout);
        }

        // Set new timeout for debounced validation
        this.validationTimeout = setTimeout(() => {
          const validationResult = parentFolder.isValidLabel(value, forbiddenLabels);

          if (!validationResult.isValid) {
            inputBox.validationMessage = validationResult.error || 'Invalid folder name';
            isValid = false;
            log.info(`Validation failed for "${value}": ${validationResult.error}`);
          } else {
            inputBox.validationMessage = '';
            isValid = true;
            log.info(`Validation passed for "${value}"`);
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
          log.info(`Folder name "${currentValue.trim()}" accepted`);
          inputBox.hide();
          resolve(currentValue.trim());
        } else {
          // Prevent submission if invalid
          log.info(`Folder name "${currentValue}" rejected - validation failed`);
        }
      });

      // Handle cancellation
      inputBox.onDidHide(() => {
        if (this.validationTimeout) {
          clearTimeout(this.validationTimeout);
        }
        resolve(undefined);
      });

      // Initial validation for empty input
      validateInput('');

      inputBox.show();
    });

  }

}
