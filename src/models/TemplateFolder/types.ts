export interface SerializableTemplateFolder {
	id: string;
	label: string;
	parentId?: string;
	childFolderIds: string[];
	templateIds: string[];
}

export interface TemplatePlacement {
	templateId: string;
	folderId: string;
	templateName: string;
	templateExt?: string;
}

export interface CloudFolderStructure {
	folders: SerializableTemplateFolder[];
	templatePlacements: TemplatePlacement[];
	lastUpdated: string;
	version: number;
	author: string;
	changeDescription?: string;
}

export interface StoredOrgStructure {
	templateFolderStructure?: CloudFolderStructure;
}
