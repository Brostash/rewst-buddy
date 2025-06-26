# Rewst Buddy VS Code Extension - Project Context

## Project Overview and Current Objectives

**Rewst Buddy** is a VS Code extension that provides an integrated development environment for managing Rewst automation platform templates. The extension allows users to:

- Browse and organize templates in a hierarchical folder structure
- Create, edit, and manage PowerShell, HTML, and YAML templates
- Persist folder organization across VS Code sessions
- Handle concurrent editing conflicts with cloud-stored templates

**Current Primary Objectives:**
- ✅ **COMPLETED**: Implement robust conflict detection and resolution for concurrent template editing
- ✅ **COMPLETED**: Add folder structure persistence across extension reloads
- ✅ **COMPLETED**: Real-time validation preventing duplicate folder/template names
- ✅ **COMPLETED**: Template file extension preservation (.ps1, .html, .yaml)

## Key Decisions Made and Rationale

### Conflict Resolution Strategy
**Decision**: Implemented simple two-choice conflict resolution
**Rationale**: User feedback indicated that Git-style merge conflict interfaces were "sloppy and unintuitive." Simplified to just "Use My Version" or "Use Cloud Version" for maximum clarity.

### Timestamp-Based Conflict Detection
**Decision**: Use GraphQL `updatedAt` timestamps for conflict detection
**Rationale**: Provides reliable detection of concurrent edits without complex version control mechanisms.

### Storage Architecture
**Decision**: Use VS Code extension context global state for persistence
**Rationale**: Leverages built-in VS Code storage mechanisms, ensures data persists across sessions without external dependencies.

### Real-time Validation
**Decision**: 300ms debounced validation with case-insensitive duplicate checking
**Rationale**: Prevents user frustration while providing immediate feedback on naming conflicts.

## Current Status and Progress Summary

### ✅ Completed Features

#### Conflict Resolution System (`src/fs/models/Template.ts`)
- **Timestamp tracking**: Store `lastKnownUpdatedAt` on template load
- **Pre-write conflict detection**: Compare current server timestamp with known timestamp
- **Simple resolution dialog**: "Use My Version" / "Use Cloud Version" / "Cancel" options
- **Automatic data handling**: System uses appropriate version based on user choice

#### Folder Structure Persistence (`src/fs/models/TemplateFolder.ts`)
- **Storage format**: `{templateFolderStructure: {folders: [], templatePlacements: [], lastUpdated: ""}}`
- **Recursive restoration**: Rebuilds complete folder hierarchy on extension load
- **Template placement tracking**: Maintains which templates belong in which folders

#### Validation Systems (`src/fs/models/Entry.ts`)
- **Consolidated validation**: `isValidLabel(label: string, forbiddenLabels?: string[])` method
- **Real-time feedback**: Debounced input validation in create/rename operations
- **Case-insensitive checking**: Prevents "Folder" and "folder" conflicts

#### File Extension Management
- **Extension preservation**: Templates maintain proper file extensions across reloads
- **Default handling**: PowerShell (.ps1) as default extension
- **Multi-format support**: .ps1, .html, .yaml file types

### 🔧 Modified Files
- `src/fs/models/Template.ts` - Conflict resolution implementation
- `src/fs/models/TemplateFolder.ts` - Folder persistence and restoration
- `src/fs/models/Entry.ts` - Consolidated validation methods
- `src/commands/view-commands/SaveFolderStructure.ts` - Enhanced storage format
- `src/commands/template-commands/CreateTemplateFolder.ts` - Real-time validation
- `src/commands/view-commands/Rename.ts` - Real-time validation
- `src/fs/RewstDragAndDropController.ts` - Validation integration
- `src/client/graphql/templateOps.graphql` - Added updatedAt timestamps

## Critical Information Not Documented Elsewhere

### GraphQL Schema Requirements
The conflict detection system requires GraphQL operations to include `updatedAt` timestamps:
```graphql
{
  template {
    id
    name
    body
    updatedAt  # CRITICAL - Required for conflict detection
  }
}
```

