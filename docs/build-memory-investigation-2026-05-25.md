# HiveRunner Build Memory Investigation - 2026-05-25

## Summary

The local build failure should not be fixed by raising the default heap above
12GB. The investigation found two separate issues:

1. The current 8GB build heap is too low for a clean tracked-only macOS build.
2. The first temp-build validation copied local-only artifacts and backups, so
   it was not representative of a fresh GitHub checkout.

A true tracked-only archive build passes at 12GB on Node 20, Node 22, and the
local Node 25 runtime. The smallest real fix is to keep public onboarding on
Node LTS, make build validation use a tracked-only checkout/worktree, and only
then raise the build heap default to 12GB with explicit documentation.

## Environment

- Repo: `/Users/timharris/.mission-control/app`
- Branch tested: `codex/build-memory-config`, based on `main` after PR #29 and
  PR #30 were merged.
- Local Node: `v25.9.0`
- npm: `11.12.1`
- Machine memory: `128GB`
- CI workflow: `.github/workflows/ci.yml` uses Node `20` and `npm run build`.

## Size Findings

Current local working directory:

| Path | Size | Notes |
| --- | ---: | --- |
| repo working directory | 12GB | Includes local-only artifacts and backups. |
| tracked files | 31.9MB | `git ls-files` content only. |
| `.next` | 319MB | Local build output/cache. |
| `data` | 836MB | Local operational data; ignored except safe examples. |
| `data-dev` | 1.8GB | Local dev DBs/backups; ignored. |
| `output` | 2.2GB | Generated validation artifacts; ignored. |
| `.stable.backup-20260519T144702Z` | 1.5GB | Ignored stable backup. |
| `.next_backup_20260330_1919` | 929MB | Ignored local backup. |
| `.claude` | 668MB | Ignored local worktrees. |
| `pipecat-server` | 609MB in local tree | Tracked project files are small; local `.venv` drives size. |

The local artifact directories are mostly ignored already, but a temp build
created by `rsync ./ /tmp/...` still copies ignored directories unless they are
explicitly excluded. That was the cause of the misleading 16GB OOM result.

## Build Matrix

All successful comparisons used a true tracked-only archive:

```sh
git archive HEAD | tar -x -C "$TMP"
ln -s /Users/timharris/.mission-control/app/node_modules "$TMP/node_modules"
```

| Runtime | Heap | Result | Time | Max RSS |
| --- | ---: | --- | ---: | ---: |
| Node 20.20.2 | 8GB | OOM | 3m45s | ~10GB RSS before abort |
| Node 20.20.2 | 12GB | Pass | 38.86s | 2.8GB |
| Node 22.22.3 | 12GB | Pass | 38.76s | 3.7GB |
| Node 25.9.0 | 12GB | Pass | 28.73s | 3.9GB |

The Node 25 runtime is not the root cause when the input tree is clean. It
passes the tracked-only build at 12GB. The bad Node 25 and Node 20 failures came
from polluted temp copies plus too-low heap settings.

## Build Output

Tracked-only build output is consistent across Node 20, 22, and 25:

| Output | Size |
| --- | ---: |
| `.next` | 794MB |
| `.next/cache` | 757MB |
| `.next/server` | 16MB |
| `.next/static` | 4.9MB |
| `.next/trace` | 12-13MB |

The large output is overwhelmingly webpack cache:

- `.next/cache/webpack/server-production/0.pack`: ~478MB
- `.next/cache/webpack/client-production/0.pack`: ~152MB
- `.next/cache/webpack/server-production/index.pack`: ~83MB
- `.next/cache/webpack/edge-server-production/0.pack`: ~32MB

## Tracing And Contributors

The Next trace shows this is a broad App Router build rather than one oversized
asset:

- 74 `page.tsx` files.
- 214 API route handlers.
- 305 `src/app` TypeScript/TSX files.
- 881 total `src` TypeScript/TSX files.

Top package/module contributors by trace module-event count:

| Contributor | Events |
| --- | ---: |
| `next` | 807 |
| `lucide-react` | 655 |
| `date-fns` | 142 |
| `mdast-util-to-markdown` | 96 |
| `zod` | 76 |
| `@supabase/auth-js` | 72 |
| `mdast-util-to-hast` | 58 |
| `@supabase/realtime-js` | 48 |
| `micromark-core-commonmark` | 46 |
| `@supabase/ssr` | 44 |

Largest compiled app/source files by disk size:

- `src/app/(dashboard)/companies/[slug]/inbox/page.tsx`: 192KB
- `src/app/(dashboard)/companies/[slug]/tasks/[taskKey]/page.tsx`: 172KB
- `src/app/(dashboard)/companies/[slug]/memory/page.tsx`: 120KB
- `src/app/(dashboard)/companies/[slug]/agents/[agentId]/configuration/page.tsx`: 108KB
- `src/app/(dashboard)/companies/[slug]/goals/page.tsx`: 104KB

Slow trace phases:

- `add-entry`: dominant cumulative cost because every route entry receives the
  full normalized route list.
- `run-webpack` / `run-webpack-compiler`: around 25-26 seconds in the clean
  Node 25 build.
- `node-file-trace-build`: around 2.5 seconds; not the dominant memory issue.

## Inclusion Check

Tracked-only archive builds do not include local runtime directories, generated
artifacts, or backups. The polluted rsync temp copies did include enough
local-only material to create misleading OOMs:

- `output/`
- `data-dev/`
- `.stable.backup-*`
- `.next_backup_*`
- `.claude/worktrees`
- local `pipecat-server/.venv`

The working `.gitignore` already excludes most of these classes. The safer
validation rule is operational: use `git archive`, `git worktree`, or a fresh
clone for build validation. Do not use broad `rsync ./` unless it is
git-aware/exclude-aware.

## Recommendation

Smallest real fix:

1. Add a repo-local build validation helper that creates a tracked-only temp
   tree using `git archive` or `git worktree`, then runs `npm run build`.
2. Raise the default build heap from 8GB to 12GB, not higher, because a clean
   tracked-only tree proves 12GB passes on Node 20, 22, and 25.
3. Update README/two-lane docs to say local production builds can require up to
   12GB heap and should be run on Node LTS 20/22 for public onboarding.
4. Do not make 16GB the default. It was only a temporary diagnostic workaround
   against a polluted temp tree.

Follow-up optimization candidates, separate from the build-memory config PR:

- Reduce route count or split rarely used/internal routes out of the core app
  surface.
- Audit `lucide-react` import patterns to ensure icons remain tree-shaken.
- Split the largest dashboard pages into smaller server/client modules.
- Investigate whether webpack cache can be disabled or redirected for the
  lightweight public CI build if cache size becomes a CI artifact problem.

## Commands Used

```sh
du -sh . .next .next/cache .next/server data data-dev output node_modules
git ls-files | wc -l
git ls-files | sed 's#^#./#' | xargs -n 200 du -sk
git archive HEAD | tar -x -C "$TMP"
ln -s /Users/timharris/.mission-control/app/node_modules "$TMP/node_modules"
npx -y -p node@20 node --max-old-space-size=12288 ./node_modules/next/dist/bin/next build --webpack --experimental-build-mode compile
npx -y -p node@22 node --max-old-space-size=12288 ./node_modules/next/dist/bin/next build --webpack --experimental-build-mode compile
node --max-old-space-size=12288 ./node_modules/next/dist/bin/next build --webpack --experimental-build-mode compile
```
