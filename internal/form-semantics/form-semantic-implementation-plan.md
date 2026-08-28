# Form tooling implementation prompt and verification plan

## Implementation prompt

Finish the form-tool improvements requested in the contributor's usage review.
Treat a successful GraphQL mutation as persistence evidence, not proof that a
form works. Build a shared semantic compiler and validator used by MCP and
Buddy's in-process chat. Preserve the current working tree and existing public
tool behavior where compatible with rejecting broken form definitions. Do not
open or push a pull request.

Implement all of the following, with behavioral specifications and tests:

1. Accept typed, high-level field definitions and `dynamicOptions` on form
   create/update. Generate canonical Rewst field JSON, including
   `enumSourceWorkflow`, reference defaults, options, label/value keys, inputs,
   and input-from-field mappings. Cover SELECT, MULTISELECT and RADIO dynamic
   options and validate the remaining supported field types.
2. Reject obsolete dynamic-options properties with actionable field/path errors.
   Reject unknown typed input properties. Establish explicit validation rules
   for raw field schemas without silently discarding existing Rewst metadata.
   Validate field names, IDs, types, conditions, references and dependency cycles.
3. Resolve each referenced workflow in the form's organization context. Verify
   OPTION_GENERATOR type, declared inputs and options output, actual visibility,
   and compatible trigger ownership. Do not infer visibility solely from parent
   organization membership. Resolve an omitted trigger only when the compatible
   choice is unambiguous; otherwise return actionable candidates.
4. Add an incremental `buddy_add_form_field` operation so callers can add a
   workflow-generated field without reconstructing an entire form. Preserve
   unrelated fields, condition IDs and metadata, use fresh approval, and verify
   the result after writing. Do not create a redundant alias unless required.
5. Add `buddy_validate_form` for non-executing semantic validation. Include
   field-level results and distinguish errors, warnings, passed checks and checks
   not run. Extend `buddy_get_form` with interpreted source/workflow/trigger
   information while retaining the raw definition for lossless editing.
6. Run shared semantic validation before create/update and read back the saved
   form after each write. Compare intended and persisted state. Return the saved
   ID and a distinct verification failure when persistence succeeded but the
   read-back failed; never imply rollback or encourage duplicate creation.
7. Add an explicit, approval-gated option-generator smoke-test capability using
   `runWorkflowForOptions`. Reuse semantic validation, enforce organization and
   workflow scope, resolve supplied form values into generator inputs, handle
   asynchronous/cache/error responses, and validate actual option label/value
   keys. Report empty results as inconclusive for key validation. Never execute
   generators automatically from a read-only tool or ordinary form read.
8. Extend workflow creation to support validated workflow type and the declared
   input/output configuration needed to create option generators. Do not silently
   convert, clone, activate or change permissions on an existing workflow.
9. Add `buddy_create_trigger`, resolving real trigger types and validating
   workflow/org scope. Implement form-aware submission trigger construction,
   keeping `formId` and `parameters.form_id` consistent and generating required
   criteria defaults. Verify the persisted trigger and form association. Default
   new triggers to disabled; explicit enabling requires approval. Existing
   trigger edits must keep the repository's shared patch/diff safeguards.
10. Provide readable semantic diagnostics rather than claiming UI compatibility
    from stored JSON alone. An executing smoke test must report which inputs,
    generator and checks were tested without exposing secrets or full user data.
11. Update the feature docs, behavioral specs, changelog, audit report and draft
    PR description to reflect the actual implementation and verification.

## Safety and autonomy

Work independently without unnecessary clarification. Use existing tools and
the user's authorized local MCP connection. Do not bypass VS Code approvals,
change standing allowed-org settings, extract Rewst browser credentials, or
probe production organizations. Mock cross-org failures. Live fixtures must be
created in an explicitly selected sandbox, use inert workflows and synthetic
options, and be cleaned up even after failure. Do not attach an offboarding
workflow to the user's draft or modify existing production resources. Record
any external validation that cannot run; do not label missing evidence complete.

## Verification sequence

1. Inspect current source, committed/live GraphQL signatures, repository rules,
   reference form representations and permitted test access.
2. Write failing pure/compiler and capability tests before implementation;
   extend existing suites where they naturally fit.
3. Verify canonical field generation, wrong/unknown properties, field mappings,
   workflow type/visibility, trigger selection, missing inputs, malformed/empty
   options, label/value mismatches, execution failures, and read-back failures.
4. Verify each new tool through the registry/MCP boundary: advertised schema,
   read/write exposure, disabled writes, organization/workflow scope, approval
   denial, and no accidental execution from read-only operations.
5. Run a sandbox lifecycle with a synthetic option-generator workflow, its
   trigger, a dynamic form, incremental field addition, validation, actual option
   execution, and a disabled form-submission trigger. Check associations and
   result keys, then clean up. Verify the updated MCP catalog over real transport.
6. Run full unit tests, relevant live integrations, type-check, lint, production
   build, schema parity, deterministic codegen, changelog and Markdown checks.
7. Review the diff and audit every numbered requirement against concrete source
   and test evidence. Keep this goal active until required implementation and
   verification are complete; explicitly distinguish unresolved external blockers.

## Progress

Implementation and evidence are tracked in the task plan and the final audit.
This document records the full requested scope, not a reduced success criterion.
