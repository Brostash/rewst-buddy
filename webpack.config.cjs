/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const path = require('path');

/**@type {import('webpack').Configuration}*/
const config = {
	target: 'node', // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/

	entry: './src/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
	output: {
		// the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
		path: path.resolve(__dirname, 'dist'),
		filename: 'extension.js',
		libraryTarget: 'commonjs2',
		devtoolModuleFilenameTemplate: '../[resource-path]',
	},
	devtool: 'source-map',
	externals: {
		vscode: 'commonjs vscode', // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
	},
	resolve: {
		// support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
		extensions: ['.ts', '.js'],
		alias: {
			'@fs': path.resolve(__dirname, 'src/fs/index.ts'),
			'@models': path.resolve(__dirname, 'src/models/index.ts'),
			'@storage': path.resolve(__dirname, 'src/storage/index.ts'),
			'@commands': path.resolve(__dirname, 'src/commands/index.ts'),
			'@client': path.resolve(__dirname, 'src/client/index.ts'),
			'@utils': path.resolve(__dirname, 'src/utils/index.ts'),
			'@sdk': path.resolve(__dirname, 'src/graphql_sdk.ts'),
			'@log': path.resolve(__dirname, 'src/log.ts'),
			'@global': path.resolve(__dirname, 'src/global-context/index.ts'),
		},
		modules: [path.resolve(__dirname, 'src'), 'node_modules'],
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: ['ts-loader'],
			},
		],
	},
	stats: {
		errorDetails: true,
	},
};

module.exports = config;
