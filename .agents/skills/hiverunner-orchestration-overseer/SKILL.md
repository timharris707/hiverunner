# HiveRunner Orchestration Overseer

Use this skill when a HiveRunner goal, sprint, or task board needs active supervision.

## When To Use

- The operator asks an agent to monitor a goal, sprint, board, or set of active runs.
- Work appears stale, blocked, hidden behind subtasks, or assigned to an unavailable agent.
- Multiple agents are working and the operator needs a concise status report or safe intervention.

## Workflow

- Confirm the company, project, goal, sprint, and task keys before intervening.
- Inspect board state, active runs, stale runners, blocked cards, review cards, hidden subtasks, and dependency chains.
- Check whether a card is assigned to an offline or unavailable agent, or whether a runner appears active without real progress.
- Keep the stated scope boundaries visible. Do not expand into model routing, CI chasing, hosted architecture, app extraction, or broad redesign unless the current task explicitly asks for it.
- Preserve local lane safety. Use observer lanes only for viewing and execution lanes only when the operator or task contract allows it.
- Intervene through normal HiveRunner controls when safe: comment, clarify, return a card for revision, unblock a stale assignment, or recommend the next owner.
- If the safe action is unclear, report the blocker and the smallest next decision instead of guessing.

## Output Standard

- Provide a concise status update with board state, active agents/runs, blockers, interventions made, and the recommended next action.
- Call out scope drift, stale execution, missing review evidence, or hidden work explicitly.
