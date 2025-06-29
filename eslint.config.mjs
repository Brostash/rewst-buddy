/**
 * ESLint configuration for the project.
 *
 * See https://eslint.style and https://typescript-eslint.io for additional linting options.
 */
// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default tseslint.config(
	{
		ignores: ['out', 'dist', 'webpack.config.cjs', 'src/graphql_sdk.ts'],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	...tseslint.configs.stylistic,
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: {
				...globals.node,
				...globals.es2021,
			},
		},
		plugins: {
			'@stylistic': stylistic,
			import: importPlugin,
		},
		settings: {
			'import/resolver': {
				typescript: {
					alwaysTryTypes: true,
					project: './tsconfig.json',
				},
			},
		},
		rules: {
			curly: 'warn',
			'@stylistic/semi': ['warn', 'always'],
			'@stylistic/quotes': ['warn', 'single', { avoidEscape: true }],
			'@typescript-eslint/no-empty-function': 'off',
			'@typescript-eslint/naming-convention': [
				'warn',
				{
					selector: 'import',
					format: ['camelCase', 'PascalCase'],
				},
			],
			'@typescript-eslint/no-explicit-any': 'off',
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'import/no-unresolved': 'error',
			'import/named': 'error',
			'import/default': 'error',
			'import/export': 'error',
			'no-use-before-define': 'error',
		},
	},
	prettierConfig,
);
