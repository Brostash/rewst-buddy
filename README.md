# rewst-buddy - VS Code Extension

Enhance your Rewst workflow management with direct VS Code integration. This extension provides advanced template/script editing capabilities beyond Rewst's browser UI, designed for power users who regularly work with Rewst automation.

Readme was made with AI

## Features

### Core Capabilities
- **Direct Rewst Integration**:  
  Connect to your Rewst instance using your session cookie to access templates/scripts
- **Multi-Region Support**:  
  Configure custom regional endpoints for different Rewst instances worldwide
- **Advanced Template Management**:  
  Create, edit, delete, and organize templates with file type support (PowerShell, HTML, YAML, Custom)
- **Cloud Folder Synchronization**:  
  Organize templates in folders with cloud sync across team members via Rewst org variables
- **Drag & Drop Organization**:  
  Intuitive drag-and-drop interface for moving templates and folders
- **Background Sync Service**:  
  Automatic cloud update detection with conflict resolution
- **Multi-Instance Support**:  
  Manage multiple Rewst instances simultaneously as a consultant

### Template Operations
- **Full CRUD Operations**: Create, read, update, and delete templates
- **File Type Management**: Set template file extensions (PowerShell, HTML, YAML, Custom)
- **Real-time Editing**: Modify templates directly in VS Code with immediate GraphQL sync
- **Copy Operations**: Copy template and folder IDs for workflow integration
- **Rename Functionality**: Rename templates and folders with validation

### Folder Management
- **Hierarchical Organization**: Create nested folder structures for template organization
- **Persistent Structure**: Folder organization persists between VS Code sessions
- **Team Collaboration**: Share folder structures across team members via cloud sync
- **Conflict Resolution**: Handle folder structure conflicts when multiple users make changes

### Cloud Synchronization
- **Toggle Cloud Sync**: Enable/disable cloud synchronization per organization
- **Automatic Updates**: Background service checks for cloud changes every minute
- **Manual Refresh**: Force refresh folder structure from cloud
- **Conflict Detection**: Version-based conflict detection with user notifications
- **Local Fallback**: Store folder structure locally when cloud sync is disabled

### Workflow
1. Retrieve your Rewst `appSession` cookie
2. Add your organization in the sidebar
3. Browse/edit templates with full syntax support
4. Changes save automatically to Rewst via GraphQL

> **Cookie Note**: Sessions expire 24 hours after last use. Regular users will need to reauthenticate approximately weekly.

## Requirements

### Critical Prerequisites
- **Rewst Account**: Active account on any Rewst instance (NA supported by default, others configurable)
- **Cookie Access**: Ability to retrieve your session cookie from browser dev tools
- **Understanding of Risks**: Users should comprehend cookie-based authentication security implications

> :warning: **Security Notice**  
> This extension uses your active session cookie for direct GraphQL access. This is:
> - **Not an official Rewst integration**
> - **Equivalent to browser-level access privileges**
> - **Recommended only for advanced users**

## Known Issues

### Current Limitations (v0.9.0)
- **No external template detection**: New templates created outside VS Code won't appear until reload
- **Session management**: No cookie refresh automation - manual reauth required after expiry
- **Template-focused**: Extension focuses on template management only, no workflow operations

### Workarounds
- Reload VS Code to refresh template list
- Verify critical changes in Rewst's web UI
- Backup local folder structures before uninstalling

## Configuration

### Multi-Region Setup
For non-NA Rewst instances, configure custom regions in VS Code settings:

1. Open VS Code Settings (Cmd/Ctrl + ,)
2. Search for "rewst-buddy"
3. Edit "Regions" to add your instance:

```json
{
  "rewst-buddy.regions": [
    {
      "name": "North America",
      "cookieName": "appSession",
      "graphqlUrl": "https://api.rewst.io/graphql",
      "loginUrl": "https://app.rewst.io"
    },
    {
      "name": "Europe",
      "cookieName": "appSession",
      "graphqlUrl": "https://api.eu.rewst.io/graphql",
      "loginUrl": "https://app.eu.rewst.io"
    }
  ]
}
```

## Support & Feedback
- Report problems: [Create issue](https://github.com/Brostash/rewst-buddy/issues)

---

## Release Notes

### v0.9.0 (Current Release)
- **Enhanced Drag & Drop**: Improved validation and success tracking for template/folder operations
- **Template Delete Functionality**: Full template deletion support with GraphQL operations
- **Refined Context Menus**: Fixed regex patterns for precise VS Code menu item matching
- **Better UI Responsiveness**: Optimized template creation and refresh behavior
- **Improved Architecture**: Global context management and model reorganization for better performance
- **Enhanced Error Handling**: Better validation and user feedback for all operations
- **Code Quality**: Standardized ESLint/Prettier configuration and development workflow
- **Cloud Sync Defaults**: Cloud synchronization now enabled by default for new organizations

### v0.8.0 (Previous Release)
- **Multi-Region Support**: Configure custom regional endpoints for global Rewst instances
- **Cloud Folder Sync**: Share folder structures across team members via Rewst org variables
- **Background Sync Service**: Automatic cloud update detection with conflict resolution
- **Drag & Drop Interface**: Intuitive template and folder organization
- **Advanced Template Operations**: Full CRUD with file type management (PowerShell, HTML, YAML, Custom)
- **Multi-Instance Management**: Support for multiple Rewst instances simultaneously
- **Enhanced Logging**: Configurable logging system with rotation
- **Team Collaboration**: Shared folder structures with conflict detection

### v0.7.0 (Previous Release)
- **Foundation Features**: Core template management and folder organization
- **Initial Cloud Sync**: Basic folder structure synchronization

### v0.1.0 (Initial Release)
- **Core functionality**: Connect to Rewst via session cookie
- **Template management**: Browse, create, and edit templates/scripts
- **Direct synchronization**: Real-time saving to Rewst via GraphQL
- **Organization view**: Sidebar explorer for template navigation

---

> **Disclaimer**: This is an unofficial community tool not affiliated with Rewst LLC. Use at your own risk. Sessions inherit your current Rewst permissions.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)