### Storage Data Structure
```typescript
interface StoredOrgStructure {
  folders: Array<{id: string, label: string, parentId?: string}>;
  templatePlacements: Array<{templateId: string, folderId: string, ext?: string}>;
  lastUpdated: string;
}
```

### Extension Hardcoded Values
- Default template extension: `"ps1"`
- Validation debounce delay: `300ms`
- Temp directory for conflicts: `tmpdir()/rewst-conflicts`

### Critical Method Signatures
```typescript
// Entry validation - MUST be used for all name validation
isValidLabel(label: string, forbiddenLabels?: string[]): LabelValidationResult

// Template conflict detection - Called automatically on write
private async showConflictDialog(localData: string, serverData: string): Promise<'force' | 'view-diff' | 'cancel'>
```

## Active Issues and Blockers

### 🚨 **No Current Blockers** 
All primary objectives have been completed successfully.

### ⚠️ Potential Future Issues
1. **GraphQL Schema Changes**: If Rewst API removes `updatedAt` fields, conflict detection will break
2. **Storage Limits**: VS Code extension context has size limits (exact limit unknown)
3. **Concurrent Folder Operations**: No conflict resolution for folder structure changes
4. **Template Extension Edge Cases**: Non-standard file extensions may not persist correctly

## Next Immediate Steps and Priorities

### Priority 1: Testing and Validation
- [ ] **Test conflict resolution with real concurrent edits**
- [ ] **Verify folder structure persistence across various scenarios**
- [ ] **Test template extension preservation with all supported formats**

### Priority 2: User Experience Improvements
- [ ] **Add progress indicators for storage operations**
- [ ] **Improve error messaging for storage failures**
- [ ] **Consider undo functionality for conflict resolution choices**

### Priority 3: Robustness
- [ ] **Add storage quota monitoring and cleanup**
- [ ] **Implement folder structure conflict resolution**
- [ ] **Add automated testing for critical workflows**

## Important Context About Stakeholders and Constraints

### User Feedback Patterns
- **Simplicity preferred**: Users rejected complex Git-style conflict interfaces
- **Real-time validation valued**: Users want immediate feedback on naming conflicts  
- **Persistence expectations**: Users expect folder organization to survive extension reloads

### Technical Constraints
- **VS Code Extension Limitations**: Limited storage, no persistent processes
- **GraphQL API Dependencies**: Conflict detection requires server-side timestamp support
- **File System Abstraction**: Templates exist as virtual files, not real filesystem entries

### Development Approach
- **Iterative refinement**: Multiple iterations based on user feedback
- **User-centered design**: Functionality simplified based on actual usage patterns
- **Defensive programming**: Extensive error handling and fallback mechanisms

## Relevant Background Knowledge

### VS Code Extension Architecture
- **Entry Model**: Base class for all tree items (templates, folders, orgs)
- **Client Model**: Handles GraphQL communication with Rewst API
- **Command Pattern**: All user actions implemented as commands
- **Tree View Provider**: Custom tree view for template organization

### Rewst Platform Integration
- **Template Storage**: Templates stored on Rewst cloud platform
- **Organization Structure**: Multi-tenant with organization-based isolation
- **API Communication**: GraphQL-based with TypeScript SDK generation

### Key Design Patterns
- **State Management**: Extension context for persistence
- **Conflict Resolution**: Timestamp-based detection with user choice
- **Validation Pipeline**: Centralized validation with real-time feedback
- **Error Handling**: Graceful degradation with user notification

### File Extension Handling
Originally hardcoded to `.ps1`, now dynamically preserved based on template content type. The system supports:
- `.ps1` (PowerShell) - Default
- `.html` (HTML templates)  
- `.yaml` (YAML configuration)

**⚠️ CRITICAL**: The extension field must be properly set during template creation and preserved during storage operations, or templates will lose their proper file associations.

---

*Last Updated: 2025-06-26*  
*Project Status: Primary objectives completed, ready for testing and user feedback*