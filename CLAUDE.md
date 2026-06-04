# HiveRunner Claude Guidance

For HiveRunner orchestration work, read `.agents/skills/hiverunner-orchestration-overseer/SKILL.md` first.

For broad/high-blast-radius edits touching orchestration, runtime execution, onboarding, provider/key handling, task/goal flow, company creation, or shared API/client contracts, follow the High-Blast-Radius Agent Playbook before editing:

- Run CodeGraph `status`, `query`, `callers`, `callees`, and `impact` for the concrete target.
- Run `npm run fallow:changed` when local changes exist and again after edits when practical.
- Verify CodeGraph/Fallow findings with direct file reads and `rg` for imports, routes, and string dispatch keys.
- Select focused tests from direct verification, not static graph output alone.
- Do not commit `.codegraph/` or `.fallow/` artifacts.
- Stop and report if the blast radius is larger than the requested task.

Keep local-first safety in mind: observer lanes are for viewing, and execution lanes should only run when the task contract or operator explicitly allows it.
