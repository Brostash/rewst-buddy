# TemplateFolder Storage Integration Flow

## Complete Initialization Flow

```mermaid
graph TD
    A[TemplateFolder.initialize()] --> B{Already initialized?}
    B -- Yes --> Z[Return]
    B -- No --> C{Is top-level org folder?}
    
    C -- No --> D[Standard folder initialization]
    D --> Y[Mark initialized]
    Y --> Z
    
    C -- Yes --> E[Fetch stored data from Storage.getRewstOrgData()]
    E --> F{Stored data exists?}
    
    F -- No --> G[Load templates from API only]
    G --> Y
    
    F -- Yes --> H[Parse stored templateFolderStructure]
    H --> I{Valid structure?}
    
    I -- No --> J[Log error, fallback to API only]
    J --> G
    
    I -- Yes --> K[Create missing folders recursively]
    K --> L[Load templates from API]
    L --> M[Move templates to stored locations]
    M --> N[Validate final structure]
    N --> O{Structure valid?}
    
    O -- No --> P[Log warnings]
    P --> Y
    O -- Yes --> Q[Log success]
    Q --> Y

    style E fill:#e1f5fe
    style K fill:#f3e5f5
    style M fill:#fff3e0
    style J fill:#ffebee
    style P fill:#fff9c4
```

## Folder Creation Process

```mermaid
graph TD
    A[createFoldersFromStoredStructure] --> B[Get folders for current parent]
    B --> C{Any child folders?}
    
    C -- No --> Z[Return]
    C -- Yes --> D[For each child folder]
    
    D --> E{Folder exists?}
    E -- Yes --> F[Use existing folder]
    E -- No --> G[Create new TemplateFolder]
    
    F --> H[Recursively process children]
    G --> I[Add to parent using Entry.addChild()]
    I --> H
    H --> J{More folders?}
    
    J -- Yes --> D
    J -- No --> Z

    style G fill:#c8e6c9
    style I fill:#e8f5e8
```

## Template Movement Process

```mermaid
graph TD
    A[moveTemplatesToStoredLocations] --> B[Get template placements from storage]
    B --> C{Any placements?}
    
    C -- No --> Z[Return]
    C -- Yes --> D[For each placement]
    
    D --> E[Find template by ID]
    E --> F{Template found?}
    
    F -- No --> G[Log warning, skip]
    G --> H{More placements?}
    
    F -- Yes --> I[Find target folder by ID]
    I --> J{Target folder found?}
    
    J -- No --> K[Log warning, skip]
    K --> H
    
    J -- Yes --> L{Template in correct location?}
    L -- Yes --> H
    L -- No --> M[Move template using setParent()]
    M --> N[Log movement success]
    N --> H
    
    H -- Yes --> D
    H -- No --> Z

    style M fill:#fff3e0
    style G fill:#ffebee
    style K fill:#ffebee
```

## Error Recovery Flow

```mermaid
graph TD
    A[Storage Operation] --> B{Operation successful?}
    B -- Yes --> C[Continue normal flow]
    
    B -- No --> D[Determine error type]
    D --> E{Storage not initialized?}
    E -- Yes --> F[Log error: Storage not ready]
    
    D --> G{Corrupted data?}
    G -- Yes --> H[Log error: Invalid JSON]
    
    D --> I{Missing data?}
    I -- Yes --> J[Log info: No stored structure]
    
    F --> K[Fallback to API-only mode]
    H --> K
    J --> K
    
    K --> L[Load templates from API]
    L --> M[Create default folder structure]
    M --> N[Continue with reduced functionality]
    
    style F fill:#ffebee
    style H fill:#ffebee
    style J fill:#fff9c4
    style K fill:#e3f2fd