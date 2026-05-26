# HiveRunner Symphony Runner

This path is kept for compatibility with older references. The canonical contract is now
documented as the HiveRunner external runner boundary:

- [HiveRunner External Runner Contract](./hiverunner-external-runner-contract.md)

The runtime label `symphony` remains a compatibility value in database rows, API payloads, and
environment variables. Product and operator-facing language should describe the lane as the
external runner, with Codex as the default bundled runner implementation, Claude Code as the
first non-Codex wrapper, Gemini as the second bundled provider wrapper, HERMES ACP as the
provider-neutral ACP wrapper, and OpenClaw Gateway as the provider-neutral gateway wrapper.

`symphony` does not imply Codex is the required provider. Setting `execution_engine = "symphony"`
on a task or record selects the external runner boundary; the actual provider is determined by the
attached runtime configuration, not by the label itself. Existing rows with `execution_engine =
"symphony"` are fully compatible with any configured external runner.
