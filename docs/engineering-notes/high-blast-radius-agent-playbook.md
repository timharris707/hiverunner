# High-Blast-Radius Agent Playbook

Use this playbook before editing HiveRunner code that can affect orchestration,
runtime execution, onboarding, provider/key handling, task/goal flow, company
creation, or shared API/client contracts.

This is an advisory workflow. CodeGraph and Fallow artifacts are local generated
state only; do not commit `.codegraph/`, `.fallow/`, or reports unless the task
explicitly asks for a curated note.

## Pre-Edit Orientation

1. Identify the exact symbol, route, service, or file you plan to change. Avoid
   broad concept terms when a concrete symbol exists.
2. Check that CodeGraph is usable and current enough for orientation:

```sh
npx -y @colbymchenry/codegraph status .
```

3. Run the CodeGraph navigation set for the concrete target:

```sh
npx -y @colbymchenry/codegraph query <specific-symbol-or-route> --limit 10
npx -y @colbymchenry/codegraph callers <specific-symbol-or-route> --limit 20
npx -y @colbymchenry/codegraph callees <specific-symbol-or-route> --limit 20
npx -y @colbymchenry/codegraph impact <specific-symbol-or-route> --depth 2
```

Use the output to map likely service, API route, UI, runtime, and test surfaces.
Treat it as a first-pass map, not proof.

4. Run the changed-file Fallow audit before editing if the branch already has
   local changes, and run it again after the edit when practical:

```sh
npm run fallow:changed
```

Fallow is useful for PR hygiene, dependency drift, cycles, duplicate code, and
changed-file risk. Do not delete code or dependencies solely because Fallow
flagged them.

## Required Cross-Checks

- Read the files CodeGraph names directly before editing. Static graph output
  can miss dynamic Next.js routes, runtime dispatch, generated paths, and
  wrapper indirection.
- Use `rg` to verify imports, route references, and string-based dispatch keys.
- Check adjacent tests and fixtures directly. Do not rely on CodeGraph
  `affected` output as the sole test-selection source.
- If CodeGraph appears stale, resync or re-index before trusting impact output.

## Verification

Run focused tests that match the impacted surfaces first. For central
orchestration/runtime changes, this usually means the relevant service,
engine/runtime, route, and UI tests rather than only the file you touched.

Then run the normal task-specific validation, such as lint, typecheck, build, or
smoke tests when the change risk justifies them. Report both tool findings and
direct verification results in the final handoff.

