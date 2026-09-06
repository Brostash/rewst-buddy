import { LinkManager, type TemplateLink } from '@models';

/** Apply server metadata notifications to the editor's linked-file cache. */
export function applyTemplateChanged(template: { id: string; name: string; updatedAt?: string | null }): void {
	for (const link of LinkManager.getTemplateLinkFromId(template.id)) {
		const updated: TemplateLink = {
			...link,
			template: {
				...link.template,
				name: template.name,
				updatedAt: template.updatedAt ?? link.template.updatedAt,
			},
		};
		LinkManager.addLink(updated);
	}
}
