# Tree Implementation Refactor Plan

## Overview
Complete the tree implementation for the Rewst Buddy VSCode extension by implementing critical missing methods in priority order.

## Priority 1: Essential Tree Functionality

### 1. Tree.removeEntry(uri: vscode.Uri): void
**Status:** ✅ IMPLEMENTED
**Critical for:** Deleting templates/folders, cleanup operations
**Complexity:** Medium

**Implementation Requirements:**
- Parse URI to find target entry
- Remove entry from parent's children array  
- Handle special case of org-level removal
- Clean up references and update tree state
- Validate removal is allowed (check permissions)

**Dependencies:**
- URI parsing utilities (✅ available)
- Parent-child relationship methods (✅ available)
- Tree lookup methods (✅ available)

### 2. Org.initialize(): Promise<void>
**Status:** ✅ IMPLEMENTED
**Critical for:** Loading org data, creating template folder hierarchy
**Complexity:** High

**Current Implementation:**
```typescript
// Currently only loads org name, missing template folder creation
const response = await this.client.sdk.UserOrganization();
this.label = org?.name ?? "";
```

**Missing Implementation:**
- Create root TemplateFolder as child of Org
- Set up proper context values for org
- Handle initialization errors
- Load existing template structure

**Dependencies:**
- TemplateFolder class (✅ available)
- RewstClient SDK methods (✅ available)
- Entry parent-child methods (✅ available)

### 3. Org.getCommand(): vscode.Command
**Status:** ✅ IMPLEMENTED
**Critical for:** Tree view expansion, navigation
**Complexity:** Low

**Implementation Requirements:**
- Return empty command (orgs are containers, not actionable)
- Ensure proper collapsible state is set
- Follow existing command pattern from other Entry types

**Dependencies:**
- VSCode Command interface (✅ available)
- Existing command patterns (✅ reference Template.getCommand())

## Implementation Sequence

### Phase 1: Quick Win
1. **Org.getCommand()** - Simple implementation, enables tree expansion

### Phase 2: Core Functionality  
2. **Org.initialize()** - Critical for org loading and template folder creation

### Phase 3: Tree Manipulation
3. **Tree.removeEntry()** - Enables deletion and cleanup operations

## Success Criteria

### ✅ Priority 1 Methods - ALL COMPLETED:
- [x] Org entries can be expanded in tree view (`Org.getCommand()` implemented)
- [x] No command errors when clicking org items
- [x] Orgs load properly with template folders (`Org.initialize()` implemented)
- [x] Org names display correctly from API
- [x] Template folder hierarchy is created with unique IDs
- [x] Templates and folders can be deleted (`Tree.removeEntry()` implemented)
- [x] Tree state remains consistent after removals
- [x] Org-level operations work correctly
- [x] Proper logging added throughout all implementations

### Implementation Summary:
1. **Tree.removeEntry()** - Handles both org-level and child entry removal with memory leak prevention
2. **Org.initialize()** - Creates designated root template folder and loads organization data from API
3. **Org.getCommand()** - Returns empty command allowing proper tree expansion behavior

## Future Priorities (Next Phases)

### Priority 2: Supporting Operations
- `Org.readData()` / `Org.writeData()` - File system operations
- `RewstFS.readDirectory()` - Directory listing
- Tree interface consistency fixes

### Priority 3: Advanced Features
- `Org.setLabel()` - Renaming capability  
- `Org.serialize()` - Export functionality
- Complete RewstFS operations (delete, rename, copy)

## Risk Assessment

**High Risk:**
- Org.initialize() complexity with async operations
- Tree.removeEntry() handling of org-level removals

**Medium Risk:**  
- Integration with existing command system
- URI parsing edge cases

**Low Risk:**
- Org.getCommand() implementation
- VSCode tree view integration

## Testing Strategy

1. **Unit Testing:** Each method in isolation
2. **Integration Testing:** Tree operations with file system
3. **UI Testing:** VSCode tree view interactions
4. **Edge Case Testing:** Error conditions and invalid operations