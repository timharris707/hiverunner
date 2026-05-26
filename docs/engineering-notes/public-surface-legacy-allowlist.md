# Public Surface Legacy Term Allowlist

HiveRunner should not present private operator names, old product names, or
stale brand copy in public onboarding, generic navigation, local auth, or the
fresh-install path.

Some legacy terms remain intentionally scoped to compatibility paths,
preserved standalone tools, historical tests, or optional provider
integrations. Do not remove these with a broad rename unless the owning feature
is being migrated.

## Allowed Contexts

- `hiverunner` may remain in internal storage keys, service identifiers, and
  current project references.
- `mission-control` may remain only where it is an explicit compatibility
  alias for persisted local data, import/export packages, or old workspace
  slugs. It should not appear in public onboarding or product copy.
- `OpenClaw` may remain where it identifies the optional legacy runtime
  provider, runtime config, or preserved integration code.
- Legacy serialized field names from old local task data may remain only when
  renaming would risk losing compatibility with existing private task history.
  Public display names and voice prompts must use neutral HiveRunner language.
- Historical unit-test fixtures may keep private names only when they are
  testing compatibility, redaction, or migration behavior.
- Legacy SQLite schema identifiers may remain when migration/removal would risk
  breaking existing local databases; active runtime/provider surfaces should
  hide those identifiers.
- Existing private workspace names may remain in local data only. They should
  not appear in public onboarding, generic docs, or the fresh-install default.
- Absolute developer paths may remain only in tests, historical fixtures, or
  docs that explicitly describe migration away from them.

## Not Allowed

- Generic README/onboarding instructions that imply private seeded data is the
  expected first-run state.
- Login/auth UI branded with a private operator name or old product name.
- Core navigation, dashboard empty states, or fresh bootstrap labels that imply
  HiveRunner belongs to one existing private workspace.
