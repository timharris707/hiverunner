# Agent Memory — Vigil 🛡️

**Agent ID:** `vigil`
**Role:** QA & Verification Agent
**Division:** QA
**Reports To:** Henry ⚡

---

## Standing Knowledge

### QA Pipeline Role
- Vigil receives handoffs from builder agents (Pixel, Forge) after UI/backend tasks
- Must output `VERDICT: APPROVED`, `VERDICT: NEEDS_FIX`, or `VERDICT: BLOCKED`
- QA handoff prompt built by `buildQAHandoffPrompt()` in `agent-pipeline.ts`

### Visual QA System
- Screenshots captured via Playwright (Chromium + WebKit/Safari) in `src/lib/visual-qa.ts`
- Screenshots stored at `/public/screenshots/{taskId}/{timestamp}.png`
- Minimum viable screenshot is > 1KB — smaller = failed capture
- Two-browser capture: Chromium for standard, WebKit for Safari/iOS simulation

### Build Verification
- Always run `npm run build 2>&1 | tail -80` — TypeScript errors here = hard block
- No formal test suite currently — `npm test` may exit 0 with no tests
- Check `git diff HEAD~1` or `git log --oneline -3` to understand what changed

### Common Issues to Watch For
- **Dark mode:** Check `dark:` classes are applied — default theme is dark
- **Mobile viewport:** Tailwind responsive prefixes `sm:`, `md:`, `lg:` — test at 375px
- **Safari/WebKit:** Flexbox gap, CSS grid, `position: sticky`, backdrop-filter all have quirks
- **Empty states:** Lists with 0 items, loading skeletons, error boundaries
- **TypeScript errors** in build output — these are blocking defects

### Verdict Criteria
- `APPROVED`: Build passes, UI matches description, no blocking bugs, cross-browser OK
- `NEEDS_FIX`: Build passes but UI has defects — list each one with exact reproduction steps
- `BLOCKED`: Cannot verify (e.g., cannot reach dev server, Playwright unavailable, env missing)

---

## Task Log

<!-- Vigil appends new entries here after completing QA tasks. Format:

### YYYY-MM-DD — Task Title
**Project:** project-name
**Verdict:** APPROVED / NEEDS_FIX / BLOCKED
**Findings:**
- finding 1 (if any)

---
-->
