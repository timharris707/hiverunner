# HiveRunner - Share-Readiness Status

> **Last updated:** May 25, 2026
> **Source:** Production-readiness audit (May 18) + live instance inspection (May 22) + share-readiness auth merge (May 24) + local-first boundary audit (May 25)
> **Branch:** `main`

---

## The Goal

Get HiveRunner ready to share with external users: other operators, teams, and eventually open-source users. The audit below identifies every gap between "works on one local machine" and "safe to give someone else a URL."

---

## Engine Decomposition (INS-G006) — foundation work

Before tackling the audit items, the engine refactor must land. A decomposed engine is easier to reason about for auth, scaling, and DB migration.

### Done ✅
- INS-G006 is closed on the board.
- engine.ts baseline → current: 8,388 → 1,330 LOC.
- 16 modules now live under `src/lib/orchestration/engine/`.
- Sprint 4 extracted run-continuation, comment-import, circuit-breaker, and query helpers.
- Cycle gate passed for the engine subtree, all 38 orchestration scripts passed, and production build passed.
- Design doc: `docs/orchestration-engine-decomposition.md`
- Closure evidence: captured in the local INS-92 decomposition evidence bundle.

---

## Production-Readiness Audit (May 18)

### BLOCKERS (6) — "Deploy and break" items

**B1. No authorization, just authentication**
`/api/orchestration/*` must enforce company ownership instead of trusting a
forged `?company=` parameter.
- **Status: ADDRESSED** ✅
- Owner scoping is enforced through request auth helpers and company query
  paths. Regression coverage lives in
  `src/lib/__tests__/orchestration-company-owner-authorization.test.ts` and
  `src/lib/__tests__/orchestration-company-owner-filtering.test.ts`.

**B2. Open self-serve signup**
`/login` exposed `supabase.auth.signUp` directly. "Invite-only" was UI text only.
- **Status: ADDRESSED** ✅ — `fix(auth): close public auth bypasses` (3e09139d) added hardcoded 403 on `/api/auth/signup` for all HTTP methods
- **Follow-up cleanup:** Login page no longer calls Supabase client signup; the
  explicit disabled `/api/auth/signup` route remains as a server-side guard.

**B3. Dual auth legacy cookie path**
The old single-password cookie path has been removed from the active login
flow. Regression coverage now verifies that the legacy cookie is not accepted
as an auth bypass.
- **Status: ADDRESSED** ✅

**B4. Localhost auth bypass**
`src/middleware.ts:415` — all auth skipped when Host starts with `localhost`/`127.0.0.1`.
- **Status: ADDRESSED for default behavior** ✅
- Default loopback protected-route requests require real auth and return 401 without a valid session or API key.
- Local development can explicitly opt into bypass with `MC_REQUIRE_LOCAL_DEV_AUTH=0`; this is development-only and disabled by default. The legacy `MC_LOCAL_DEV_AUTH_BYPASS=1` flag has been removed.
- Remaining work: final INS-G011 release packet/sign-off should capture HTTP proof and commit hashes.

**B5. Single-process assumptions baked in**
Engine tick in `server.js`, in-memory rate limiter, `globalThis` caches. Can't horizontally scale.
- **Status: BOUNDARY DOCUMENTED, ARCHITECTURE NOT ADDRESSED**
- Share-readiness improvement: `docs/local-first-boundary.md`, README, and
  operations docs now state the supported one-execution-owner local runtime,
  and public CI no longer implies a hosted preview provider is required.
- Remaining blocker for hosted deployment: distributed engine ownership,
  process-independent event fanout, and external scheduler/queue semantics.

**B6. SQLite as primary store**
200+ migrations on one file, 5s busy timeout. Lock contention at 5+ concurrent users. No Postgres path even though Supabase is present.
- **Status: BOUNDARY DOCUMENTED, ARCHITECTURE NOT ADDRESSED**
- Share-readiness improvement: public docs now explain that SQLite is the
  supported local store under `MC_DATA_DIR`, not a multi-tenant hosted data
  layer, and include backup/concurrency guidance.
- Remaining blocker for hosted deployment: Postgres-backed orchestration state,
  migration tooling, hosted workspace/artifact storage, and tenant-aware
  operational safeguards.

---

### HIGH (6)

