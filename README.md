# HiveRunner

HiveRunner is a local-first control plane for coordinating AI agents, projects,
tasks, goals, memory, runtime lanes, and review loops from one operator console.
It is built with Next.js, React, TypeScript, Tailwind CSS, and SQLite.

The current sharing target is simple: a stranger should be able to clone the
repo, boot it locally, enter the app, and understand what is ready, what is
optional, and what is still local-only.

## What You Get

- Company-scoped dashboards for agents, goals, tasks, inbox, memory, files,
  runtime inventory, costs, and activity.
- Local-single-user auth by default, so a GitHub clone does not require
  Supabase or any external identity provider.
- Optional Supabase auth for hosted multi-user installs.
- SQLite-backed local state for the current local-first runtime.
- Managed company workspaces under `MC_WORKSPACE_ROOT`.
- Optional runtime integrations for local CLIs and external runners.
- Honest local-only defaults: useful on your machine first, not presented as a
  horizontally scalable hosted service yet.

## Requirements

- Node.js 20 or 22 LTS for the public local path.
- npm.
- macOS or Linux for the local runtime scripts.

Optional integrations can require their own CLIs or API keys, but they are not
required to boot the app.

## Quickstart

```bash
git clone <repo-url> hive-runner
cd hive-runner
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3010](http://localhost:3010).

For a script-managed background dev lane with PID/log files, use:

```bash
scripts/lane.sh dev start
scripts/lane.sh dev status
scripts/lane.sh dev logs
```

With the default `.env.example`, HiveRunner runs in `local-single-user` mode.
Use the local continue button on the login page. No Supabase project, OAuth app,
password, or admin account is required for the local path.

## What To Expect After Boot

- The app listens on port `3010`.
- `/` redirects to the configured default company, the neutral `HIVE`
  workspace on a fresh local install, or `INS` on existing local data where
  that is the primary workspace.
- `/login` lets you continue as the local owner in local-single-user mode.
- Runtime/provider pages may show missing optional CLIs or API keys. That is
  expected until you configure the corresponding integration.
- A fresh or isolated data directory starts with a neutral HiveRunner workspace.
  Use `/companies/new` when you want to create a workspace with a reviewed
  starter team, owner, lead, first project, and kickoff task.

Useful local routes:

- `/login` - auth entry point.
- `/HIVE/dashboard` - default dashboard on a fresh local install.
- `/HIVE/tasks` - task board/list views.
- `/HIVE/goals` - workspace goals and supporting sprints.
- `/HIVE/memory` - memory workspace.
- `/HIVE/hives` - runtime/provider configuration.
- `/HIVE/runtime-inventory` - optional CLI/runtime readiness.

Existing local data may still use routes such as `/INS/dashboard` when that
workspace already exists.

## Configuration

Most local installs can start with the checked-in `.env.example` copied to
`.env.local`. The values below are the ones worth understanding first.

### Required For Local Boot

None beyond copying `.env.example` to `.env.local`.

`MC_AUTH_MODE` is intentionally unset by default. When unset, HiveRunner uses
`local-single-user` mode.

### Recommended Local Settings

```env
# Optional, but useful if you want a stable owner email in local state.
MC_LOCAL_OWNER_EMAIL=owner@localhost.local

# Optional. Use an absolute path for company workspaces.
MC_WORKSPACE_ROOT=/absolute/path/to/hive-runner/workspace

# Optional. Use a separate data dir when testing a fresh local lane.
MC_DATA_DIR=./data-dev

# Optional. Force `/` to prefer a specific existing workspace/company code.
# If unset, HiveRunner prefers HIVE when present, then INS for existing local
# installs, then the first valid database-backed workspace.
MC_DEFAULT_COMPANY_CODE=HIVE
```

### Agent And Automation Traffic

Set `MC_API_KEY` when agents, scripts, or other machines call protected
orchestration APIs from outside exact loopback.

```env
MC_API_KEY=generate-a-long-random-secret
```

Exact loopback calls on your own machine keep working in local-single-user mode.

### Supabase Mode

Supabase is optional. Use it only for hosted multi-user auth.

```env
MC_AUTH_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
# Optional: only for audited admin provisioning paths such as loopback local-dev bootstrap.
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

