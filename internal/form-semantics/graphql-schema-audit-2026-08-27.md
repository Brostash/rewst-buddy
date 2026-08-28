# Internal GraphQL schema and MCP tool audit — 2026-08-27

## Scope and evidence

This audit addresses [issue #193: No Form Tools in MCP](https://github.com/totallynotjon/rewst-buddy/issues/193).
It compares the schema at commit `f7fb7c0` with fresh introspection from
`https://api.rewst.io/graphql`. The refreshed schema and generated SDK are
committed in `1253fca`, which records their refresh from the same snapshot.
Testing ran on August 27 local time / August 28 UTC.

Schema compatibility, tool coverage and live resolver behavior are separate
claims. This is **not** a claim that every root operation was executed. Live
reads and writes were restricted to the explicitly selected contributor sandbox.
No production offboarding, role/permission changes or workflow execution was
performed.

## Schema drift

| Root         | Previous snapshot | Refreshed snapshot |
| ------------ | ----------------: | -----------------: |
| Query        |               197 |                202 |
| Mutation     |               212 |                220 |
| Subscription |                35 |                 35 |

Added queries:

- `cratePackConfigStatuses`, `crateUnpackedResources`;
- `roboRewstyWorkflowDraftContent`;
- `roleOrganizationExclusions`, `roleOrganizationExclusionOrgIds`,
  `roleOrganizationExclusionCounts`.

Added mutations:

- `assignRoleToUsers`, `removeRoleFromUsers`;
- `grantRoleToOrganizations`, `revokeRoleFromOrganizations`;
- `blockOrganizationsFromRole`, `unblockOrganizationsFromRole`;
- `runWorkflow`, `runWorkflowTrigger`, `executeWorkflowFromPage`,
  `executeWorkflowTriggerFromPage`.

Removed: `Query.home`, `Mutation.deleteComponentInstance`,
`Mutation.updateComponentInstance`, and `ComponentInstanceUpdateInput`.

Other incompatible changes detected by GraphQL's schema diff:

- `permissionAuditLog` removed `limit`/`offset` and added `after`/`pageSize`.
  `PermissionAuditLogList` removed `hasMore` and `totalCount`.
- `WorkflowExecutionSearchInput.createdAt` changed from
  `string_comparison_exp` to `timestamp_comparison_exp`.
- `CrateUnpackingArgumentSet.orgId` changed from non-null `ID!` to nullable `ID`.

Additional signature changes: optional `orgId` on `checkRolePermissions`,
`valueIn` on `localReferenceOptions`, and `pageId` on `organization`.
`ConversationType` added `WORKFLOW_DIAGNOSIS_REMEDIATION`;
`FormPermissionKey` added `IMPORT` and `EXPORT`. Draft/execution types also
gained fields captured in the schema and generated SDK diff.

No extracted runtime document or typed SDK operation uses a removed field or
an incompatible argument. Existing execution searches already construct
timestamp-compatible predicates, so they required no query rewrite.

## Form implementation review and fixes

| Finding                                                    | Resolution                                                                                                            | Evidence                                                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| MCP listed forms but lacked full reads and routine writes  | Register five shared capabilities: get, create, update, delete and set tags                                           | Registry, MCP discovery and SDK transport tests                                                          |
| `deleteForm` returns `Void`, normally null, not an ID      | Check GraphQL errors and response-field presence, then return the verified input ID                                   | Unit regression and live deletion followed by absence check                                              |
| Resolver filters alone are insufficient ownership evidence | Compare returned form ID/org; verify requested tag IDs belong to the org                                              | Wrong-org and wrong-ID regressions; MCP scope gates                                                      |
| Read conditions contain nullable properties                | Preserve null values and use generated field/action enums                                                             | Unit and live condition read/update round-trip                                                           |
| Optional input could be silently discarded                 | Validate optional strings, IDs and nested conditions before requests                                                  | Invalid-input regressions                                                                                |
| `fields` is a replacement list                             | Omission preserves fields; [] clears all; update summary reports replacement count and always requests fresh approval | Approval tests and live metadata/clear tests                                                             |
| Tag changes could drop unrelated tags                      | Separate add/remove/replace; re-read after approval, verify tags and report before/after IDs                          | Unit merge/denial tests and live add/clear                                                               |
| Discovery lacked search and paging                         | Add case-insensitive search, validated offset and deterministic name/ID order                                         | Unit and live search/pagination                                                                          |
| Reference options gained exact-ID filtering                | Add bounded `valueIn` to `buddy_resolve_reference`                                                                    | Unit forwarding/validation and live call                                                                 |
| GraphQL String does not describe condition modes           | Document `default` and `jinja`; do not use `equals` as a mode                                                         | Live resolver rejected equals; default round-trip passed                                                 |
| GraphQL omits the form-description database limit          | Reject descriptions over 255 characters before requests                                                               | Live 324-character create failed with varchar(255); shortened create succeeded; 255/256 regression tests |
| Generator configuration is nested JSON                     | Preserve `enumSourceWorkflow`, inputs and `inputFromFields`                                                           | Create/update regression and real form read-back                                                         |

Create/update payloads satisfy generated `FormCreateInput`/`FormUpdateInput`
types. Field schemas remain JSON: the tools do not validate every
integration-specific dropdown option, Jinja expression, condition mode,
generator dependency or workflow contract. Inspect reference forms and generator
definitions, then verify persisted results.

A realistic follow-up created a separate sandbox offboarding draft with 61
fields, 53 inputs, 10 dropdown fields referencing four existing generators, and
26 conditions. A fresh read matched all field schemas, IDs, order, conditions
and generator mappings; it had zero submit triggers. This used the existing
host's approved raw GraphQL bridge because the new extension build was not
installed in that host. The user-owned draft was retained intentionally; its
org-specific payload is not committed. Generator execution and browser rendering
were not verified.

## Tool coverage decisions

| Surface                                                     | Decision and reason                                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Form read/CRUD/tags                                         | Dedicated tools: common missing workflow, explicit ownership and approval semantics                                                  |
| Form options                                                | Reuse workflow reads and reference lookup; selected IDs now supported through valueIn                                                |
| Form submission / trigger attachment                        | Separate from definition CRUD: attachment can turn a passive form into an execution entry point                                      |
| Form permissions, cloning, org-specific field instances     | Defer dedicated tools until inheritance, grants and lifecycle semantics have focused tests; generic GraphQL remains separately gated |
| New workflow/page execution mutations                       | Existing buddy_workflow_run supplies approval, polling and logs; no duplicate execution path without a missing use case              |
| Bulk role membership, grants and exclusions                 | High-impact access-control operations; no dedicated writes without narrower reviewed semantics                                       |
| Crate pack status and unpacked resources                    | Existing discovery/unpack tools cover the primary task; scoped generic reads can inspect these helper fields                         |
| RoboRewsty draft content                                    | Internal assistant state, not a missing resource-management workflow                                                                 |
| Removed component/home operations and changed audit-log API | No runtime/SDK usages found; refreshed types prevent new code from relying on removed fields                                         |

Generic GraphQL does not bypass scope, write enablement, the dangerous-mutation
setting, VS Code approval or server-side permissions. A dedicated tool for
every schema field would not automatically supply domain-specific guarantees.

## Automated coverage and limits

`documents.schemaParity.test.ts` scans runtime TypeScript outside test/generated
directories for statically recoverable declarations, inline arguments and tagged
templates. It handles local string interpolation/concatenation and validates
documents against the committed schema. The audit found 75 documents referencing
33 Query, 16 Mutation and 2 Subscription root fields. These counts exclude the
separately validated typed SDK documents and runtime-built/user-supplied queries;
they are not percentages of working live resolvers.

Dynamic documents, cross-file string composition, resolver/database constraints
and authorization require their own tests. Typed SDK .graphql operations and
fragments are also validated together. Schema refresh is explicit; CI does not
contact the live service.

Verification performed:

- Full unit suite: Vitest and the VS Code extension-host suite.
- Actual MCP SDK client/server discovery and form read over in-memory transport.
- MCP boundary checks for exposure, disabled writes and organization scope.
- Opt-in live CRUD through the latest `McpActions.callTool`: create, read, name
  search, pagination, reference valueIn, metadata update, nullable condition
  round-trip, tag add/clear, field clear, delete and absence check.
- Finally-block fixture cleanup; subsequent scoped queries found no throwaway
  forms or tags from the run.

### Reproduce

```sh
npm run type-check
npm run lint
npm run test:unit
npm run package
```

The live suite supports the normal `.env.example` Rewst session-token setup, or
an optional existing local Buddy MCP host exposed through trusted HTTPS on
loopback:

```sh
export REWST_TEST_MCP_URL='https://127.0.0.1:<trusted-tls-port>/mcp'
export REWST_TEST_ORG_ID='<your explicitly selected sandbox org id>'
# Supply REWST_TEST_MCP_TOKEN through a local secret mechanism; never commit it.
export REWST_TEST_WRITE=1
env -u REWST_TEST_TOKEN npm run test:grep:integration -- 'Integration: form CRUD tools'
```

For the MCP route, the existing host must already be authenticated, permit the
sandbox in working scope, and have write tools and dangerous GraphQL mutations
enabled by the user. It must use trusted TLS: the test client rejects HTTP bearer
endpoints, including loopback, and TLS checks must not be disabled. Approve
mutations in that host's VS Code UI. The adapter supports rawGraphql only,
connects to HTTPS loopback with redirects disabled, and verifies the selected org
resolves to a sandbox. It never copies a Rewst session cookie or changes the
running host's settings.

The isolated test host uses its normal test approver; the **existing host still
enforces real approvals** on forwarded requests. This tests the latest capability
and MCP dispatch code against live resolvers, not installation of the new HTTP
catalog. After installing/reloading the build, reconnect and verify the five new
tool names. UI preview and dropdown execution still need a signed-in browser and
sandbox integration fixtures before an offboarding form is production-ready.

## Form semantics follow-up

The first pass gave MCP dedicated form CRUD. A contributor's usage review then
showed the gap that CRUD alone leaves: a form can store cleanly and still not
work. `createForm` returning an id says the rows were written, not that a
dropdown will populate, that a referenced workflow can generate its options, or
that anything will run when the form is submitted. This pass closes that gap.

### What was added

| Area                        | Change                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared semantics            | `formSemantics.ts` (pure) compiles typed fields to canonical Rewst field JSON and validates names, ids, types, conditions, references and dependency cycles          |
| Live generator checks       | `formWorkflowChecks.ts` resolves each referenced workflow: existence, `OPTION_GENERATOR` type, org visibility, declared inputs, `options` output, compatible trigger |
| Obsolete/unknown properties | `dynamicOptions` properties Rewst does not read are rejected by path, naming the canonical property; unknown typed-field properties are rejected rather than ignored |
| Raw field safety            | Raw Rewst field JSON is validated, never rewritten, so unmodelled stored metadata survives an edit                                                                   |
| Pre-write validation        | Create, update and add-field refuse a semantically broken definition before approval and before any mutation                                                         |
| Post-write verification     | Each write reads the saved form back and compares it; a mismatch or failed read-back returns the saved id and states the write was not rolled back                   |
| Incremental edit            | `buddy_add_form_field` adds one field, writing every other field back unchanged and stripping server-only properties                                                 |
| Non-executing validation    | `buddy_validate_form`; `buddy_get_form` gains an interpreted view alongside the unchanged raw fields                                                                 |
| Explicit execution          | `buddy_test_form_options` runs `runWorkflowForOptions` once, approval-gated, and checks the actual option keys; empty results are inconclusive                       |
| Generator creation          | `buddy_create_workflow` accepts type, declared inputs and outputs, and refuses an `OPTION_GENERATOR` with no `options` output                                        |
| Trigger creation            | `buddy_create_trigger` resolves real trigger types, keeps `formId`/`parameters.form_id` consistent, defaults to disabled, and verifies the saved association         |

### Deliberate boundaries

Only `buddy_test_form_options` executes anything. Reads and validation resolve
definitions and never invoke a generator, which is asserted at the MCP boundary
as well as in the capability tests. It is a write capability, takes `workflowId`
as a required argument so the working-workflow scope gate sees it, and always
prompts.

Workflow visibility is an explicit grant. A workflow owned by a parent
organization is **not** treated as visible to a child organization unless it is
actually shared, because inferring otherwise produces a form that validates and
then renders empty.

An omitted generator trigger is resolved only when the compatible choice cannot
be wrong; ambiguity returns the candidates rather than a guess. `buddy_create_trigger`
only creates — existing trigger edits stay with the dedicated tools carrying the
`triggerUpdate.ts` patch/diff safeguards from #181 and #184. `buddy_create_workflow`
only creates; it does not convert, clone, activate or re-permission an existing
workflow.

Option labels and values are never echoed back from the smoke test, and neither
are the form values supplied to it: those routinely carry user names, mailboxes
and tenant identifiers, and the result is read by a model. Only key names and
counts are reported.

### Verification performed

- Full unit suite green: vitest (including the two new pure suites,
  `formSemantics` and `formWorkflowChecks`) and the VS Code extension-host suite.
- `npm run type-check`, `npm run lint`, `npm run package`, markdownlint over
  `docs/`, `openspec/`, `changelog.d/` and `README.md`, and
  `node scripts/changelog/check.mjs --base main --include-working-tree`.
- Committed GraphQL document/schema parity, which statically validates the new
  documents (`runWorkflowForOptions`, `createTrigger`, `triggerTypes`, the
  generator workflow read and the form read-back) against the committed schema.
- MCP boundary coverage: the new tools are advertised only with write tools
  enabled, rejected as `write_disabled` and `org_out_of_scope` before any
  network access, and rejected as `workflow_out_of_scope` when they name a
  workflow outside the pinned working workflows.
- MCP over real in-memory SDK transport: the new read tool is discoverable and
  `buddy_validate_form` returns a failing report for a non-generator workflow
  without issuing `runWorkflowForOptions`; the executing and write tools are
  absent from the catalogue when write tools are off.

### Not verified — external blocker

**The live sandbox lifecycle did not run in this environment.** Test credentials
were unavailable, so the integration suite remains pending, including the new
one. The lifecycle test exists and is
written to run against an explicitly selected sandbox — it creates an inert
`OPTION_GENERATOR` whose `options` output is a Jinja literal of two synthetic
values (no integration, tenant or user data), a trigger for it, a form with a
compiled dynamic dropdown, an incrementally added field, a non-executing
validation, a real `buddy_test_form_options` run, and a **disabled**
form-submission trigger, then deletes every fixture in a `finally` block. It is
not evidence until someone runs it:

```sh
unset REWST_TEST_TOKEN
export REWST_TEST_ORG_ID='<explicitly selected sandbox org id>'
export REWST_TEST_WRITE=1
npm run test:grep:integration -- 'an option-generator workflow, its trigger'
```

Two trigger-type refs are environment-specific and are read from
`REWST_TEST_GENERATOR_TRIGGER_REF` and `REWST_TEST_FORM_TRIGGER_REF`; the form
trigger type is otherwise inferred from the live catalogue when exactly one
form-submission type exists. Also still unverified: rendering the resulting form
in a signed-in browser, and the MCP catalogue as seen by an external client
after installing and reloading this build.

`npm run codegen:check` verifies the committed generated SDK against the committed
schema. The schema and generated SDK were both committed in `1253fca`; this audit
does not claim that the check was run after subsequent changes.

### Interpretation and remaining limits

Two parts of the request were implemented to a narrower reading than the wording
might suggest, and are recorded here rather than presented as complete.

**"Reference defaults" on a generated field** are the defaults applied to each
`inputFromFields` entry: a mapping is `isActive: true` and `isRequired: false`
unless the caller says otherwise, and every mapped input also gets an empty slot
in the stored static `input` object, matching the shape observed in live forms.
Rewst reference _fields_ (the `buddy_resolve_reference` / `localReferenceOptions`
family) are not modelled as a typed field kind; a reference-backed dropdown is
still written as raw field JSON.

**"Required criteria defaults" on a new trigger** are an empty `criteria` object,
so the trigger stores an evaluable value rather than null. Criteria are not
derived per trigger type from the type's `parametersSchema`; a trigger type whose
criteria need specific keys must be given them explicitly. This is a deliberate
stop: guessing criteria shape for an unfamiliar trigger type would produce a
trigger that saves and then never fires the way the caller expected, which is the
failure mode this whole pass exists to remove.

The canonical field-JSON shapes are derived from field definitions observed in
real Rewst forms (`enumSourceWorkflow` with `id`/`triggerId`/`labelKey`/
`valueKey`/`input`/`inputFromFields`) and from the RJSF conventions Rewst's form
renderer follows (`enum`/`enumNames`, `items` for a multi-select). They are not
taken from a published Rewst schema, because there is none; the read-back
comparison after every write is what catches a shape Rewst normalizes away.

### Field IDs are UUIDs (fixed during review)

The first cut of the compiler minted synthetic field ids as `field_<name>`, on
the assumption that Rewst accepts any caller-supplied `FormFieldInput.id`. It
does not: `FormField.id` is a uuid column and the supplied value is inserted
directly, so a create failed with `invalid input syntax for type uuid:
"field_first_name"`. The GraphQL schema types the argument only as `ID`, so
nothing in the committed schema or in codegen catches this — the constraint is
in the database.

The fix has three parts. Minted ids are now `randomUUID()`, random rather than
derived from the field name, because ids are unique across forms and two forms
with a `first_name` field must not collide. An id is minted **only** for a field
another field references through a generator input mapping or a condition; every
other field is created without one so Rewst assigns it, which keeps the number
of client-chosen ids as small as possible. And a caller-supplied non-UUID field
id — on typed or raw fields — is now a `field_id_not_uuid` error naming what to
do instead, rather than a database error at write time.

Regression coverage is in `formSemantics.test.ts` under
`Unit: formSemantics field ids are Rewst UUIDs`, including the exact shape that
failed. It is worth noting what caught this: not the unit suite, not schema
parity, but a real create against the live API. It is the same class of gap this
whole pass is about — the difference between a payload that type-checks and a
payload the resolver accepts — and it argues for running the live sandbox
lifecycle before treating the rest as proven.
