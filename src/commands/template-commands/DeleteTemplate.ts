import { fs } from '@global';
import { log } from '@log';
import { Template } from '@models';
import { CommandOperations, CommandValidator, TabManager } from '@utils';
import vscode from 'vscode';
import GenericCommand from '../GenericCommand';

export class DeleteTemplate extends GenericCommand {
	readonly commandName = 'DeleteTemplate';

	async execute(...args: unknown[]): Promise<boolean> {
		log.info(`${this.commandName} command started`);

		try {
			const template = CommandValidator.validateAndExtract<Template>(
				args,
				Template,
				this.commandName,
				'template',
			);

			const userConfirmed = await this.getUserConfirmation(template);
			if (!userConfirmed) {
				log.info(`${this.commandName}: User cancelled template deletion`);
				return false;
			}

			await this.performDeletion(template);
			log.info(`${this.commandName} command completed successfully`);
			return true;
		} catch (error) {
			log.error(`${this.commandName} command failed: ${error}`, true);
			vscode.window.showErrorMessage(`Failed to delete template: ${error}`);
			return false;
		}
	}

	private async getUserConfirmation(template: Template): Promise<boolean> {
		const confirmation = await vscode.window.showWarningMessage(
			`Are you sure you want to delete template "${template.label}"? This action cannot be undone.`,
			{ modal: true },
			'Delete',
		);

		return confirmation === 'Delete';
	}

	private async performDeletion(template: Template): Promise<void> {
		const parent = template.parent;

		log.info(`Starting deletion process for template: ${template.label} (${template.id})`);

		await this.closeOpenEditor(template);
		await this.deleteFromTree(template);
		await CommandOperations.refreshUI(parent, this.commandName);

		vscode.window.showInformationMessage(`Template "${template.label}" deleted successfully`);
	}

	private async closeOpenEditor(template: Template): Promise<void> {
		const templateUri = template.getUri();
		await TabManager.closeEditor(templateUri, template.label);
	}

	private async deleteFromTree(template: Template): Promise<void> {
		try {
			await fs.tree.deleteTemplate(template);
			log.info(`Successfully deleted template from tree: ${template.label}`);
		} catch (error) {
			log.error(`Failed to delete template from tree: ${error}`, true);
			throw new Error(`Template deletion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}
}
