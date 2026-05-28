# Security Policy

## Supported Versions

HiveRunner is pre-1.0. Security fixes target the current `main` branch and the
latest tagged release when one exists.

## Reporting a Vulnerability

Please use GitHub private vulnerability reporting when available. If that is not
available, contact the repository owner privately. Do not open a public issue for
a suspected vulnerability.

Include:

- a short description of the issue
- steps to reproduce
- affected route, command, or integration
- likely impact
- any suggested fix

## Local-First Security Model

HiveRunner defaults to `local-single-user` auth for GitHub clones. That mode is
intended for the trusted local machine running the install. Anything that can
reach the host is treated as the local owner.

Do not expose a local-single-user install to a LAN, shared network, reverse
tunnel (ngrok / Cloudflare Tunnel / Tailscale Funnel), or the public internet.
"Private network only" still means a network you control end-to-end — a shared
office LAN, coffee-shop Wi-Fi, or kiosked machine is not safe.

`MC_AUTH_MODE=supabase` is required for hosted auth, but it is not by itself a
complete hosted deployment model. HiveRunner still uses local SQLite storage,
local workspace files, and one execution owner per data lane.

## Required Practices

- Keep `.env.local` private.
- Generate strong values for deployment secrets such as `MC_API_KEY` and
  `AUTH_SECRET`.
- Set `MC_API_KEY` before allowing non-loopback agent or automation traffic.
- Treat `data/`, `data-dev/`, and workspace roots as private runtime state.
- Run `npm audit` before publishing dependency changes.
- Use parameterized database queries and validate API input.

## CSRF Policy

HiveRunner protects state-changing browser requests (`POST`, `PUT`, `PATCH`,
and `DELETE`) in middleware. Browser-cookie/session requests must come from the
same HiveRunner origin, verified by the `Origin` header or
`Sec-Fetch-Site: same-origin`.

API-key and bearer-token automation paths do not require CSRF headers because
they are authenticated by explicit request headers instead of ambient browser
cookies. The development-only `MC_REQUIRE_LOCAL_DEV_AUTH=0` loopback bypass also
skips CSRF checks because it is an explicit local test opt-out.

## Supabase Service-Role Policy

`SUPABASE_SERVICE_ROLE_KEY` is optional and should only be configured for hosted
Supabase auth paths that truly need admin provisioning. The active privileged
usage is the loopback-only local-dev session bootstrap in hosted mode.

All service-role usage must go through `createAdminClient` with an explicit
operation name and reason. Privileged operations emit structured `[security]`
audit markers with route/request context and never log service-role keys,
passwords, or generated credentials.

## Hosted Auth Failure Policy

Hosted auth (`MC_AUTH_MODE=supabase`) fails closed. If Supabase session
verification, callback exchange, or hosted auth configuration fails, HiveRunner
denies the protected request or redirects to `/login`; it does not fall back to
local-single-user, legacy `mc_auth`, or shared-password auth.

Auth failures emit structured `[security]` markers with request context and
sanitized reasons. Secrets, cookies, passwords, API keys, and service-role keys
are redacted by the shared logging helper.

## Logging Baseline

HiveRunner emits lightweight structured console logs with stable channel
prefixes:

- `[api]` for API request summaries.
- `[security]` for auth, CSRF, and privileged admin events.

This is the local-first baseline. Hosted Sentry/APM/metrics are still future
operability work.

## Optional Runtime Integrations

OpenClaw and other runtime providers are optional integrations. Keep provider
credentials outside the repo, prefer loopback-only local services, and review the
provider's own security posture before enabling it in a shared environment.

## Deployment Checklist

- [ ] `.env.local` is not committed.
- [ ] `MC_API_KEY` is set for non-loopback automation traffic.
- [ ] `AUTH_SECRET` is generated per deployment when hosted auth is enabled.
- [ ] `MC_AUTH_MODE=supabase` is used for hosted multi-user deployments.
- [ ] Hosted deployments have a deliberate storage/engine plan; the default
      SQLite + local workspace runtime is local-first only.
- [ ] HTTPS is configured for any non-local deployment.
- [ ] Local data and workspace directories are backed up appropriately.
- [ ] `npm audit --json` has no untriaged high or critical findings.

## Responsible Disclosure

We follow coordinated vulnerability disclosure:

1. Reporter notifies the maintainers privately.
2. Maintainers confirm and develop a fix.
3. A patched version or commit is released.
4. Public disclosure happens after a fix is available.

Thank you for helping keep HiveRunner secure.
