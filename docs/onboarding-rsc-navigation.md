# Evidence note: `/HIVE/...` dev RSC payload fallback

Status: **characterized, not fixed** (out of scope for the onboarding split).
Owner follow-up filed below. Pinned by
`src/lib/__tests__/companycode-rewrite-rsc.test.ts`.

## Symptom

In `npm run dev`, client-side (soft) navigation to short company-code URLs such
as `/HIVE/tasks`, `/HIVE/goals`, etc. intermittently logs:

```
Failed to fetch RSC payload for http://localhost:3010/HIVE/tasks. Falling back to browser navigation.
```

and performs a full browser navigation instead of a soft transition. In some
sequences this chains with a server `redirect()` and reads as a redirect loop.

## Root cause (architectural)

Short company-code URLs under `src/app/[companyCode]/...` have **no physical
page** for most sub-paths. For example there is no `src/app/[companyCode]/tasks/page.tsx`.
Those URLs are served only because `src/middleware.ts` rewrites them onto the
canonical dashboard route via `tryCanonicalRewrite()`:

```
/HIVE/tasks  --(NextResponse.rewrite)-->  /companies/hiverunner-workspace/tasks
```

The canonical destination lives under `(dashboard)/companies/[slug]/...` and can
itself call `redirect()` (slug canonicalization, or a company/slug that does not
resolve — common on a fresh install where `EDGE_ROUTE_MAPS_FALLBACK` still maps
`HIVE -> hiverunner-workspace` even though no such company exists yet).

Two App Router facts combine into the symptom:

1. A middleware `rewrite` of an **RSC navigation request** (`RSC: 1`) must
   resolve to a payload for the *requested* URL. When the rewrite target's RSC
   tree differs from what the client router expects, or
2. the rewritten page issues a `redirect()` mid-RSC-fetch,

Next cannot consume the response as an RSC payload and falls back to a hard
browser navigation — the logged message above.

This only affects **soft** (in-app `<Link>`) navigations among `/HIVE/...`
hrefs. A server-side `redirect()` to `/HIVE/tasks` (e.g. the root-route redirect
for a completed install) is a hard navigation and is **not** affected.

## Why the onboarding split is unaffected

The first-run onboarding work routes exclusively to **physical** pages:

- `/setup` — top-level physical route (outside `(dashboard)`), never rewritten.
- `/companies/new` — physical wizard page.
- `/companies/[slug]/dashboard` — canonical physical page used for the
  "Open existing workspace" action (chosen specifically to avoid the
  `[companyCode]` rewrite path).

So nothing in the new `/setup` flow depends on the `[companyCode]` rewrite, and
the characterization test asserts that `/setup` and `/companies/new` are never
rewritten/redirected by the company rewriters.

## Update — RESOLVED

Follow-up investigation found the underlying cause was more specific (and worse)
than the RSC-fallback theory above: a **hard infinite rewrite ↔ redirect loop**.
`tryCanonicalRewrite` rewrote `/{CODE}/sub` → `/companies/{canonicalSlug}/sub`,
and `tryLegacyRedirect` then redirected that **canonical** slug straight back to
`/{CODE}/sub` (Next re-runs middleware on the rewrite target), so `/HIVE/...`
returned `ERR_TOO_MANY_REDIRECTS`.

Fixed in `src/middleware.ts` by making `tryLegacyRedirect` redirect only
**non-canonical alias** slugs; the canonical slug renders. `/HIVE/...` now
returns `200` in both dev and a production build, soft navigation is a single
click, and no "Failed to fetch RSC payload" is logged.

See **`docs/ui-navigation-lag.md`** for the full before/after evidence, and
`src/lib/__tests__/middleware-canonical-redirect-loop.test.ts` for the guard.
