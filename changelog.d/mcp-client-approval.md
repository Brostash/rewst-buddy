---
category: Fixed
---

- **Use MCP client permissions for MCP approvals.** External tool calls, including working-scope changes, no longer require an attached VS Code editor or `approveWrites`. Organization scope, write settings, and raw GraphQL opt-in remain enforced. Built-in VS Code actions retain editor approval, and MCP writes do not populate the editor approval cache.
