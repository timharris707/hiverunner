# Shared Shell Boundary Audit — 2026-04-02

Purpose: complete checklist item 2 by identifying which shell/layout/navigation pieces are true Mission Control shell concerns versus which are advisory-module affordances embedded in that shell.

## Conclusion

Mission Control should keep a single shared shell for the operator experience, but that shell must remain **module-neutral**.

That means:
- **Dock / TopBar / StatusBar** stay Mission Control-owned
- app-launch affordances that point into modules can remain in the shell
- module-specific labels, workflows, and product assumptions inside shell-level controls should be minimized or treated as optional-launch shortcuts rather than core identity
- Panely should not inherit or depend on the Mission Control shell; it should keep its own standalone shell inside `projects/panely-app/`

## Shell pieces reviewed

### Clearly Mission Control core shell
These are cross-app/operator-frame concerns and should remain in Mission Control core:
- `src/components/TenacitOS/Dock.tsx`
- `src/components/TenacitOS/TopBar.tsx`
- `src/components/TenacitOS/StatusBar.tsx`
- `src/app/(dashboard)/layout.tsx`
- `src/lib/dock-state.ts`

### Why they are core
- They frame the whole operator surface
- They provide navigation across companies, projects, tasks, agents, systems
- They carry layout chrome, active-company context, realtime/system display, and operator navigation state
- None of those should move to Panely

## Embedded module touchpoints inside the shell

### Dock module entries
`Dock.tsx` currently includes optional-module launch points in `APPS_ITEMS`:
- Ideas
- Advisory Board
- Marketing
- Trading
- Trading Floor
- Trading Terminal
- Terminal

This is acceptable **as Mission Control module navigation**, but it should not be confused with Panely product ownership.

### QuickActionBar
`src/components/QuickActionBar.tsx` currently contains:
- New Advisory Session
- View Trading
- Open Terminal

Judgment:
- still Mission Control-owned as a shell shortcut surface
- but the actions are module shortcuts, not core identity
- naming should stay internal/basic (`Advisory`) and should not drift toward Panely product semantics

### QuickActions
`src/components/QuickActions.tsx` is a system/admin quick-actions card:
- Restart Gateway
- Clear Activity Log
- View Gateway Logs
- Change Password

Judgment:
- pure Mission Control/system shell concern
- no Panely boundary issue here

## Boundary rule going forward

### Mission Control shell may contain
- links into optional modules
- quick-launch shortcuts into optional modules
- global operator context (company, navigation, logs, systems, realtime)

### Mission Control shell should not contain
- Panely customer-product framing
- billing/profile/auth assumptions for Panely
- public-product UX language that turns MC shell into Panely shell
- dependencies on `projects/panely-app/` assets or routing

### Panely should own separately
- standalone auth shell
- public product navigation
- customer profile/billing/account surfaces
- Panely-specific landing/application flows

## Key cleanup implication

The remaining mixed-shell issue is not that Dock/TopBar/StatusBar are wrongly shared.
It is that module launch points and advisory naming can blur the line between:
- internal embedded advisory in Mission Control
- public Panely product

So item 2 resolves to this decision:

> Keep one Mission Control shell, keep it module-neutral, and do not treat it as a shared shell for Panely.

That reduces ambiguity without over-extracting the shell into a fake universal layer too early.

## Handoff to item 3

Next step is repo-state verification:
- re-run `git status`
- compare audited ownership decisions with the actual dirty tree
- isolate what is architecture-relevant versus simple active implementation churn