When `MC_AUTH_MODE=supabase`, `/login` shows email/password and Google OAuth.
Public signup is disabled by design; users should be provisioned by an admin.

### Optional Provider Keys

Only set these when you want the corresponding feature. Local boot, workspace
creation, and starter-team setup do not require any provider key.

```env
OPENAI_API_KEY=...
GOOGLE_AI_API_KEY=...
ANTHROPIC_API_KEY=...
```

`GOOGLE_AI_API_KEY` enables Gemini-backed voice features such as Gemini Live
voice. Voice is optional; agents can be created and used without it.

`OPENAI_API_KEY` can enable optional AI avatar generation where configured.
Without an image provider key, agent avatars still work through local/default
avatar options.

The optional Pipecat/Tavus voice-avatar backend lives in `pipecat-server/` and
is documented in [docs/voice-avatar-backend.md](docs/voice-avatar-backend.md).
HiveRunner does not require that backend for local boot.

### Optional Runtime CLIs

Autonomous runtime CLIs are optional. Missing CLIs should appear as degraded or
missing-optional readiness states, not boot failures.

| Runtime | Command | Required? | Notes |
|---|---|---:|---|
| Codex | `codex` | No | Optional coding/runtime agent path. |
| Claude Code | `claude` | No | Optional runtime auth; separate from `ANTHROPIC_API_KEY`. |
| Gemini CLI | `gemini` | No | Optional runtime; Gemini API keys are separate and also power voice/direct Google routes. |
| HERMES | `hermes` | No | Optional local runner. |
| OpenClaw | `openclaw` | No | Optional legacy/local runtime, gated from the public default path. |
| External runner | configured command/env | No | Optional runner integration for Symphony-style execution. |

Check `/HIVE/runtime-inventory` or `/HIVE/hives` after boot to see which
runtimes are ready, missing, or waiting for login. For the full classification,
see [docs/runtime-dependencies.md](docs/runtime-dependencies.md).

### First-Run Starter Team Setup

Use `/companies/new` to create a company workspace, choose a starter-team work
type, review or edit the recommended role cards, preserve the CEO or lead, and
launch the first project and kickoff task.

In local-single-user mode, the owner name and email you enter become the local
owner profile for that new workspace. After launch, HiveRunner redirects you to
the new workspace dashboard using the same local owner identity.

The setup flow is intentionally provider-optional:

- Starter-team roles are created through the normal provisioning path without
  requiring Codex, Claude, Gemini, OpenClaw, or other provider keys.
- Avatars are encouraged for recognition, but they are not required. After
  launch, open an agent profile and use the avatar wizard to choose an actual
  local image, default avatar, or generated portrait.
- Voice is optional and can be configured later. Gemini Live voice requires a
  Gemini API key such as `GOOGLE_AI_API_KEY`, but missing voice credentials must
  not block workspace creation or starter-team setup.

## Auth Modes

HiveRunner has two auth modes:

| Mode | Default? | Use Case | External Service |
|---|---:|---|---|
| `local-single-user` | Yes | One trusted operator on a local machine | None |
| `supabase` | No | Hosted multi-user auth | Supabase |

Local-single-user mode is for a trusted local machine or private network. Do
not expose it directly to the public internet. Anything that reaches the host
is treated as the local owner.

For more detail, see [docs/AUTH.md](docs/AUTH.md).

## Local-Only Limits

HiveRunner is not pretending to be finished infrastructure. These are the
current limits to understand before sharing or deploying it:

- SQLite is the primary local store. It is good for a local operator lane on a
  local disk, not a multi-tenant hosted service at scale.
