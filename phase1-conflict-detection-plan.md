# Phase 1: Folder Structure Conflict Detection Implementation Plan

## Overview
Implement version tracking and pre-save conflict detection for folder structures, following the same proven pattern as template conflicts.

## 1. Enhanced Cloud Data Structure

### Current Structure
```typescript
interface StoredOrgStructure {
  templateFolderStructure?: {
    folders: SerializableTemplateFolder[];
    templatePlacements: TemplatePlacement[];
    lastUpdated: string;
  };
}
```

### Enhanced Structure with Versioning
```typescript
interface CloudFolderStructure {
  folders: SerializableTemplateFolder[];
  templatePlacements: TemplatePlacement[];
  lastUpdated: string;
  version: number;           // Incremental version counter
  author: string;           // Who made the change (user email/name)
  changeDescription?: string; // Optional description of changes
}

interface StoredOrgStructure {
  templateFolderStructure?: CloudFolderStructure;
}
```

## 2. Version Tracking in Storage

### Add Methods to Storage.ts
```typescript
class Storage {
  // Store last known cloud version locally
  setLastKnownCloudVersion(client: RewstClient, version: number): void;
  getLastKnownCloudVersion(client: RewstClient): number;
  
  // Enhanced save with conflict detection
  async saveFolderStructureWithConflictCheck(
    client: RewstClient, 
    folderStructure: CloudFolderStructure,
    expectedVersion: number
  ): Promise<boolean>;
}
```

## 3. Conflict Detection in SaveFolderStructure Command

### Pre-Save Conflict Check
```typescript
// Before saving, check if cloud version changed
const lastKnownVersion = storage.getLastKnownCloudVersion(entry.client);
const currentCloudStructure = await loadCurrentCloudStructure(entry.client);

if (currentCloudStructure && currentCloudStructure.version > lastKnownVersion) {
  // Conflict detected - show resolution UI
  const resolution = await showFolderStructureConflictDialog(
    templateFolderStructure,
    currentCloudStructure
  );
  
  if (resolution === 'cancel') {
    return false;
  }
  // Handle resolution...
}
```

## 4. Conflict Resolution UI

### Simple Two-Choice Dialog (Like Templates)
- "Use My Changes" - Overwrite cloud with local changes
- "Use Cloud Changes" - Discard local changes, use cloud version
- "Cancel" - Don't save, let user manually resolve

### Future Enhancement Ideas
- Show specific changes that conflict
- Allow selective merge of changes
- Show who made the cloud changes and when

## 5. Version Management

### On Load
- Store cloud version locally when loading folder structure
- Track this version throughout the session

### On Save
- Increment version number
- Add author information
- Update lastUpdated timestamp
- Save with version check

## 6. Files to Modify

1. **src/fs/models/TemplateFolder.ts**
   - Update interfaces for versioning
   - Add version tracking to initialization
   - Store last known version when loading from cloud

2. **src/storage/Storage.ts**
   - Add version tracking methods
   - Enhance save methods with conflict detection
   - Add conflict resolution support

3. **src/commands/view-commands/SaveFolderStructure.ts**
   - Add pre-save conflict detection
   - Implement conflict resolution flow
   - Handle version management

4. **src/ui/FolderConflictModal.ts** (new file)
   - Create conflict resolution UI
   - Similar to ConflictModal.ts but for folder structures

## 7. Implementation Steps

1. **Update Data Structures**: Add version tracking to interfaces
2. **Enhance Storage**: Add version tracking methods
3. **Modify Load Logic**: Store version when loading from cloud
4. **Add Conflict Detection**: Check version before save
5. **Create Conflict UI**: Simple resolution dialog
6. **Update Save Logic**: Handle conflict resolution results
7. **Test Scenarios**: Concurrent editing, version mismatches

## 8. Error Handling

- Network failures during version check
- Malformed cloud data without version info
- Race conditions during save operations
- User cancellation during conflict resolution

## 9. Backward Compatibility

- Handle existing cloud data without version numbers
- Gracefully upgrade data format when first version is added
- Default version to 1 for existing structures

## 10. Testing Strategy

### Test Cases
- Two users loading same structure simultaneously
- User A saves, then User B tries to save
- Network interruption during save
- Corrupted version data
- Migration from non-versioned to versioned data

This plan follows the proven template conflict resolution pattern while adapting it for the more complex folder structure use case.