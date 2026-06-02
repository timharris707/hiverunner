# Changelog

## v0.2.0-preview.1 - Shareability hardening

Release date: 2026-05-31

This preview build focuses on making HiveRunner easier to share, diagnose, and
support when a new user downloads it locally.

### Added

- Version and build identity in the HiveRunner sidebar, with copyable diagnostic
  details for feedback reports.
- `/api/hiverunner/build` and richer local health metadata so support reports can
  include the exact build, commit, mode, lane, and port.
- GitHub issue forms for bug reports, feature requests, and first-run feedback.
- A GitHub feedback intake guide for turning user reports into actionable
  triage.
- Memory Sync controls for running and checking local memory indexing work.
- Collapsed Overseer diagnostics so continuity/export metadata is available
  without taking over the chat viewport.

### Improved

- Local setup documentation now explains the supported `3010` UI/build lane and
  observer-only behavior.
- Runtime readiness/status checks now distinguish UI/build lanes from execution
  lanes more clearly.
- Live run and gateway stream status handling is quieter and more resilient when
  lanes are unavailable.
- Task/manual runtime affordances now expose direct work and assignment actions
  more cleanly.
- Notification polling no longer surfaces noisy local-console warnings for
  transient fetch failures.

### Fixed

- Root redirect handling now preserves company-code routes more reliably.
- Agent/task update handling now accepts safer assignee and runtime metadata
  updates.
- Overseer diagnostics and session layout now behave better on narrower
  viewports.
- Alphanumeric company-code routes such as `HIV2` no longer trigger dock or
  breadcrumb hydration warnings on first load.

### Validation

- TypeScript check: `npx tsc --noEmit --incremental false --pretty false`
- Focused runtime, memory, health, stream, redirect, and assignee tests.
- GitHub issue-template YAML parse check.
- Rendered smoke checks for Overseer and Memory on the local `3010` lane.

### Known Notes

- This is still a local-first preview build, not a hosted production release.
- Autonomous execution should run from a dedicated execution lane, not the
  `3010` UI/build lane.
