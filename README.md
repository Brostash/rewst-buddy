# rewst-buddy - VS Code Extension

Enhance your Rewst workflow management with direct VS Code integration. This extension provides advanced template/script editing capabilities beyond Rewst's browser UI, designed for power users who regularly work with Rewst automation.

Readme was made with AI

## Features

### Core Capabilities
- **Direct Rewst Integration**:  
  Connect to your Rewst instance using your session cookie to access templates/scripts
- **Visual Organization**:  
  Auto-scan and organize all templates/scripts into a folder structure in VS Code's sidebar
- **Real-time Editing**:  
  Modify templates/scripts directly in VS Code with changes pushed immediately to Rewst
- **Template Management**:  
  Create new templates/folders directly from the editor interface

### Workflow
1. Retrieve your Rewst `appSession` cookie
2. Add your organization in the sidebar
3. Browse/edit templates with full syntax support
4. Changes save automatically to Rewst via GraphQL

> **Cookie Note**: Sessions expire 24 hours after last use. Regular users will need to reauthenticate approximately weekly.

## Requirements

### Critical Prerequisites
- **Rewst Account**: Active account on Rewst's NA instance (other instances available upon request)
- **Cookie Access**: Ability to retrieve your `appSession` cookie from browser dev tools
- **Understanding of Risks**: Users should comprehend cookie-based authentication security implications

> :warning: **Security Notice**  
> This extension uses your active session cookie for direct GraphQL access. This is:
> - **Not an official Rewst integration**
> - **Equivalent to browser-level access privileges**
> - **Recommended only for advanced users**

## Known Issues

### Current Limitations (v0.x)
- **No external change detection**: New templates created outside VS Code won't appear until reload
- **Limited error handling**: Failures may occur silently without detailed logs
- **Delete functionality disabled**: Template deletion not implemented in current version
- **Instance restriction**: Only NA Rewst instances supported by default (contact for others)
- **Session management**: No cookie refresh automation - manual reauth required after expiry

### Workarounds
- Reload VS Code to refresh template list
- Verify critical changes in Rewst's web UI
- Backup local folder structures before uninstalling

## Support & Feedback
- Request new instance support: Submit GitHub issue
- Report problems: [Create issue](https://github.com/Brostash/rewst-buddy/issues)
- Join discussion: `#rewst-buddy` channel on [Rewst Discord](https://discord.gg/rewst)

---

## Release Notes

### v0.1.0 (Initial Release)
- **Core functionality**: Connect to Rewst via session cookie
- **Template management**: Browse, create, and edit templates/scripts
- **Direct synchronization**: Real-time saving to Rewst via GraphQL
- **Organization view**: Sidebar explorer for template navigation

---

> **Disclaimer**: This is an unofficial community tool not affiliated with Rewst Inc. Use at your own risk. Sessions inherit your current Rewst permissions - you can only access templates visible in your web UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)