# Contributing to HiveRunner

## Getting Started

1. Fork the repository.
2. Clone your fork.
3. Copy `.env.example` to `.env.local`.
4. Run `npm install`.
5. Run `npm run dev` and open `http://localhost:3010`.
6. Create a focused branch for your change.

See [README.md](./README.md#quickstart) for the full local-first setup path.

## Development Guidelines

- Keep changes scoped and reviewable.
- Prefer existing app patterns over new abstractions.
- Do not commit local data, generated output, screenshots, logs, or database
  files.
- Do not hardcode personal paths, private workspace names, provider keys, or
  credentials.
- Keep public copy under the HiveRunner brand.
- Frame OpenClaw and other runtimes as optional provider integrations.

## Useful Commands

```bash
npm run dev
npm run build
npm test
npx tsc --noEmit --incremental false --pretty false
npm audit --json
git diff --check
```

Run narrower tests when changing a focused subsystem, then broaden validation
when the change touches shared orchestration, auth, routing, or workspace logic.

## Pull Requests

A good PR includes:

- concise summary
- implementation notes
- validation commands and results
- known risks or deferred work
- screenshots only when they help review a UI change

Avoid `git add .` on broad working trees. Stage intentionally, especially when
generated output or local runtime files may exist.

## Security And Privacy

Never commit:

- `.env.local`
- local SQLite databases
- runtime output under `output/`
- generated screenshots
- private user names, emails, tokens, or machine-specific paths

Use placeholders in docs and examples. Keep instance-specific evidence out of
the public repo unless it has been deliberately sanitized.
