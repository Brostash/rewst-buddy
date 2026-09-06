import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
	schema: 'packages/mcp-server/src/sessions/graphql/schema.graphql',
	documents: ['packages/mcp-server/src/**/*.graphql', '!packages/mcp-server/src/sessions/graphql/schema.graphql'],
	generates: {
		'packages/mcp-server/src/sessions/graphql/generated/': {
			preset: 'client',
			presetConfig: {
				fragmentMasking: false,
			},
		},
	},
	emitLegacyCommonJSImports: false,
};

export default config;