- **H1:** Hardcoded personal workspace path — **ADDRESSED** via `MC_WORKSPACE_ROOT`
- **H2:** Supabase outage → silent fallback to legacy shared-password auth — **ADDRESSED**
  Hosted auth now fails closed when Supabase session verification, callback
  exchange, or hosted auth configuration fails. Protected requests are denied or
  redirected to `/login`; they do not fall back to local-single-user, legacy
  `mc_auth`, or shared-password auth. Regression coverage lives in
  `src/lib/__tests__/auth-hosted-fail-closed-logging.test.ts`.
- **H3:** No CSRF protection on POST routes (`sameSite: lax`) — **ADDRESSED**
  State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) now pass through a
  shared middleware CSRF guard. Browser-cookie mutations must carry a same-origin
  `Origin` or `Sec-Fetch-Site: same-origin` signal; valid API-key/token traffic
  and explicit development auth bypasses remain compatible. Regression coverage
  lives in `src/lib/__tests__/csrf-protection.test.ts`.
- **H4:** Service-role key used in `createAdminClient` with no audit trail — **ADDRESSED**
  Supabase service-role usage is limited to the loopback local-dev hosted-mode
  provisioning path. `createAdminClient` now requires an explicit privileged
  operation context, fails closed when the service-role key is absent, and emits
  structured `[security]` audit markers for admin-client creation plus
  `auth.admin.*` operations. Regression coverage lives in
  `src/lib/__tests__/auth-local-dev-session-route.test.ts`.
- **H5:** Health endpoint calls Anthropic on every request — DoS amplifier — **ADDRESSED**
  `/api/health` now checks only local process and orchestration DB readiness.
  `/api/hiverunner/health` remains the local watchdog endpoint. Provider and
  runtime readiness stay in optional runtime inventory surfaces, not basic
  health.
- **H6:** No structured logging / Sentry / APM / metrics — **PARTIALLY ADDRESSED**
  HiveRunner now has a lightweight structured console logging helper with
  stable `[api]` and `[security]` channels, redaction of sensitive fields, and
  explicit auth/CSRF/admin-operation markers. Full hosted observability
  (Sentry/APM/metrics/alerting) remains deferred.

---

### MEDIUM (6)

- **M1:** Retired external bridge dependency leaked into request-time paths — **ADDRESSED**
  Active runtime/provider, settings, bridge, docs, env, and UI surfaces now use
  HiveRunner-native local runtime paths. Historical SQLite compatibility fields
  remain only so existing local databases continue to open safely.
- **M2:** Supabase env vars not in `.env.example` — **ADDRESSED**; Supabase is documented as optional and explicit
- **M3:** No hosted deploy story — **BOUNDARY DOCUMENTED**; default public CI
  is local-first and no hosted preview provider is required.
- **M4:** Database bootstrap requires hidden `DEFAULT_COMPANY_ID` seed — **ADDRESSED for fresh local boot**
  Isolated data now gets a neutral `HIVE` workspace, and the existing
  create-company flow includes starter team templates so a new local operator
  can create a useful workspace without hidden seed knowledge.
- **M5:** CLI-binary probes (`codex`/`claude`/`gemini`) need binaries on server — **ADDRESSED FOR SHARE-READINESS**
  - Runtime CLIs and provider keys are classified as optional in `README.md`
    and `docs/runtime-dependencies.md`.
  - `/runtime-inventory` now receives an explicit runtime dependency readiness
    list, so missing optional CLIs can show as degraded/missing without
    implying local boot is broken.
  - Remaining future work: a guided runtime setup wizard with provider-doc
    links; do not auto-install CLIs or enroll paid accounts.
- **M6:** No RBAC, no roles, no audit log — **NOT ADDRESSED**

---

## Summary

| Category | Total | Done | In Progress | Not Started |
|---|---|---|---|---|
| BLOCKER | 6 | 4 (B1, B2, B3, B4 default behavior) | 2 boundary-documented (B5, B6) | 0 for share-readiness; 2 deferred for hosted scale |
| HIGH | 6 | 5 (H1, H2, H3, H4, H5) | 1 partial (H6-lite) | 0 |
| MEDIUM | 6 | 3 (M2, M4 fresh local boot, M5 share-readiness clarity) | 0 | 3 |

**Next priority order:** remaining HIGH items -> future hosted architecture plan for B5/B6 when HiveRunner is ready to become a multi-user hosted service.
