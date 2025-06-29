import { log } from '@log';
import { createTemplate, TemplateFolder } from '@models';
import { CommandOperations, CommandValidator } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class CreateTemplate extends GenericCommand {
	commandName = 'CreateTemplate';

	async execute(...args: unknown[]): Promise<void> {
		log.info(`${this.commandName} command started`);

		try {
			const folder = CommandValidator.validateAndExtract<TemplateFolder>(
				args,
				TemplateFolder,
				this.commandName,
				'folder',
			);

			const label = await this.promptForTemplateName();
			if (!label) {
				log.info(`${this.commandName}: No label provided, exiting template creation`);
				return;
			}

			const template = await this.createTemplate(folder, label);
			await CommandOperations.refreshUI(folder, this.commandName);

			log.info(`${this.commandName} command completed successfully`);
		} catch (error) {
			log.error(`${this.commandName} command failed: ${error}`, true);
			throw new Error(`Failed to create template: ${error}`);
		}
	}

	private async promptForTemplateName(): Promise<string | undefined> {
		log.info(`${this.commandName}: Prompting user for template name`);
		return await vscode.window.showInputBox({
			placeHolder: 'Template Name',
			prompt: 'Enter a name for the template',
		});
	}

	private async createTemplate(folder: TemplateFolder, label: string): Promise<any> {
		log.info(`${this.commandName}: Creating template with name: ${label} in folder: ${folder.label}`);
		const template = await createTemplate(folder, label);

		if (!template) {
			log.error(`${this.commandName}: Failed to create template - null result`, true);
			throw new Error('Template creation failed');
		}

		log.info(`${this.commandName}: Successfully created template: ${template.label} (${template.id})`);
		return template;
	}
}
