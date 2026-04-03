# Session Hardening Checklist — 2026-04-02

Status: Approved by Tim to proceed through items 1–15 without additional permission unless blocked by a real stopper needing a decision.

## Approved execution sequence

- [x] 1. Continue with Panely-owned work in `projects/panely-app/`
  - Separate clearly Panely-specific routes, components, docs, and assets
  - Tighten product boundaries so Panely stops leaking into Mission Control
  - Move or mark files that obviously belong to the standalone product
  - Completed via `docs/panely-owned-work-audit-2026-04-02.md`

- [x] 2. Handle mixed/shared shell pieces
  - Identify shared shell/layout/nav bits that still blur MC vs Panely
  - Decide what stays in MC core, what becomes optional module material, and what should migrate out
  - Reduce product-boundary ambiguity
  - Completed via `docs/shared-shell-boundary-audit-2026-04-02.md`

- [x] 3. Re-run `git status`
  - Inspect actual repo state after cleanup
  - Verify real changes vs dirty/generated noise
  - Spot accidental edits and lingering cross-boundary files

- [x] 4. Re-check release/rollback flow once the repo is cleaner
  - Verify stable/dev lane assumptions still hold
  - Sanity-check promotion flow and rollback path
  - Confirm cleanup work did not break stable lane bookkeeping

- [x] 5. Audit `projects/mission-control-app/ARCHITECTURE.md` against reality
  - Ensure canonical architecture doc matches actual codebase and ownership boundaries
  - Call out drift, lies, and vague sections
  - Tighten the doc into a reliable build reference

- [x] 6. Produce a concrete boundary map
  - List MC core / MC optional modules / Panely standalone ownership
  - Note ambiguous files and ownership decisions
  - Create a keep / move / split / delete view

- [x] 7. Finish repo hygiene pass
  - Remove or quarantine generated/runtime artifacts still polluting the tree
  - Isolate docs-only changes from product code changes where possible
  - Reduce commit noise and release fragility

- [x] 8. Inspect mixed imports and cross-product coupling
  - Find where MC imports Panely-ish code or vice versa
  - Identify shared components needing extraction, duplication, or reassignment
  - Document the worst architectural knots
  - *Result:* No cross-imports found. Code is cleanly duplicated across `projects/panely-app/src` and `src`. No coupling exists.

- [x] 9. Check stable lane integrity in practice
  - Confirm stable on 3001 behaves like a real protected lane
  - Verify logs, pid handling, health behavior, and release metadata
  - Identify anything still fragile or fake

- [x] 10. Check dev lane fragility separately
  - Confirm 3000 can stay messy without poisoning stable
  - Inspect lockfile / PID / watchdog failure modes
  - Define what needs hardening vs what can remain intentionally rough
  - *Result*: Hardened `start_dev_service.sh` and `stop_dev_service.sh` to clear stale `.next/dev/lock` files.

- [x] 11. Review release artifacts and naming
  - Validate tag/release naming consistency
  - Confirm rollback target selection is sane
  - Ensure promotion history is understandable at a glance
  - *Result*: Tag naming (`stable/YYYYMMDDThhmmssZ-shortcommit`) and history tracking (`.json` + `current.env`) are robust and sane.

- [x] 12. Decide whether shared shell code should become a real shared layer
  - If yes: define it cleanly
  - If no: force separation intentionally
  - Record the decision because it drives future cleanup speed
  - *Decision:* **No.** Force separation intentionally. We duplicated `AdvisoryPDFExport.tsx` and the shell components rather than creating a tangled cross-repo dependency. MC Core and Panely will evolve their UIs independently.

- [ ] 13. Prepare the next clean commit set
  - Group remaining work into sensible commits
  - Avoid giant misc-cleanup sludge commits
  - Leave the repo in shape for boring promotions

- [ ] 14. Run a final reality check
  - `git status`
  - Confirm architecture docs still match
  - Confirm stable/dev flow still works
  - List unresolved disputes clearly

- [ ] 15. Decide the next phase
  - Continue Panely extraction, or
  - Return to MC shell/module cleanup, or
  - Harden release tooling further, or
  - Start the next product-facing build on the cleaner base

## Reporting protocol
- Check items off as completed
- Only pause for Tim if there is a real blocker, ambiguity requiring product judgment, or a risky/destructive action
- Otherwise proceed straight through the list
