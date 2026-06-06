# HiveRunner

HiveRunner is the local-first context for turning goals into agent-executed sprints that remain inspectable, reviewable, and operator-owned.

## Language

**Run Intelligence**:
HiveRunner's product pillar for making agent work inspectable, reviewable, comparable, and improvable across runs, tasks, sprints, and runners.
_Avoid_: Mastra parity, agent app framework, execution evidence pillar

**Run Trace**:
The chronological record of one agent run, used to inspect what the runner received, what happened during execution, what evidence was produced, and how the work was reviewed.
_Avoid_: Generic trace platform, observability dashboard, raw logs

**Review-Backed Evals**:
A Run Intelligence capability that turns human review outcomes, goal-contract evidence, task metadata, and run traces into reusable quality signals, datasets, and runner comparisons.
_Avoid_: Generic scorer marketplace, LLM judge platform, CI gate

**Starter Sprint Template**:
A launchable goal, sprint, and task package that creates concrete reviewable work and serves as the primary first-run choice before agent selection.
_Avoid_: Demo content, chatbot template, starter agent pack

**Template Version**:
A specific immutable revision of a Starter Sprint Template used to create or influence goals, sprints, tasks, traces, and eval cases.
_Avoid_: Mutable template, current template, copied checklist

**Starter Agent Pack**:
A reusable set of role presets, identities, and bundled assets that a Starter Sprint Template can recommend when the selected work needs those capabilities.
_Avoid_: First-run template, project template, required team

**Active Crew**:
The agents assigned or recommended for the current goal, sprint, task, or template.
_Avoid_: All agents, starter team, visible agents

**Bench**:
Available agents that exist in the workspace but are not currently needed for the selected work.
_Avoid_: Hidden agents, inactive agents, deleted agents

**Team**:
The company-level roster surface that owns the full set of agents across Active Crew, Bench, Paused, and Archived states.
_Avoid_: Contextual crew sidebar, individual agent shortcut list, org chart

**Agent Provisioning Governance**:
The company-level rule that decides whether agent-requested hires materialize immediately or require approval before becoming active.
_Avoid_: Separate template approval, auto-agent magic, silent hiring

**Crew Recommendation**:
A scoped recommendation for which agents, skills, tools, or roles are needed for a selected template, goal, sprint, or task.
_Avoid_: Permanent org chart, global team, static starter team

**Eval-Driven Improvement**:
A recommendation produced from reviewed runs or eval results to improve agents, skills, tools, templates, runner defaults, or configuration.
_Avoid_: Self-modifying agents, automatic tuning, silent config changes

**Improvement Queue**:
A company-level queue of Eval-Driven Improvement recommendations that can be reviewed, dismissed, grouped, edited, or converted into governed changes.
_Avoid_: Approval queue, settings page, automatic updater

**Improvement Review**:
The automated loop that detects improvement opportunities, asks the CEO or lead agent to synthesize recommendations, and routes approved recommendations through governance.
_Avoid_: Lead supervisor tick, direct mutation loop, background self-editing

**Improvement Experiment**:
A future Run Intelligence loop that applies Ralph Loop-inspired iteration to reviewed cases under alternate strategies to generate comparison evidence for improving cost, speed, quality, or reliability.
_Avoid_: Live task retry, automatic replacement run, unscoped optimization loop, agent Ralph ownership

**Overseer Delegated Signoff**:
A scoped operator instruction that lets Overseer approve a specific draft plan on the operator's behalf after reviewing it.
_Avoid_: Autonomous approval, blanket permission, silent plan creation

**Operator-Delegated Hire**:
Agent creation authorized by the operator through a scoped flow such as Overseer Delegated Signoff.
_Avoid_: Agent-requested hire, silent hire, unmanaged auto-approval

**Operator-Delegated Change**:
An in-app change authorized by the operator through a scoped Overseer flow, including plan approval, agent creation, skill assignment, tool configuration, or template updates.
_Avoid_: Autonomous mutation, HiveRunner app code change, blanket permission

**Experiment Workspace Mode**:
The operator-selected workspace isolation mode for an Improvement Experiment: Snapshot, Branch, or Live.
_Avoid_: Execution lane, runner mode, deployment target

**Snapshot**:
An Experiment Workspace Mode that runs an Improvement Experiment against a copied workspace state.
_Avoid_: Backup, export, archive

**Branch**:
An Experiment Workspace Mode that runs an Improvement Experiment against an isolated git branch or worktree.
_Avoid_: Release branch, stable lane, production branch

**Live**:
An Experiment Workspace Mode that runs an Improvement Experiment against the active workspace by explicit operator choice.
_Avoid_: Default experiment mode, safe mode, production deployment

**HiveRunner MCP Server**:
An MCP surface that exposes HiveRunner's agent-work control plane to external agents and tools.
_Avoid_: General agent framework, hosted app platform, chatbot integration layer
