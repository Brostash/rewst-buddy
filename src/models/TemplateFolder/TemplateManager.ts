import { RewstClient } from '@client';
import { Template } from '../Template';
import { Entry, EntryInput, RType } from '../Entry';
import { log } from '@log';
import { TemplatePlacement } from './types';

export class TemplateManager {
	constructor(private client: RewstClient) {}

	async createTemplatesForFolder(
		folderStructureData: any,
		folder: Entry,
		templatePlacements: TemplatePlacement[],
	): Promise<void> {
		log.info(`Loading templates for org ${folder.orgId}`);

		const response = await this.client.sdk.listTemplatesMinimal({
			orgId: folder.orgId,
		});
		const allTemplates = response.templates;
		log.info(`Found ${allTemplates.length} total templates for org ${folder.orgId}`);

		const templatesForThisFolder = this.filterTemplatesForFolder(allTemplates, templatePlacements, folder);

		this.createTemplatesFromApiData(templatesForThisFolder, templatePlacements, folder);
	}

	filterTemplatesForFolder(allTemplates: any[], templatePlacements: TemplatePlacement[], folder: Entry): any[] {
		return allTemplates.filter((template: { id: string; name: string }) => {
			const placement = templatePlacements.find(p => p.templateId === template.id);

			if (placement) {
				return placement.folderId === folder.id;
			}

			return folder.parent?.rtype === RType.Org;
		});
	}

	private createTemplatesFromApiData(templates: any[], templatePlacements: TemplatePlacement[], folder: Entry): void {
		log.info(`Creating ${templates.length} templates in folder "${folder.label}" (${folder.id})`);

		templates.forEach((template: { id: string; name: string }) => {
			const placement = templatePlacements.find(p => p.templateId === template.id);
			const templateExt = placement?.templateExt || 'ps1';

			this.createTemplate(template.id, template.name, templateExt, folder);
		});
	}

	async createTemplatesFromPlacements(placements: TemplatePlacement[], folder: Entry): Promise<void> {
		log.info(`Creating ${placements.length} templates in subfolder "${folder.label}" (${folder.id})`);

		const response = await this.client.sdk.listTemplatesMinimal({
			orgId: folder.orgId,
		});
		const allTemplates = response.templates;

		placements.forEach(placement => {
			const apiTemplate = allTemplates.find(t => t.id === placement.templateId);

			if (!apiTemplate) {
				log.error(
					`Template ${placement.templateId} not found in API response for folder ${folder.label}`,
					true,
				);
				return;
			}

			const templateExt = placement.templateExt || 'ps1';
			this.createTemplate(apiTemplate.id, apiTemplate.name, templateExt, folder);
		});
	}

	private createTemplate(id: string, name: string, ext: string, parent: Entry): void {
		// Check if template already exists in this parent (prevents duplicate ID registration)
		const existingTemplate = parent.children.find(child => child.id === id);
		if (existingTemplate) {
			log.info(`Template "${name}" (${id}) already exists in folder "${parent.label}", skipping creation`);
			return;
		}

		const input: EntryInput = {
			client: this.client,
			ext: ext,
			id: id,
			label: name,
			parent: parent,
		};

		new Template(input);
		log.info(`Created template "${name}" with extension: ${ext}`);
	}
}
