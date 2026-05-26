# Authentication

HiveRunner ships two auth modes so the same codebase can run as a private
local-first install (cloned from GitHub, no external services) or as a hosted
multi-user deployment.

| Mode               | When it's picked                              | Identity                             | External services |
|--------------------|-----------------------------------------------|--------------------------------------|-------------------|
| `local-single-user`| Default unless `MC_AUTH_MODE=supabase` is set | Hardcoded local owner                | None              |
| `supabase`         | Explicit `MC_AUTH_MODE=supabase`              | Supabase users (email / Google OAuth)| Supabase          |

The mode is resolved at request time by `getAuthMode()` in
`src/lib/auth/auth-mode.ts`:

1. If `MC_AUTH_MODE` is set, use it (`local-single-user` or `supabase`).
2. Otherwise pick `local-single-user`, even if optional Supabase env vars are
   present.

## Local-single-user mode (default for GitHub installs)

This is the "clone the repo, `npm install`, `npm run dev`, done" path.

What happens:

- The Next.js middleware always sees a synthetic owner user
  (`id: "local-owner"`, email configurable via `MC_LOCAL_OWNER_EMAIL`).
- No Supabase client is constructed and no `auth.getUser()` call is issued.
- The `/login` page detects the missing Supabase env and renders a
  "Continue as owner" card instead of the multi-user login form. Clicking it
  posts to `/api/auth/local-dev/session`, which sets the
  `mc_local_dev_session` cookie and returns the owner identity.
- `/api/auth/logout` clears all session cookies; the next request still gets
  the synthetic owner (you can't actually log out of a single-user install).
- `/auth/callback` short-circuits to the destination URL (no OAuth exchange).

**Security model.** Local-single-user mode is designed for a trusted local
environment: your own laptop or a private machine behind a VPN/Tailscale.
**Do not expose a local-single-user install to the public internet.**
Anything that reaches the host is treated as the owner.

Protected mutation routes are still defended by:

- `MC_API_KEY` — required on `/api/orchestration/*` calls from agents and
  external automations that are not on exact loopback. Set this to a long
  random secret in any install that runs autonomous agents from outside the
  local machine. Exact loopback requests in `local-single-user` mode resolve
  as the local owner so local agents and `curl http://127.0.0.1:3010/...`
  keep working without Supabase.
- Loopback policy — `/api/auth/local-dev/session` rejects requests whose
  `Host:` header is not `localhost` / `127.0.0.1` / `::1`.
- `NODE_ENV=development` + the explicit `MC_REQUIRE_LOCAL_DEV_AUTH=0` opt-in
  for the all-routes loopback bypass used by E2E suites. The legacy
  `MC_LOCAL_DEV_AUTH_BYPASS=1` flag has been removed; outside `development`
  the bypass cannot be enabled.

## Supabase mode (hosted deployments)

This is the multi-user mode used in production deployments. Required env:

```env
MC_AUTH_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # optional; required only for audited admin provisioning paths
```

What happens:

- The middleware loads the Supabase session for every protected route and
  redirects unauthenticated users to `/login`.
- `/login` renders the email/password + Google OAuth form.
- `/auth/callback` exchanges the OAuth code for a Supabase session.
- `/api/auth/logout` calls `supabase.auth.signOut()` and clears the session
  cookie.
- `/api/auth/local-dev/session` remains available for loopback E2E test
  bootstrap; it provisions or signs in an admin-owned dev user via the
  service-role key when loopback auto-provisioning is explicitly requested.
  Service-role operations go through `createAdminClient` with an operation
  reason and emit structured `[security]` audit markers without secrets.

Signup is admin-provisioned only — the public `/api/auth/signup` endpoint
returns 403 by design.

## Switching modes

Because each request resolves its mode independently, you can flip an install
between modes by editing env and restarting:

```bash
# Hosted -> local-first:
unset MC_AUTH_MODE
# (or set MC_AUTH_MODE=local-single-user explicitly; Supabase env may remain)
npm run dev

# Local-first -> hosted:
export MC_AUTH_MODE=supabase
export NEXT_PUBLIC_SUPABASE_URL=...
export NEXT_PUBLIC_SUPABASE_ANON_KEY=...
export SUPABASE_SERVICE_ROLE_KEY=...
npm run dev
```

Session cookies from a previous mode are harmless — the active mode ignores
the other mode's cookies.

## Tests

Focused auth tests live under `src/lib/__tests__/`:

- `auth-mode.test.ts` - resolver behavior (local default, explicit
  override, normalization).
- `auth-local-single-user-middleware.test.ts` - middleware short-circuit and
  synthetic owner injection in local mode.
- `auth-local-dev-session-route.test.ts` - existing tests for the dev session
  route, exercising both Supabase and local-single-user paths.
- `orchestration-middleware-local-single-user-guard.test.ts` - regression test
  pinning the orchestration auth guard for exact loopback, API key, and
  non-loopback denial behavior.

Run with:

```bash
npm run test:auth-mode
npm run test:auth-local-single-user-middleware
npm run test:auth-local-dev-session-route
npm run test:auth-orchestration-local-guard
```

Or the consolidated alias:

```bash
npm run test:auth
```
