# Phase 2 Floating Overseer QA Checklist - 2026-06-06

Scope: floating company-scoped Overseer mini cockpit, extracted full cockpit, desktop drag/resize, mobile bottom sheet, and neutral command-center theme.

Inspected baseline:

- Full page route: `src/app/(dashboard)/companies/[slug]/overseer/page.tsx` renders `OverseerCockpit` with the route slug.
- Extracted cockpit: `src/components/overseer/OverseerCockpit.tsx` owns sessions, messages, readiness, model/reasoning controls, attachments, compaction, export, and current full-page sessions-column resize.
- App shell: `src/app/(dashboard)/layout.tsx` owns the dashboard chrome and is the likely floating mount boundary.
- Company routes use both legacy `/companies/[slug]/*` and canonical `/{companyCode}/*` paths. Dock links build canonical company paths and normalize active state between both forms.

## Selector Contract For Automation

When Phase 2 implementation lands, add stable selectors to the floating shell so the e2e skeleton can be enabled without fragile text probing:

- `data-testid="floating-overseer-launcher"`
- `data-testid="floating-overseer-panel"`
- `data-testid="floating-overseer-close"`
- `data-testid="floating-overseer-drag-handle"`
- `data-testid="floating-overseer-resize-handle"`
- `data-testid="floating-overseer-sheet"` for mobile bottom sheet mode
- `data-company-slug="<slug>"` on the open floating surface

## Manual QA Matrix

Run against at least two local companies with known slug/code pairs. Cover desktop at `1440x900` and `1024x768`, and mobile at `390x844`.

1. Launcher route visibility
- On company routes such as `/companies/<slug>`, `/companies/<slug>/dashboard`, `/companies/<slug>/tasks`, `/companies/<slug>/projects`, and `/<CODE>/dashboard`, the launcher is visible.
- The launcher is closed by default after a fresh reload. No mini cockpit panel is mounted until the operator opens it.
- On `/companies/<slug>/overseer` and `/<CODE>/overseer`, the launcher and floating panel are hidden. The full Overseer page is the only Overseer surface.
- On non-company routes such as `/login`, `/settings`, `/terminal`, `/logs`, and `/companies`, the launcher is hidden unless Phase 2 explicitly defines a company fallback.

2. Same-company persistence
- Open the launcher on one company route, select or create a session, enter an unsent draft, then navigate through Dock and in-page links within the same company.
- The floating panel stays open across same-company routes, keeps the selected session, keeps the unsent draft, and continues to call `/api/orchestration/companies/<same-slug>/overseer/...`.
- Reloading the page restores only the intended persisted state: closed launcher by default unless implementation explicitly persists open state, and company-scoped active session if stored.
- Local storage keys for floating placement, size, open state, and active session are company-scoped. No key should allow one company to read another company's active session.

3. Company switch safety
- With the mini cockpit open on company A, switch to company B from the Dock/company switcher and from a direct URL.
- The floating surface either closes or switches to company B context immediately. It must not show company A session titles, drafts, messages, attachments, workspace roots, or in-flight run state.
- Switching back to company A restores only company A state and does not mutate company B sessions.

4. Desktop drag and resize
- Drag from all corners toward and past the viewport edges. The panel clamps fully inside the visible viewport and does not disappear behind the Dock, TopBar, or mobile nav.
- Resize wider, narrower, taller, and shorter. Width/height clamp to readable minimums, cannot overflow the viewport, and do not cover the launcher in an unrecoverable way.
- Collapse/expand the Dock and resize the browser while the panel is open. The panel re-clamps without layout jumps, clipped controls, or text overlap.
- Keyboard focus remains inside dialogs/menus created by the cockpit, and close returns focus to the launcher.

5. Mobile bottom sheet
- At mobile width, opening the launcher shows a bottom sheet/full-height drawer, not the desktop floating window.
- The sheet respects safe areas, locks background scroll while open, and leaves the composer visible and usable above the software keyboard.
- The sheet can scroll long transcripts and sessions without hiding the close control or composer.
- Same-company navigation preserves mobile state according to the Phase 2 persistence contract; company switching clears/switches context safely.

6. Full page regression
- `/companies/<slug>/overseer` still renders the full extracted cockpit with page heading, chat composer, sessions list, diagnostics, model/reasoning controls, attachments, compaction controls, and export link.
- Full page and floating mini cockpit share the same active session per company where Phase 2 requires it.
- Full page mobile remains usable after the floating CSS is added; no duplicate launcher appears on the full page route.

7. Secrets and provider safety
- The floating launcher, panel, full page, tooltips, diagnostics, transcript messages, export labels, and browser-visible network payloads do not expose provider keys, secret names with values, tokens, local credential file contents, or raw env var values.
- Runtime/provider readiness may show provider names and readiness status, but not credential material.
- Sending a prompt without local provider credentials should fail with a readiness/setup state, not reveal key paths or private auth details.

8. Copy and compact labels
- There is no visible compact label `HIV` anywhere in the launcher, panel, sheet, full page, title bars, aria labels, tooltips, local storage-derived labels, or screenshots.
- Acceptable compact labels are explicit and neutral, such as `Overseer`, `HiveRunner`, company code, or an icon-only button with an accessible `Overseer` label.

9. Theme and visual fit
- The floating UI matches HiveRunner's neutral command-center style: existing surfaces, borders, text tokens, compact controls, and restrained accent use.
- Avoid marketing-style hero treatment, purple/blue gradients, oversized decorative cards, nested cards, gradient blobs, or one-note palettes.
- Text fits within buttons, tabs, title bars, session rows, model controls, and mobile sheet controls at desktop and mobile widths.
- Visual proof should include closed launcher, desktop open panel, desktop drag/resize edge case, full page route, and mobile bottom sheet screenshots.

## Automation Skeleton

Added skeleton: `e2e/overseer-floating-cockpit.spec.ts`.

Default run behavior: skipped unless explicitly enabled.

```bash
HIVERUNNER_FLOATING_OVERSEER_E2E=1 npm run test:e2e -- e2e/overseer-floating-cockpit.spec.ts --project=chromium
```

The skeleton mocks browser-visible orchestration/Overseer APIs and does not require provider keys or external services. It is expected to fail until the Phase 2 implementation adds the selector contract above.

## Integration Risks To Recheck

- Mounting in `DashboardLayout` can accidentally show the launcher on non-company routes unless pathname parsing handles both legacy and canonical routes precisely.
- Canonical `/{companyCode}/*` routes are middleware-rewritten; context code should resolve the canonical code to the persisted company slug before storing state or calling APIs.
- Reusing the full `OverseerCockpit` directly inside a constrained mini panel may bring full-page spacing, sessions-column resizing, or mobile CSS that conflicts with the floating shell.
- Shared active session per company needs an explicit state owner. Duplicating session state in full page and floating wrapper risks desync across route changes.
- Any readiness/diagnostics reuse must keep provider/key values redacted in rendered text, aria labels, screenshots, and exported client payloads.
