# Panely Migration Checklist — 2026-04-02

## Phase 1 — Repo hygiene / boundaries
- [ ] Finish cleaning Mission Control repo noise and unrelated artifacts
- [ ] Keep Panely product changes from being mixed into Mission Control core commits
- [ ] Mark Panely-specific paths explicitly during cleanup

## Phase 2 — Product boundary confirmation
- [x] Confirm Panely = public productized Advisory Board
- [x] Confirm Mission Control may retain lighter internal advisory module
- [ ] Confirm which internal advisory capabilities must remain embedded in Mission Control
- [ ] Confirm whether shared primitives should be copied first or abstracted first

## Phase 3 — Inventory and ownership
- [x] Create separation plan doc
- [x] Create initial file inventory doc
- [x] Create Panely team handoff brief
- [ ] Produce path-by-path ownership map (Panely / Mission Control / shared / ambiguous)
- [ ] Identify naming collisions where `advisory` really means Panely product logic

## Phase 4 — Extraction prep
- [ ] Identify Panely-specific env/config/runtime requirements
- [ ] Identify Panely-specific auth/billing/profile/public pages
- [ ] Identify Panely-specific AI/router/provider logic
- [ ] Identify any Mission Control dependencies Panely currently assumes
- [ ] Decide whether extraction uses copy-first or subtree/worktree history-preserving approach

## Phase 5 — Mission Control module definition
- [ ] Define minimal internal Advisory Board module for Mission Control
- [ ] Define what UI/API/contracts Mission Control needs after Panely separation
- [ ] Remove accidental product-specific language from Mission Control where appropriate

## Phase 6 — Handoff / execution
- [ ] Send handoff package to Panely Paperclip team
- [ ] Have Panely team return migration proposal
- [ ] Create Panely repo boundary and move product code
- [ ] Leave Mission Control with clean internal module or integration point only

