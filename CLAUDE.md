# rewst-buddy - VS Code Extension

You are a helpful typescript/node development assistant. You will adhere to guidelines and offer advice when asked. You are on a budget and will try to do the minimal work to get things right. You will not create overly complex structures.

## Project Overview

VS Code extension for Rewst automation platform integration. Provides advanced template/script editing capabilities with direct Rewst instance connectivity via session cookies. Unofficial community tool (v0.5.0) with GraphQL API integration.

## Architecture

- **TypeScript-based VS Code extension** with webpack bundling
- **Client layer** (`src/client/`) - Rewst API communication via GraphQL
- **File system layer** (`src/fs/`) - Virtual filesystem for Rewst resources
- **Commands** (`src/commands/`) - Organized by functionality (client, storage, template, view)
- **Models** - Data structures for organizations, templates, folders

## Key Files & Directories

- `src/extension.ts` - Main extension entry point
- `src/graphql_sdk.ts` - **Generated GraphQL types/client** (important for API interactions)
- `src/client/RewstClient.ts` - Core API client
- `src/client/graphql/` - GraphQL query definitions
- `src/fs/RewstFS.ts` - Virtual filesystem implementation
- `src/commands/` - Command implementations organized by category

## Rewst Structures

- **Orgs** are Organizations in Rewst, each Rewst instance has a primary Org which has data we are interested in managing
  - orgs hold various data we are interested in. Namely: Templates, Workflows, Org Variables, Users, Sub-Orgs
- **Templates** are file-like objects which are used to store scripts, html, and other content for easy inclusion into workflows.
  - These have some content type markers, but there is no actual restriction on the content they can hold.
  - We are primary concerned with streamlining the management, and organization of templates
- **Workflows** are json based state machines which define a sequence actions and transitions between them
  - input/output of standard data types can by indicated
  - workflows can have actions which are other workflows
  - while we are not very concerns with editing workflows, it might be useful to allow organization and searchign through their json definitions eventually
- **Org Variables** or `org vars` are string variables/properties that can be get/set on an organization.
  - We can use these as a place to save state in string form for the purpose of sharing state between users of the same organization using the extension
- **Sub Orgs** are just organizations, the same in every way, except they are also children of the primary org of a Rewst Instances
  - We are less concerns with sub orgs, but if we ever want to allow management of sub org, it should just be an extension of orgs, except that we can use the client of the parent to manage the suborg
  - also important to note is that graphql might return information from the suborg, unless we filter to only include the main org

## Development Conventions

- Since we are in a vscode ext, we are type module using `import { GraphQLClient } from "graphql-request"` imports. Do not use `require` unless OUTSIDE of `src`
- Use npm scripts defined in @package.json instead of one-off npx scripts
- Add paths to webpack.config.cjs and tsconfig.json to use `@path` convention, DO NOT USER `../../../type` imports
- Output is to `dist` folder
- Source files are in `src` folder
- We use ESLint defined in `eslint.config.mjs`

## Development Commands (prefer npm scripts)

```bash
# GraphQL code generation
npm run codegen

# Linting and type checking
npm run lint
npm run check-types

# Testing
npm run test

# Development workflow
npm run watch          # Watch mode (TypeScript + webpack)
npm run compile        # Development build
npm run package        # Production build

# Individual watch commands
npm run watch:tsc      # TypeScript watch only
npm run watch:webpack  # Webpack watch only
```

## Development Info

- We are using these dev dependencies
  - "@0no-co/graphqlsp": "^1.12.16"
  - "@eslint/js": "^9.28.0"
  - "@graphql-codegen/cli": "^5.0.6"
  - "@graphql-codegen/client-preset": "^4.8.1"
  - "@graphql-codegen/schema-ast": "^4.1.0"
  - "@graphql-codegen/typescript": "^4.1.6"
  - "@graphql-codegen/typescript-graphql-request": "^6.2.1"
  - "@graphql-codegen/typescript-operations": "^4.6.1"
  - "@parcel/watcher": "^2.5.1"
  - "@stylistic/eslint-plugin": "^4.4.1"
  - "@types/mocha": "^10.0.10"
  - "@types/node": "^20.17.51"
  - "@types/vscode": "^1.100.0"
  - "@typescript-eslint/eslint-plugin": "^8.33.0"
  - "@typescript-eslint/parser": "^8.33.0"
  - "@vscode/test-cli": "^0.0.10"
  - "@vscode/test-electron": "^2.5.2"
  - "eslint": "^9.28.0"
  - "globals": "^16.2.0"
  - "graphql": "^16.11.0"
  - "graphql-request": "^7.1.2"
  - "npm-run-all": "^4.1.5"
  - "ts-loader": "^9.5.2"
  - "typescript": "^5.8.3"
  - "typescript-eslint": "^8.33.0"
  - "webpack": "^5.99.9"
  - "webpack-cli": "^6.0.1"

## GraphQL Integration

- Uses `@graphql-codegen` for type-safe client generation
- Generated SDK at `src/graphql_sdk.ts` provides typed operations
- GraphQL queries defined in `src/client/graphql/`
- Targets Rewst's GraphQL API with session cookie authentication

## Security Context

- **Cookie-based authentication** using `appSession` cookie
- **Unofficial tool** - not affiliated with Rewst LLC
- Sessions expire after 24 hours of inactivity
- Inherits user's current Rewst permissions

## Current Status & Limitations

- Version 0.5.0 with known limitations
- No external change detection (requires manual refresh)
- Limited error handling
- Delete functionality disabled
- NA Rewst instances only (others on request)

## VS Code Integration

- Activates on startup
- Adds "Rewst View" to Explorer sidebar
- Provides commands for template/folder management
- Supports drag-and-drop operations
- Context menus for template operations

## Features and Context

This is intended to help my as a consultant and as such takes a multi-tenanted approach. Each client is associated with a Rewst instance, and should be completely independent. However they are all managable in the sideview.

- Allows templates to be viewed, opened, edited, and saved. With save operations starting graphql operations to update the template by getting the appropriate id and rewst client.
- Allows templates to be organized into user created folders. Folder structure is rewst instance/org specific, and should persist between reloads of vscode.
- Folder structure should be loaded when an org is loaded
- Eventually folder structure should be stored in an org var so that it can be shared amongst different developers from a single company
