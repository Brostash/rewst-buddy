# Internal draft PR description — form semantics, verification and the option-generator loop

**Title:** Form semantics: compile, validate, verify, and actually test option generators

## Why

The previous pass gave MCP dedicated form CRUD. Using it surfaced the gap CRUD
alone leaves: `createForm` returning an id proves rows were written, not that the
form works. A field can name a workflow that does not exist, is a `STANDARD`
workflow, is invisible to the form's org, does not declare the inputs the field
feeds it, produces no `options` output, or has no usable trigger — and every one
of those saves cleanly and renders an empty dropdown. Callers were also writing
`dynamicOptions` properties Rewst does not read (`labelField`, `dependsOn`,
`inputs`), which were silently ignored.

## What changed

**A shared semantic layer.** `formSemantics.ts` is pure (no `vscode`, runs on
vitest): it compiles typed, high-level field definitions into canonical Rewst
field JSON — `schema.name`/`type`, labels, static `enum`/`enumNames`, and
`enumSourceWorkflow` with label/value keys, static `input` and `inputFromFields`
mappings with their reference defaults — and validates names, ids, types,
conditions, generator references and dependency cycles.
`formWorkflowChecks.ts` adds the live half: for each referenced workflow it
checks existence, `OPTION_GENERATOR` type, explicit visibility to the form's org,
declared inputs, an `options` output, and a compatible trigger. Both report
through one shape carrying errors, warnings, **checks that passed**, and **checks
that could not be run** — per field and overall.

**Typed fields, with real rejection.** `typedFields` on create/update compiles to
Rewst JSON, with fields referencing each other by `name`. An obsolete
`dynamicOptions` property is rejected by path and told what to use instead; an
unknown typed-field property is rejected rather than dropped. Raw `fields` still
work and are validated but never rewritten, so unmodelled Rewst metadata survives.

**Validate before, verify after.** Writes refuse a semantically broken definition
before the approval prompt. After a successful mutation the form is read back and
compared; a mismatch or failed read-back returns the **saved id** with a
`verification` block that says the write was not rolled back and does not suggest
creating a second form.

**New capabilities.**

| Tool                      | What it does                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `buddy_validate_form`     | Non-executing semantic check of a stored form, raw fields, or typed fields                  |
| `buddy_add_form_field`    | Adds one field; every other field is written back unchanged, server-only properties dropped |
| `buddy_test_form_options` | Runs the generator once via `runWorkflowForOptions` and checks the actual option keys       |
| `buddy_create_trigger`    | Creates a workflow or form-submission trigger, disabled by default                          |

`buddy_get_form` gains an `interpreted` view alongside the unchanged raw fields.
`buddy_create_workflow` gains `type`, `input` and `output`, so an
`OPTION_GENERATOR` can be created with its contract in place.

## Safety boundaries worth reviewing closely

- **Only one tool executes anything.** `buddy_test_form_options` is a write
  capability, takes `workflowId` as a required argument so the working-workflow
  scope gate sees it, validates before running, and always prompts. Reads and
  validation never invoke a generator — asserted at the MCP boundary as well as
  in the capability tests.
- **Visibility is an explicit grant.** A workflow owned by a parent org is not
  treated as visible to a child org unless it is actually shared.
- **Ambiguity is never guessed.** An omitted generator trigger is resolved only
  when the compatible choice cannot be wrong; otherwise the candidates are listed.
  The same applies to trigger-type resolution.
- **New triggers are disabled.** A trigger is what turns a passive form into an
  execution entry point, so `enabled: true` is opt-in and stated in the approval
  prompt. Existing trigger edits still go through the dedicated tools with the
  `triggerUpdate.ts` safeguards from #181/#184.
- **No data echoed back.** The smoke test reports option key names and counts —
  never option labels, option values, or the form values supplied to it.

## Verification

Green: full unit suite (vitest + extension host), `type-check`, `lint`,
`package`, markdownlint, changelog check, GraphQL document/schema parity (which
statically validates the new documents), MCP boundary gates
(`write_disabled` / `org_out_of_scope` / `workflow_out_of_scope` before any
network access), and MCP over real in-memory SDK transport.

**Not verified:** the live sandbox lifecycle. Test credentials were unavailable
in the environment this was built in, so the integration suite remains pending,
including the option-generator lifecycle test. That test exists, creates only
inert synthetic fixtures in an explicitly selected sandbox, and cleans up in a
`finally` block — but it is not evidence until it is run. Rendering the resulting
form in a signed-in browser, and the MCP catalogue as seen by an external client
after installing this build, are also unverified. See the "Not verified" section
of `internal/form-semantics/graphql-schema-audit-2026-08-27.md` for the exact commands.

## Files worth reading first

- `src/capabilities/formSemantics.ts` — the compiler and pure validator
- `src/capabilities/formWorkflowChecks.ts` — the live generator checks
- `src/capabilities/formCapabilities.ts` — validation before, verification after
- `src/capabilities/formOptionsCapabilities.ts` — the only executing path
- `openspec/specs/mcp-bridge/spec.md` — the new requirements and scenarios
