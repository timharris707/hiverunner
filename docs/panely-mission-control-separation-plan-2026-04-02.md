# Panely / Mission Control Separation Plan — 2026-04-02

## Decision

**Panely is the public productized version of the Advisory Board.**

That means we should stop treating `advisory` code inside Mission Control as if it is automatically part of Mission Control core.

We now distinguish between:

1. **Panely (standalone product)**
   - Public-facing product/app
   - Own repo
   - Own Paperclip company/team
   - Can evolve faster, with its own roadmap and release cycle

2. **Advisory Board module (Mission Control internal component)**
   - Internal/basic version embedded in Mission Control
   - Optional module, not Mission Control core
   - May reuse concepts and selected primitives from Panely
   - Should not drag the full Panely product into Mission Control

## Mission Control Core vs Optional Modules

### Mission Control Core
These belong in Mission Control core:
- orchestration
- companies / org / agents / tasks / projects
- sessions / runs / system / settings
- local runtime, stable/dev lanes, deployment/admin surfaces

### Optional Mission Control modules
These are **not core** and should be treated as optional modules:
- Advisory Board (internal/basic)
- Ideas
- Marketing
- Trading Floor

### Standalone products
These should be evaluated as standalone products/repos:
- **Panely** (public advisory-board product)
- potentially Trading product later
- potentially Ideas product later

## Working rule going forward

**Mission Control must not be a junk drawer for every app/product Tim is building.**

When adding features, ask:
1. Is this Mission Control core?
2. Is this an optional module?
3. Is this actually a standalone product and should live elsewhere?

## Current repo reality

The current Mission Control repo contains:
- Mission Control orchestration/core work
- internal advisory-board implementation
- Panely-related source under `projects/panely-app/`
- docs/specs/screenshots/tests spanning multiple workstreams

This is useful for rapid iteration, but it is not a clean long-term architecture.

## Source boundary guidance

### Keep in Mission Control
- internal orchestration APIs and schemas
- task/project/company/agent UIs
- system/runtime/admin controls
- optional lightweight internal advisory module only if we explicitly want it embedded

### Move to Panely repo
- `projects/panely-app/` as the primary product codebase
- Panely-specific auth/billing/profile/public product pages
- Panely-specific AI routing/providers if not needed by Mission Control core
- Panely product docs/specs that are not needed for Mission Control operation

### Keep only as thin integration in Mission Control
- links/launch points to Panely
- possibly an embedded/internal advisory experience with reduced scope
- shared contracts only where truly needed

## Proposed migration sequence

1. **Finish cleaning Mission Control repo**
   - separate junk artifacts from real source
   - commit coherent Mission Control changes

2. **Inventory Panely-specific source**
   - primarily `projects/panely-app/`
   - identify any Panely/product logic accidentally mixed into Mission Control root

3. **Create Panely handoff package**
   - architecture summary
   - file/path inventory
   - what should move vs stay
   - rename guidance (`advisory` vs `panely`)
   - shared-contract notes if Mission Control keeps internal advisory module

4. **Stand up dedicated Panely repo if not already isolated enough**
   - migrate product code there
   - keep Mission Control integration points minimal

5. **After split, revisit optional modules**
   - Ideas
   - Marketing
   - Trading Floor
   - decide module vs standalone direction for each

## Handoff requirements for the Panely team

When we brief the Panely Paperclip company, they need:
- the product boundary decision above
- exact paths that belong to Panely today
- naming cleanup instructions
- what functionality should remain inside Mission Control as the lighter internal advisory module
- what contracts/integration points still matter after the split

## Initial likely Panely-owned areas

These strongly look Panely-owned or Panely-adjacent:
- `projects/panely-app/`
- public auth/profile/billing/product pages in that app
- advisory session/product UX that is intended for the public product
- Panely-specific AI/router/provider code

## Initial likely Mission Control-owned areas

These strongly look Mission Control-owned:
- `src/app/(dashboard)/...` orchestration and admin surfaces
- `src/app/api/orchestration/...`
- company/project/agent/task/session infrastructure
- runtime scripts / stable lane / watchdog / release tooling

## Naming guidance

- **Panely** = public product name
- **Advisory Board** = internal/general capability name
- Inside Mission Control, prefer language that signals internal module rather than public product confusion
- During migration, document every place where `advisory` should stay internal vs where it really means Panely product logic

## Next execution step

Create a concrete file inventory mapping:
- Mission Control core
- Mission Control optional module
- Panely standalone product
- ambiguous / needs decision

