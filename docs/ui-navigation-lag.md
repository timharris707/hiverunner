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

## Symptom 2 — general sluggishness (measured; root-cause hypotheses ranked)

> **Scope caveat (important):** the dev `data-dev` workspace measured here is
> **near-empty** (1 company `HIVE`, **0** projects/agents/tasks/goals). So the
> data-volume-dependent paths below were **not exercised**; "fast on empty data"
> does **not** clear a populated workspace. This is stated explicitly because an
> earlier draft over-claimed "could not reproduce general lag" — corrected here.

### What was measured (Playwright + pure-JS micro-bench)

**Navigation latency** (single soft `<Link>` click, content-change time):

| Lane | Warm soft-nav | First visit | Client long tasks (14 s idle) | Server CPU idle / RSS |
|---|---|---|---|---|
| **Production build** (`next build`) | **30–65 ms** | n/a (pre-compiled) | **0** (0 ms blocking) | ~0–1% / **251 MB** |
| **Dev lane** (`:3010`, webpack) | **300–480 ms** | **0.5–2.0 s** | **0** (0 ms blocking) | spikes to 175% / **8.6 GB** |

- No full reloads, **0 RSC failures**, 0 redirects on soft nav in either lane.
- **Client main thread is clean in both** (0 long tasks while idle on the dashboard) — so the lag is **not** client-side jank/GC.
- The dev↔prod gap (~6–10×) is **dev-mode server overhead**: webpack on-demand
  first-visit compile, unminified bundles, the React dev runtime, and dev-server
  RSC render on an 8.6 GB heap. **All of it is eliminated by `next build`** and is
  therefore **dev-only**. (Dev polls *less* than prod — 20 vs 82 req/min — so dev
  lag is not a polling-load problem.)

**Snapshot poll cost — suspect refuted by measurement.** `RealtimeProvider.pollSnapshot`
runs `JSON.parse(raw)` + a `raw.replace(/"generatedAt":"…"/, "")` every 5 s (prod).
A code comment anticipates ~1.2 MB payloads. Measuring the *exact* operations:

| Snapshot payload | `JSON.parse` | regex `replace` | total per 5 s poll |
|---|---|---|---|
| 73 KB | 0.08 ms | ~0 ms | 0.08 ms |
| 585 KB | 0.54 ms | ~0 ms | 0.54 ms |
| **1.8 MB** | **1.62 ms** | ~0 ms | **1.62 ms** |
| 4.4 MB | 4.04 ms | ~0 ms | 4.04 ms |

Even at 1.8 MB the main-thread cost is **~1.6 ms** — far below the 50 ms long-task
threshold (V8 parses fast; the non-global regex stops at the first match). So the
snapshot is **not** a client UI-thread stall. It **is** a real **network/server-load**
concern at scale: 5 s polling of a large payload (~14 MB/min) that the server
rebuilds per client via unbounded `readTasks()` + O(projects×tasks) `getProjects()`
(`src/lib/realtime-snapshot.ts`, `src/lib/projects.ts`). Actual payload on the
current empty workspace: **2.9 KB**.

### Primary forward-looking hypothesis (could NOT measure here — empty board)

The **populated task board** is the most likely real-world sluggishness and was
not reproducible (0 tasks). Code-confirmed anti-patterns:

- `TaskBoardView.tsx` is **unvirtualized** — `SortableContext items={tasks.map(t=>t.id)}`
  (dnd-kit) and `tasks.map(...)` render **every** task; `new Map(tasks.map(...))` is O(N) per render (lines 81, 82, 419).
- `TaskCard` is **not** `React.memo`'d (`export function TaskCard`, line 59).
- Each card with an **active run** mounts its own **1 s `setInterval`→`setState`**
  (`useElapsedLabel`, line 646) — N active cards ⇒ N timers ⇒ up to N re-renders/s
  through an unmemoized list.

On a board with hundreds of tasks this is a credible source of scroll/INP jank —
but it does **not** affect Rick's current (empty) lane.

### Conclusion

