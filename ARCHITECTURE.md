# Mission Control Architecture

_Last updated: 2026-04-02_

## Purpose

This is the canonical architecture document for Mission Control.

Use it to answer:
- what belongs in Mission Control core
- what should be an optional module
- what should live as a standalone product/repo
- how to think about product/repo boundaries during future development and cleanup

If future sessions are unsure where code belongs, this file is the first place to check.

## Architecture layers

Mission Control is structured in **three layers**:

1. **Core**
2. **Optional modules**
3. **Standalone products**

### 1) Mission Control Core

Mission Control core is the orchestration and operations spine.

It includes:
- companies / org / agents / tasks / projects
- sessions / runs / workflows / system / settings
- orchestration APIs and data model
- runtime/admin/deployment tooling
- local dev/stable lanes, watchdogs, release flow

**Rule:** if a feature is required for Mission Control to function as an AI operating system / orchestration surface, it belongs in core.

### 2) Optional Modules

Optional modules are useful capabilities that may ship with Mission Control, but are **not** part of its irreducible core.

Current likely optional modules:
- Advisory Board (internal/basic version)
- Ideas
- Marketing
- Trading Floor

**Rule:** if a feature is valuable inside Mission Control but could reasonably be installed, omitted, or separated later, treat it as a module — not as core.

### 3) Standalone Products

Standalone products are products with their own identity, roadmap, packaging, and likely their own repository.

Current standalone product:
- **Panely** — the public productized version of the Advisory Board

Potential future standalone products:
- Trading product
- Ideas product
- Marketing product

**Rule:** if something has its own public product story, customers, website, pricing, or dedicated team, it should be evaluated as a standalone product rather than living indefinitely inside Mission Control.

## Panely vs Advisory Board

This distinction is important and permanent unless explicitly changed.

### Panely
- public-facing product
- productized version of the Advisory Board
- standalone product boundary
- should not be treated as just another Mission Control tab forever

### Advisory Board (inside Mission Control)
- lighter internal/basic advisory capability
- optional module inside Mission Control
- not necessarily the full Panely product

**Working rule:**
If code is public-product-specific, customer-facing, billing/auth/profile oriented, or tied to Panely’s standalone roadmap, it should trend toward Panely ownership rather than Mission Control core.

## Product boundary rules

When adding or cleaning up code, ask these questions in order:

1. Is this required for Mission Control core orchestration/admin behavior?
   - If yes → **Core**
2. Is this a useful but non-essential capability inside Mission Control?
   - If yes → **Optional module**
3. Is this really part of a separate product with its own identity/roadmap?
   - If yes → **Standalone product**

If unsure, default to **module** instead of bloating core.

## Current structural guidance

### Mission Control core candidates
- `src/app/api/orchestration/`
- `src/lib/orchestration/`
- company / project / task / agent / session / system surfaces
- release/runtime scripts and local service tooling

### Optional module candidates
- `src/app/(dashboard)/advisory/`
- `src/app/(dashboard)/ideas/`
- `src/app/(dashboard)/marketing/`
- `src/app/(dashboard)/trading/`
- related non-core APIs/components/libs for those areas

### Panely standalone product candidates
- `projects/panely-app/`
- Panely-specific auth/billing/profile/public-product code
- Panely product UX and product-specific AI/router/provider logic

## Repository hygiene rules

- Mission Control must **not** become a junk drawer for every product Tim is building.
- Do not commit Panely product work as if it were Mission Control core.
- Prefer coherent commits aligned to architectural boundaries.
- Separate generated artifacts from real source changes before making architecture decisions.
- When a capability looks product-shaped, ask whether it should become a module or separate repo.

## Current supporting docs

See also:
- `docs/panely-mission-control-separation-plan-2026-04-02.md`
- `docs/panely-mission-control-file-inventory-2026-04-02.md`
- `docs/panely-team-handoff-brief-2026-04-02.md`
- `docs/panely-migration-checklist-2026-04-02.md`
- `docs/repo-boundary-audit-2026-04-02.md`
- `docs/two-lane-runtime.md`

## Operating principle

**Mission Control core should stay lean, legible, and product-coherent.**

Everything else should be consciously treated as:
- a module,
- a temporary embedded capability,
- or a separate product.

That choice must be made intentionally — not by accident through git drift.
