# Change Log

All notable changes to the "rewst-buddy" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.9.0] - 2025-06-29

### Added
- **Enhanced Template Operations**: Improved template creation with proper UI refresh targeting
- **Advanced Drag & Drop Validation**: Comprehensive validation to prevent invalid drop operations
- **Global Context Management**: Centralized context, filesystem, and view management for better performance
- **Success Tracking**: Drag & drop operations now only show success messages for actually completed moves
- **Template Delete Functionality**: Full template deletion support with GraphQL operations and UI integration
- **Utility Functions**: New command operations utilities, validators, and tab management helpers
- **Code Quality Tools**: Standardized ESLint and Prettier configuration for consistent code formatting

### Changed
- **Context Menu Improvements**: VS Code context menu regex patterns now use word boundaries for precise matching
- **Cloud Sync Defaults**: Cloud synchronization is now enabled by default for new organizations
- **Architecture Enhancements**: Refactored global context management for better code organization
- **UI Responsiveness**: Enhanced template creation and deletion UI refresh behavior
- **Model Organization**: Moved models from `/fs` to `/models` directory for better project structure
- **Command Structure**: Improved command organization and initialization patterns

### Fixed
- **Drag & Drop Edge Cases**: Fixed issue where items could be dragged onto themselves causing UI inconsistencies
- **Context Menu Conflicts**: Resolved regex pattern conflicts in VS Code menus (e.g., "is-template" no longer matches "is-templatefolder")
- **Success Message Accuracy**: Fixed drag & drop completion messages showing success when all operations failed
- **Template Creation Refresh**: Template creation now properly refreshes the correct parent UI element

### Technical Improvements
- **Code Organization**: Better separation of concerns with global context management
- **Error Handling**: Enhanced error handling for drag & drop operations
- **Performance**: Optimized UI refresh logic for template operations
- **Validation**: Improved input validation across all template and folder operations
- **Development Workflow**: Enhanced ESLint/Prettier integration with proper TypeScript support
- **Path Aliases**: Improved TypeScript path resolution with better alias configuration

## [0.8.0] - 2025-06-28

### Added
- **Multi-Region Support**: Configurable regional endpoints for global Rewst instances via VS Code settings
- **Cloud Folder Synchronization**: Share folder structures across team members using Rewst org variables
- **Background Sync Service**: Automatic cloud update detection with 1-minute interval checks
- **Drag & Drop Interface**: Intuitive template and folder organization with conflict validation
- **Advanced Template Operations**: Full CRUD operations with file type management
- **File Type Support**: PowerShell (.ps1), HTML (.html), YAML (.yml), and custom extensions
- **Team Collaboration**: Shared folder structures with version-based conflict detection
- **Enhanced Logging**: Configurable logging system with file rotation
- **Multi-Instance Management**: Support for multiple Rewst instances simultaneously
- **Template Renaming**: Rename templates and folders with validation
- **Copy Operations**: Copy template and folder IDs to clipboard
- **Context Menus**: Rich right-click context menus for all operations
- **Workspace Integration**: Add organizations as VS Code workspace folders

### Changed
- **Improved UI**: Better organization of commands and context menus
- **Enhanced Error Handling**: More robust error handling and user feedback
- **Session Management**: Better cookie-based authentication handling

### Fixed
- **Conflict Resolution**: Proper handling of folder structure conflicts
- **Validation**: Input validation for folder names, extensions, and operations
- **Performance**: Optimized GraphQL operations and caching

## [0.7.0] - 2024-12-XX

### Added
- **Core Template Management**: Basic template CRUD operations
- **Folder Organization**: User-created folder structures
- **Initial Cloud Sync**: Basic folder structure synchronization
- **GraphQL Integration**: Type-safe API communication with Rewst

## [0.1.0] - 2024-XX-XX

### Added
- **Initial Release**: Basic Rewst integration via session cookies
- **Template Editing**: Browse, create, and edit templates/scripts
- **Organization View**: Sidebar explorer for template navigation
- **Direct Synchronization**: Real-time saving to Rewst via GraphQL