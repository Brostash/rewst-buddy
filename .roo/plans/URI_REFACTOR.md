# URI System Refactor Plan (Optimized for Alpha)

## Core Implementation Strategy

### Simplified Validation Rules
```typescript
// src/fs/validation.ts
export function sanitizeLabel(label: string): string {
  return label
    .replace(/\//g, '-') // Convert slashes to dashes
    .replace(/\s+/g, '_') // Spaces to underscores
    .substring(0, 100); // Length limit
}

export function generateUniqueLabel(
  base: string, 
  existing: Set<string>
): string {
  let candidate = base;
  let counter = 1;
  while(existing.has(candidate)) {
    candidate = `${base}-${counter++}`;
  }
  return candidate;
}
```

### Security Hardening
```typescript
// src/fs/RewstFS.ts
private resolveUri(uri: vscode.Uri): Entry | undefined {
  const pathSegments = uri.path.split('/')
    .filter(s => s)
    .map(s => {
      const decoded = decodeURIComponent(s);
      if(decoded.includes('..')) {
        throw new Error('Path traversal attempt detected');
      }
      return decoded;
    });
  
  // ...rest of resolution logic
}
```

### Performance Foundations
```typescript
// src/fs/models/ContainerEntry.ts
abstract class ContainerEntry extends Entry {
  private _childLabels = new Set<string>();
  private _children = new Map<string, Entry>();

  public addChild(child: Entry) {
    const label = sanitizeLabel(child.label);
    const uniqueLabel = generateUniqueLabel(label, this._childLabels);
    
    this._childLabels.add(uniqueLabel);
    this._children.set(uniqueLabel, child);
    child.parent = this;
  }
}
```

## Revised Implementation Phases

1. **Core URI System (1 Day)**
   - Base label sanitization
   - Simple conflict resolution
   - Basic path resolution

2. **Security Layer (4 Hours)**
   - Path traversal protection
   - URI validation middleware

3. **Alpha Testing (1 Day)**
   - Manual stress testing
   - Edge case exploration
   - Performance profiling

4. **Iteration Cycle**
   - Daily user feedback reviews
   - Rapid protocol adjustments