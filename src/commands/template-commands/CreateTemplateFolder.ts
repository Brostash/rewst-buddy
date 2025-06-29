import { log } from '@log';
import { TemplateFolder } from '@models';
import { CommandOperations, CommandValidator } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class CreateTemplateFolder extends GenericCommand {
	commandName = 'CreateTemplateFolder';

	private validationTimeout: NodeJS.Timeout | undefined;

	async execute(...args: unknown[]): Promise<void> {
		log.info(`${this.commandName} command started`);

		try {
			const parentFolder = CommandValidator.validateAndExtract<TemplateFolder>(
				args,
				TemplateFolder,
				this.commandName,
				'folder',
			);

			const siblingFolderNames = await this.getSiblingFolderNames(parentFolder);
			const label = await this.showValidatedInputBox(parentFolder, siblingFolderNames);

			if (!label) {
				log.info(`${this.commandName}: No label provided, exiting folder creation`);
				return;
			}

			const folder = await this.createFolder(parentFolder, label);
			await CommandOperations.refreshUI(parentFolder, this.commandName);

			log.info(`${this.commandName} command completed successfully`);
		} catch (error) {
			log.error(`${this.commandName} command failed: ${error}`, true);
			throw new Error(`Failed to create template folder: ${error}`);
		}
	}

	private async getSiblingFolderNames(parentFolder: TemplateFolder): Promise<string[]> {
		await parentFolder.initialize();
		const siblingFolderNames = parentFolder.children
			.filter(child => child instanceof TemplateFolder)
			.map(folder => folder.label);

		log.info(`${this.commandName}: Found ${siblingFolderNames.length} existing sibling folders for validation`);
		return siblingFolderNames;
	}

	private async createFolder(parentFolder: TemplateFolder, label: string): Promise<TemplateFolder> {
		log.info(`${this.commandName}: Creating template folder with name: ${label}`);
		const folder = await TemplateFolder.createFolder(parentFolder, label);

		if (!folder) {
			log.error(`${this.commandName}: Failed to create folder - null result`, true);
			throw new Error('Folder creation failed');
		}

		log.info(`${this.commandName}: Successfully created template folder: ${folder.label} (${folder.id})`);
		return folder;
	}

	private async showValidatedInputBox(
		parentFolder: TemplateFolder,
		forbiddenLabels: string[],
	): Promise<string | undefined> {
		return new Promise(resolve => {
			const inputBox = this.createInputBox();
			const isValid = false;
			const currentValue = '';

			const validateInput = this.createValidationFunction(parentFolder, forbiddenLabels, inputBox);

			this.setupInputBoxHandlers(inputBox, validateInput, resolve, isValid, currentValue);

			validateInput('');
			inputBox.show();
		});
	}

	private createInputBox(): vscode.InputBox {
		const inputBox = vscode.window.createInputBox();
		inputBox.title = 'Create Template Folder';
		inputBox.placeholder = 'Folder Name';
		inputBox.prompt = 'Enter a name for the template folder';
		return inputBox;
	}

	private createValidationFunction(
		parentFolder: TemplateFolder,
		forbiddenLabels: string[],
		inputBox: vscode.InputBox,
	): (value: string) => void {
		return (value: string) => {
			if (this.validationTimeout) {
				clearTimeout(this.validationTimeout);
			}

			this.validationTimeout = setTimeout(() => {
				const validationResult = parentFolder.isValidLabel(value, forbiddenLabels);
				this.updateValidationState(inputBox, validationResult, value);
			}, 300);
		};
	}

	private updateValidationState(inputBox: vscode.InputBox, validationResult: any, value: string): void {
		if (!validationResult.isValid) {
			inputBox.validationMessage = validationResult.error || 'Invalid folder name';
			log.info(`${this.commandName}: Validation failed for "${value}": ${validationResult.error}`);
		} else {
			inputBox.validationMessage = '';
			log.info(`${this.commandName}: Validation passed for "${value}"`);
		}
	}

	private setupInputBoxHandlers(
		inputBox: vscode.InputBox,
		validateInput: (value: string) => void,
		resolve: (value: string | undefined) => void,
		_isValid: boolean,
		currentValue: string,
	): void {
		inputBox.onDidChangeValue(value => {
			currentValue = value;
			validateInput(value);
		});

		inputBox.onDidAccept(() => {
			if (inputBox.validationMessage === '' && currentValue.trim()) {
				log.info(`${this.commandName}: Folder name "${currentValue.trim()}" accepted`);
				inputBox.hide();
				resolve(currentValue.trim());
			} else {
				log.info(`${this.commandName}: Folder name "${currentValue}" rejected - validation failed`);
			}
		});

		inputBox.onDidHide(() => {
			if (this.validationTimeout) {
				clearTimeout(this.validationTimeout);
			}
			resolve(undefined);
		});
	}
}
