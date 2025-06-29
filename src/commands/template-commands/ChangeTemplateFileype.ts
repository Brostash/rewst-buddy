import GenericCommand from '../GenericCommand';
import * as vscode from 'vscode';
import { Template } from '@models';
import { log } from '@log';
import { CommandValidator, CommandOperations } from '@utils';

abstract class BaseTemplateFiletypeCommand extends GenericCommand {
	protected abstract getFileExtension(): string;
	protected abstract getFileTypeName(): string;

	async execute(...args: unknown[]): Promise<void> {
		log.info(`${this.commandName} command started`);

		try {
			const template = CommandValidator.validateAndExtract<Template>(
				args,
				Template,
				this.commandName,
				'template',
			);

			await this.changeFileExtension(template);
			await CommandOperations.refreshUI(template, this.commandName);

			log.info(`${this.commandName} command completed successfully`);
		} catch (error) {
			log.error(`${this.commandName} command failed: ${error}`, true);
			throw new Error(`Failed to change template filetype: ${error}`);
		}
	}

	private async changeFileExtension(template: Template): Promise<void> {
		const extension = this.getFileExtension();
		const typeName = this.getFileTypeName();

		log.info(
			`${this.commandName}: Changing template filetype to ${typeName} for: ${template.label} (${template.id})`,
		);

		template.ext = extension;
		log.info(`${this.commandName}: Successfully changed template extension to ${extension}`);
	}
}

export class ChangeTemplateFiletypePowershell extends BaseTemplateFiletypeCommand {
	commandName = 'ChangeTemplateFiletypePowershell';

	protected getFileExtension(): string {
		return 'ps1';
	}

	protected getFileTypeName(): string {
		return 'PowerShell';
	}
}

export class ChangeTemplateFiletypeHTML extends BaseTemplateFiletypeCommand {
	commandName = 'ChangeTemplateFiletypeHTML';

	protected getFileExtension(): string {
		return 'html';
	}

	protected getFileTypeName(): string {
		return 'HTML';
	}
}

export class ChangeTemplateFiletypeYAML extends BaseTemplateFiletypeCommand {
	commandName = 'ChangeTemplateFiletypeYAML';

	protected getFileExtension(): string {
		return 'yml';
	}

	protected getFileTypeName(): string {
		return 'YAML';
	}
}

export class ChangeTemplateFiletypeCustom extends GenericCommand {
	commandName = 'ChangeTemplateFiletypeCustom';

	async execute(...args: unknown[]): Promise<void> {
		log.info(`${this.commandName} command started`);

		try {
			const template = CommandValidator.validateAndExtract<Template>(
				args,
				Template,
				this.commandName,
				'template',
			);

			const extension = await this.promptForCustomExtension();
			if (!extension) {
				log.info(`${this.commandName}: User cancelled custom extension input`);
				return;
			}

			await this.applyCustomExtension(template, extension);
			await CommandOperations.refreshUI(template, this.commandName);

			log.info(`${this.commandName} command completed successfully`);
		} catch (error) {
			log.error(`${this.commandName} command failed: ${error}`, true);
			throw new Error(`Failed to change template to custom filetype: ${error}`);
		}
	}

	private async promptForCustomExtension(): Promise<string | undefined> {
		log.info(`${this.commandName}: Prompting user for custom extension`);
		return await vscode.window.showInputBox({
			placeHolder: 'ps1',
			prompt: 'Enter an extension (ex: html)',
			validateInput: input => {
				return /^[a-zA-Z0-9 ]*$/.test(input) ? undefined : 'Please use alpha-numerics';
			},
		});
	}

	private async applyCustomExtension(template: Template, extension: string): Promise<void> {
		log.info(`${this.commandName}: User provided custom extension: ${extension} for template: ${template.label}`);
		template.ext = extension;
		log.info(`${this.commandName}: Successfully changed template extension to: ${extension}`);
	}
}