- **Two-click navigation bug: FIXED** (measured, dev + prod — see Symptom 1).
- **Production navigation lag: not reproduced** on the available data — prod soft-nav 30–65 ms, 0 client long tasks. The exact pages/clicks/timings are tabled above.
- **Dev-lane sluggishness Rick feels: dev-only overhead** (first-visit webpack compile + warm dev-mode server overhead), eliminated by `next build`. Not client jank (0 long tasks), not a polling-load issue (dev polls less than prod).
- **Not yet cleared at scale:** the board-rendering and snapshot network/server-load paths require a **populated workspace** to measure. The snapshot *main-thread parse* sub-hypothesis is **refuted** (≤4 ms even at 4.4 MB); the **board rendering** at scale is the top open hypothesis.

### Ranked follow-ups (deferred — narrow-fix discipline; no rewrite)

1. **Reproduce at scale first** — seed (or copy Rick's `data/`) a workspace with
   realistic task/project/agent counts, then re-run the harness capturing board
   render time, INP/scroll long tasks, and snapshot payload bytes. Required before
   any board fix. (Harness: `/tmp/perf-harness.cjs`, `/tmp/snap-bench.cjs`.)
2. **Virtualize the task board** + wrap `TaskCard` in `React.memo`, and hoist the
   per-card 1 s elapsed-time timer to one shared ticker — only if (1) confirms cost.
3. **Bound / throttle the snapshot** — cap or paginate `readTasks()`/`getProjects()`
   in the snapshot, send counts/deltas instead of full arrays, and/or
   visibility-gate the 5 s poll. Reduces ~14 MB/min and per-client server rebuild.
4. **Convert remaining plain `<a href>` internal links to `next/link`** so they
   soft-navigate instead of full-reloading (e.g. company-overview links).
5. **Dev ergonomics:** evaluate Turbopack for the dev lane to cut first-visit
   compile latency (dev-only; does not affect prod).

---

## Addendum — Rick's real-environment audit (2026-05-29): reconciliation + gateway fix

Rick ran an independent audit on his **populated, memory-pressured** install
(Node `v24.10.0`; host at ~35 GB/36 GB used; company `RIC`/`ricktest`, 26 tasks).
It **agrees with the measurements above on what is _not_ the cause**: warm backend
APIs are fast (`/api/live/snapshot` ~19 ms, live-runs ~10 ms, inbox ~16 ms), the
app process was ~0 % CPU, and the 21 MB SQLite DB is not oversized. His contributors:

**Environment (Rick's to address — not code):**
- **Host memory pressure** (≈82 MB free, ~11 GB compressed, 1.6 M swapouts) — the
  dominant local amplifier for Chromium + Next dev + image processing.
- **Unsupported Node 24** — `package.json` engines declare `node >=20 <23`; re-test
  on Node 22 LTS before treating timings as a clean baseline.

**Software-side churn (code):**
- **Gateway reconnect log-spam — FIXED here.** With the OpenClaw gateway offline,
  `gateway-stream-bridge` logged on every reconnect cycle forever → Rick saw
  **10,448** `[gateway-bridge]` log lines. Reproduced against a dead port:
  **11 lines / 20 s and unbounded → 2 lines / 20 s** after the fix (first failure +
  a periodic heartbeat ~every 20th attempt), plus **jittered** backoff. The bridge
  is a read-only `operator` client, so this does not change execution-lane ownership
  or behaviour when the gateway is up. Guard: `gateway-bridge-reconnect.test.ts`
  (`npm run test:gateway-bridge-reconnect`); pure helpers live in
  `src/lib/orchestration/gateway-reconnect.ts`.
- **Duplicate boot polling** (`/api/live/snapshot` ×2, live-runs ×2 on load) —
  ranked follow-up: consolidate live-runs/snapshot behind one shared per-company
  provider + coalesce identical in-flight requests (`src/hooks/useLiveRuns.ts`).
- **Avatar thumbnail cold cache** (~1.1–1.3 s via `sharp` on first load) — ranked
  follow-up: prewarm on agent save/startup + coalesce concurrent cold requests for
  the same avatar (`.../agents/[agentId]/avatar/route.ts`).

**Net:** Rick's dominant causes are environmental; the highest-volume *software*
churn (gateway log-spam, #2 on his list) is fixed and verified here. The board /
snapshot-at-scale and boot-polling items remain ranked follow-ups (need a populated
workspace to measure their UI impact before changing them — narrow-fix discipline).
