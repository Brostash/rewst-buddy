# Your first Rewst Buddy investigation

[← Documentation](README.md) · [Connect a client](mcp-setup.md) · [Browser login](browser-extension.md)

Start with a question you would normally answer by opening several Rewst pages. The assistant can find the workflow, inspect its graph, and follow an execution through its task outputs.

The prompts below use **Acme** and **Employee Onboarding** as examples. Replace them with names from your own environment. They are suggested prompts, not captured execution results.

## 1 · Establish the organization

> Use Rewst Buddy to list my organizations and show the current working scope. Identify the organization named Acme before reading any workflow data.

This gives you the organization ID and tells you whether an existing scope restricts the task. Useful tools: `buddy_list_orgs` and `buddy_get_working_scope`.

**Check:** the assistant has identified the intended organization. If names are ambiguous, resolve the ID before continuing.

## 2 · Find and understand the workflow

> Find Employee Onboarding in Acme. Read its task graph and explain the main path, branch conditions, and integrations it uses. Do not change the workflow.

Useful tools: `buddy_workflow_search` and `buddy_workflow_get`. Names are a starting point; subsequent requests should use the resolved IDs.

**Check:** the answer refers to the workflow and organization you intended, and explains the graph from retrieved data.

## 3 · Investigate a failure

> Find this workflow's most recent failed execution. Inspect the failed task's input and output, and explain what the evidence supports. Distinguish the observed error from possible causes.

The assistant can list recent executions and inspect details. When a response is too large, it should use `buddy_result_read` with the returned cache ID to retrieve more pages rather than treating a truncated result as complete.

**Check:** the explanation identifies the execution, the failed task, and the relevant evidence. You can then decide whether to change a template, workflow, or configuration.

## 4 · Review a proposed change

> Propose the smallest change that addresses the failure. Show what would change and which organization and resource would be affected. Wait for my approval before applying it.

A proposal does not need write access. Applying it does. Asking the assistant to wait is a conversational instruction; enforce approval for each write through the server policy if you need a required review step. Standing approval permits supported writes without a separate editor prompt. See [enabling writes](mcp-setup.md#enabling-writes) before moving from investigation to modification.

| Server policy                                            | Behavior                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Default read-only launch                                 | Write tools are disabled.                                                                                         |
| Typed writes enabled, no standing approval               | An attached VS Code window must approve the write.                                                                |
| Typed writes enabled with `--org` and `--approve-writes` | Typed writes within the owner's allowlist can proceed without an editor prompt.                                   |
| Raw GraphQL mutations enabled                            | An attached VS Code window must approve every exact query and variables, even with typed-write standing approval. |

Working scope persists and is shared between clients. Inspect it when switching tasks. Scope requests normally need editor approval; headless standing approval is limited to the owner's configured organization allowlist.

## More things to try

| Task                      | Prompt                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Find a template           | “Find templates containing ‘notification’ in Acme and show the matching names before opening one.” |
| Understand an action      | “Find the action used by this task and explain its required inputs.”                               |
| Explore GraphQL           | “Inspect the schema, then run a read-only query for the requested fields in Acme.”                 |
| Understand a Jinja filter | “Look up the Rewst documentation for this filter and explain how to use it here.”                  |

Dedicated tools are usually the easiest starting point. `buddy_graphql_query` accepts read-only query operations; it rejects mutations and subscriptions. Public MCP tools cannot submit or retrieve login cookies.

[Client and authentication troubleshooting →](mcp-setup.md#troubleshooting)