- The runtime engine is single-process oriented. Run only one process with
  `MC_ENGINE_TICK=on` for a given `MC_DATA_DIR`; additional processes should be
  observer-only with `MC_ENGINE_TICK=off`.
- Hosted Supabase auth exists, but local-single-user is the default sharing
  path. Supabase auth alone does not make HiveRunner horizontally scalable.
- Some runtime integrations depend on local CLIs or provider keys being present.
  Missing optional runtimes are expected until configured; see
  [docs/runtime-dependencies.md](docs/runtime-dependencies.md).
- First-run setup is intentionally narrow: `/companies/new` can create a
  workspace and optional starter team, but runtime readiness and provider-key
  configuration remain separate settings surfaces.
- Playwright browser checks are optional local QA tools. The default public PR
  gate stays lightweight and local-first.

For the exact supported boundary and the B5/B6 audit, see
[docs/local-first-boundary.md](docs/local-first-boundary.md).

## Common Commands

```bash
npm run dev
npm run build
npm start
npm test
npm run test:auth
npm run test:orchestration:company-owner-authorization
```

Production builds default to a 12GB Node heap because clean local macOS builds
can exceed the old 8GB cap. Override with
`HIVERUNNER_BUILD_HEAP_MB=<megabytes>` only when your local builder needs a
different limit. Do not validate builds by copying a dirty working tree; use the
tracked-only helper instead:

```bash
npm run build:tracked
```

That helper exports committed files into a temporary directory, runs `npm ci`,
then runs audit, typecheck, and build from that tracked-only tree.

## Local Data And Workspaces

By default, local runtime data is stored under the app data directory. Set
`MC_WORKSPACE_ROOT` when you want company workspaces in a specific location:

```text
/absolute/path/to/hive-runner/workspace
```

Set `MC_DATA_DIR` when you want an isolated SQLite/data lane for testing.
Keep active SQLite data on a local disk. If you back up a running lane, include
the database file and its `-wal` and `-shm` sidecars, or stop the process before
copying the data directory.

## Project Structure

```text
hive-runner/
  src/
    app/              Next.js App Router pages and API routes
    components/       Shared UI and orchestration components
    config/           Branding and agent defaults
    lib/              Auth, orchestration, workspace, runtime, and data logic
  docs/               Design notes and operator docs
  public/             Logos, icons, static assets
  scripts/            Local runtime, test, and maintenance scripts
  data/               Local state directory; instance data is gitignored
  .env.example        Local configuration template
```

## Troubleshooting

### Port 3010 Is Busy

Stop the existing local server:

```bash
scripts/lane.sh dev stop
```

Or run a one-off foreground server on another port:

```bash
PORT=3011 npm run dev
```

### Login Shows Hosted Auth Instead Of Local Continue

Check `.env.local`. For the local-first path, leave `MC_AUTH_MODE` unset or set
it to `local-single-user`. Set `MC_AUTH_MODE=supabase` only when Supabase is
fully configured.

### Runtime Or Provider Shows Missing

That usually means an optional CLI or provider key is not installed. The app can
still boot; configure the provider only when you need that runtime.

### You Want A Cleaner Local Test Lane

Use a separate data directory:

```bash
MC_DATA_DIR=./data-dev npm run dev
```

## Security Notes

- Keep `.env.local` private.
- Set `MC_API_KEY` before allowing non-loopback agent or automation traffic.
- Use `MC_AUTH_MODE=supabase` for any hosted multi-user deployment.
- Do not expose local-single-user mode directly to the public internet.
- Treat `data/`, `data-dev/`, and workspace directories as private runtime
  state.

## Contributing

Keep changes scoped and verifiable. For share-readiness work, prefer fixes that
make a fresh clone safer, clearer, or more trustworthy before expanding feature
surface area.

## License

MIT. See [LICENSE](LICENSE).
