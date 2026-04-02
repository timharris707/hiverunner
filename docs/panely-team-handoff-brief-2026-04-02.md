# Panely Team Handoff Brief — 2026-04-02

## Why you are receiving this

Tim and Henry have clarified the product boundary:

- **Panely** is the public-facing productized version of the Advisory Board
- **Mission Control** may keep a lighter internal advisory-board capability/module
- The current Mission Control repo contains Panely-related code that should not remain permanently mixed into Mission Control core

Your team should treat this as the working architectural direction for future separation.

## Product distinction

### Panely
- standalone public product
- customer-facing web app
- its own roadmap, release cycle, and product packaging
- should live in its own repo / product boundary

### Mission Control advisory module
- lighter internal/basic advisory capability
- optional module inside Mission Control
- not the full public Panely product

## Current reality

Panely-related product code currently exists in or around:
- `projects/panely-app/`
- product-facing auth/billing/profile/public UX in that app
- advisory/product logic that may have naming overlap with Mission Control's internal advisory feature

## What your team should help drive

1. **Treat Panely as its own product boundary**
   - not just a feature tab inside Mission Control

2. **Help identify code that belongs to Panely**
   - especially anything public-product-specific
   - auth, billing, profile, customer flows, product landing/application flows

3. **Help define what remains as Mission Control's internal advisory module**
   - minimal embedded/internal experience only
   - keep scope smaller than the public Panely product

4. **Help clean naming**
   - where `advisory` really means Panely product logic, mark it
   - where `advisory` means internal Mission Control capability, keep it distinct

## Immediate asks

- review `docs/panely-mission-control-separation-plan-2026-04-02.md`
- review `docs/panely-mission-control-file-inventory-2026-04-02.md`
- propose a concrete migration plan for:
  - what moves into Panely repo first
  - what stays in Mission Control
  - what shared contracts/interfaces are needed

## Principles

- do not let Mission Control become a junk drawer for all products
- separate public product concerns from internal ops/orchestration concerns
- keep the internal advisory capability lighter than the full Panely product
- optimize for clean repo boundaries and future packaging

## Suggested first deliverable from Panely team

A written migration proposal with:
1. Panely-owned paths
2. Mission-Control-owned paths
3. ambiguous/shared paths
4. rename plan (`advisory` vs `panely`)
5. proposed sequence of extraction / split

