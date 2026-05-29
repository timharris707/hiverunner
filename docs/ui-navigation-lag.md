# UI navigation lag — investigation & fix

Investigated on the live dev lane (`:3010`, webpack) and verified against a
production build (`next build` + `node server.js`). Two symptoms were reported;
they have **different** root causes and are kept separate below.

---

## Symptom 1 — "two-click navigation" / pages reload but don't move (FIXED)

> "When I click to go to different pages it takes 2 clicks. First click does a
> full page reload but stays on the same page. Second finally goes where it's
> supposed to."

### Root cause — an infinite middleware rewrite ↔ redirect loop on company routes

`src/middleware.ts` has two rules that, together, formed a cycle:

```
tryCanonicalRewrite:  /{CODE}/sub             --(rewrite)--> /companies/{canonicalSlug}/sub
tryLegacyRedirect:    /companies/{slug}/sub   --(308)-------> /{CODE}/sub
```

Next.js **re-runs middleware on the internal rewrite target**. So a request to the
canonical code URL `/HIVE/dashboard` was rewritten to
`/companies/hiverunner-workspace/dashboard`, and that rewrite target was then
**redirected straight back** to `/HIVE/dashboard` by `tryLegacyRedirect` — forever.

The bare-path case already guarded the canonical slug; the **subpath** cases
(`/dashboard`, `/tasks`, `/agents/…`, generic) did **not** — they redirected the
canonical slug too. That asymmetry was the bug.

### Evidence (before)

| Request | Result (dev **and** prod build) |
|---|---|
| `GET /HIVE/dashboard` | `308` + `x-middleware-rewrite: …/companies/hiverunner-workspace/dashboard` + `location: /HIVE/dashboard` |
| `GET /companies/hiverunner-workspace/dashboard` | `308 → /HIVE/dashboard` |
| `curl -L /HIVE/dashboard` | **"Maximum redirects followed"** (infinite 308 loop) |
| Chromium `goto('/HIVE/dashboard')` | **`net::ERR_TOO_MANY_REDIRECTS`** (19 redirects) |
| Chromium `goto('/HIVE/tasks?view=board…')` | **`net::ERR_TOO_MANY_REDIRECTS`** |

In the browser this surfaced as Rick's two-click behavior: a soft `<Link>`
navigation issues an RSC fetch that redirect-loops → Next logs *"Failed to fetch
RSC payload"* and falls back to a hard navigation, which also loops, so the view
never advances; a later attempt (warm cache / different entry) eventually lands.

### Fix

`tryLegacyRedirect` now returns `null` when the slug is **already the canonical
slug** for its code (the rewrite target of `/{CODE}/…`). Only **non-canonical
legacy alias** slugs still redirect to the code form. One ~5-line guard, no
architecture change. See `src/middleware.ts`.

### Evidence (after)

| Request | dev `:3010` | prod build `:3099` |
|---|---|---|
| `GET /HIVE/dashboard` (DOC + RSC) | `200` (rewrite, URL preserved) | `200` |
| `GET /companies/hiverunner-workspace/dashboard` | `200` (renders at slug URL) | `200` |
| `GET /HIVE` (bare) | one clean `308 → /HIVE/dashboard` | same |
| `curl -L /HIVE/dashboard` | `final=200 redirects=0` | `final=200 redirects=0` |
| Chromium `goto('/HIVE/dashboard')`, `/HIVE/tasks` | `200`, 0 redirects | — |
| Chromium soft `<Link>` click → `/HIVE/activity` | **one click, `fullReload:false`, 68 ms warm, 0 RSC failures** | — |

Alias slugs still redirect once to the canonical code URL and then terminate
(verified). Legacy `/companies/{alias}/…` deep links keep working.

### Regression guard

`src/lib/__tests__/middleware-canonical-redirect-loop.test.ts`
(`npm run test:middleware-redirect-loop`) asserts the canonical slug is **not**
redirected (no loop), aliases still redirect once, and rewrite→legacy on the
rewrite target does not cycle.

---

## Symptom 2 — general sluggishness (characterized; see follow-ups)

Once a single click works, transitions can still feel slow. Measured with a
headless Chromium driver against the dev lane:

| Navigation | Time | Notes |
|---|---|---|
| First visit to an uncompiled route (`/HIVE/activity`, `/HIVE/tasks`) | ~1.0–2.0 s | **dev-only**: webpack on-demand route compilation |
| **Warm** soft `<Link>` nav (`/HIVE/activity`) | **~68 ms** | proper SPA transition, `fullReload:false`, 0 RSC failures |
| Click on a plain `<a href="/companies/{slug}">` link | full reload | not a Next `<Link>` → hard navigation |

**Conclusion:** the dominant first-click slowness on the dev lane is **webpack
on-demand compilation**, which does not exist in a production build (routes are
pre-compiled). Warm steady-state soft navigation is already fast (~68 ms). The
heavy dashboard shell does mount continuous background work, but it did not block
navigation in measurement (warm nav stayed ~68 ms):

- `Dock.tsx` — 4 `setInterval` pollers
- `AgentActivityPanel.tsx` — a 1 s `setNow(Date.now())` re-render ticker + 1 interval
- `RealtimeProvider.tsx` — snapshot poll (15 s; skips re-render when payload is unchanged)
- `use-event-stream.ts` — an SSE `EventSource`

`e2e/dashboard-request-count.spec.ts` already bounds steady-state request counts.

### Ranked follow-ups (not done here — narrow-fix discipline / stopping rule)

These are incremental and unproven as the *blocking* cost (warm nav is ~68 ms),
so they are intentionally deferred to a focused performance pass:

1. **Convert remaining plain `<a href>` internal links to `next/link`** (e.g. the
   company-overview links in `companies/[slug]/dashboard/page.tsx`) so they do a
   soft transition instead of a full reload. Low risk, user-visible.
2. **Gate/defer the 1 s `AgentActivityPanel` ticker** (and pause pollers when the
   tab is hidden / panel collapsed) to cut idle re-renders and background fetches.
3. **Dev ergonomics:** evaluate Turbopack for the dev lane (`NEXT_TURBOPACK=1`) to
   reduce first-visit compile latency; this is dev-only and does not affect prod.
4. Add a `webpack`-vs-`prod` click-to-interactive benchmark to the e2e suite to
   keep steady-state navigation under a threshold.
