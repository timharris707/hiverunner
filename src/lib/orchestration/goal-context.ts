import type Database from "better-sqlite3";

import { buildPlanningRetrospectiveContext } from "@/lib/orchestration/planning-retrospectives";

function clip(value: string, max = 900): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function sprintPlanActionInstructions(companyGoalId: string | null | undefined): string {
  const targetGoalId = companyGoalId ?? "<company-goal-id>";
  return [
    "Lead-agent Plan Mode protocol:",
    "You are in Plan Mode for this goal. Your job is to produce the FULL plan to reach the goal's stop condition - every sprint, every task. Number sprints sequentially from 1. Estimate task counts per sprint accurately; those counts become the goal's completion-percentage denominator.",
    "Think through the full arc: dependencies between sprints, validation checkpoints, and what each sprint produces that the next consumes. Each sprint should be independently coherent.",
    "Concurrency-first planning rule: design each sprint so as many agents as possible can start immediately. Default every task to `dependsOn: []`; add a dependency only when the downstream task literally cannot begin without the upstream task's concrete output. Avoid waterfall chains that serialize research -> build -> QA unless that sequence is truly required.",
    "Late-arc sprints will be less certain than early ones; that is expected. Get the overall shape right. You can revise pending drafts when earlier sprints complete and reveal new information.",
    "Planning quality determines code quality. Before writing JSON, perform a plan-quality pass: confirm the full arc, independent implementation slices, minimal necessary dependency gates, review/QA coverage, visual proof, migration/data safety, rollback path, operator validation, and where each sprint produces evidence the next sprint can consume.",
    "Optimize for the best code the system can ship, not just a long task list. Every task must be independently executable by its assignee, include concrete validation/evidence, have a clear file/component/API ownership boundary, and be small enough that a capable agent can finish it without guessing what 'done' means.",
    "Do not propose a sprint that lacks implementation tasks, verification tasks, and operator-visible proof. If a sprint changes UI, include visual verification. If it changes data or migrations, include backup/rollback and idempotence checks. If it changes orchestration behavior, include runtime-parity checks where relevant.",
    "If a goal resembles a prior reference plan, use that plan as a benchmark for completeness and efficiency, not as a script. Improve it when the goal context justifies a stronger task split, fewer dependencies, clearer ownership boundaries, or better validation.",
    "When you are ready to propose the plan, you MUST call the `propose_sprint_plan` mc-action with the JSON shape below. Do NOT describe your plan in prose comments; comments are not parsed as action emissions and the operator cannot approve a comment-only proposal.",
    "Schema:",
    "```mc-action",
    JSON.stringify(
      {
        action: "propose_sprint_plan",
        companyGoalId: targetGoalId,
        planMode: true,
        sprints: [
          {
            sequenceNumber: 1,
            name: "string",
            objective: "string",
            owner: "agent-id-or-null",
            startDate: "YYYY-MM-DD",
            endDate: "YYYY-MM-DD-or-null",
            defaultExecutionEngine: "hiverunner | symphony | manual",
            defaultModelLane: "default | fast | mini | deep",
            successCriteria: ["what this sprint must accomplish"],
            validationChecks: ["operator-verifiable check"],
            outOfScope: ["boundary to avoid"],
            tasks: [
              {
                id: "s1-task-1",
                title: "string",
                description: "string",
                assignee: "agent-id-or-null",
                eligibleAssignees: ["primary-agent-id", "alternate-agent-id"],
                priority: "P0 | P1 | P2 | P3",
                type: "feature | bug | research | epic | spike | docs | infra | refactor | review | qa | release",
                executionEngine: "hiverunner | symphony | manual",
                modelLane: "default | fast | mini | deep",
                dependsOn: ["task-id"],
                validation: "how this task will be checked",
              },
            ],
          },
        ],
      },
      null,
      2
    ),
    "```",
    "Example:",
    "```mc-action",
    JSON.stringify(
      {
        action: "propose_sprint_plan",
        companyGoalId: targetGoalId,
        planMode: true,
        sprints: [
          {
            sequenceNumber: 1,
            name: "Research current path and risks",
            objective: "Map what exists, what is unknown, and which risks shape the rest of the goal.",
            defaultExecutionEngine: "hiverunner",
            defaultModelLane: "default",
            successCriteria: ["Operator can inspect a concise current-state map and risk register."],
            validationChecks: ["Every open risk links to an owner, artifact, or follow-up task."],
            outOfScope: ["Do not change production behavior during discovery."],
            tasks: [
              {
                id: "s1-task-1",
                title: "Map the current borrower intake stages",
                description: "Review the current intake path and summarize each stage, owner, handoff, and missing decision.",
                assignee: "scout",
                eligibleAssignees: ["scout"],
                priority: "P1",
                type: "research",
                executionEngine: "hiverunner",
                modelLane: "default",
                dependsOn: [],
                validation: "Summary names every intake stage and flags unknowns for operator review.",
              },
              {
                id: "s1-task-2",
                title: "Draft the risk register",
                description: "In parallel with the current-state map, turn known unknowns into a prioritized blocker list with recommended next-sprint scope. Mark assumptions explicitly instead of waiting for the map unless a blocker truly depends on it.",
                assignee: "forge",
                eligibleAssignees: ["forge", "scout"],
                priority: "P1",
                type: "docs",
                executionEngine: "hiverunner",
                modelLane: "default",
                dependsOn: [],
                validation: "Risk register separates blockers from nice-to-haves and references discovery findings.",
              },
            ],
          },
          {
            sequenceNumber: 2,
            name: "Design the launch slice",
            objective: "Convert discovery into a concrete design, acceptance criteria, and implementation path.",
            defaultExecutionEngine: "hiverunner",
            defaultModelLane: "default",
            successCriteria: ["Operator can approve a bounded launch-slice design."],
            validationChecks: ["Design references sprint 1 risks and explains which risks remain."],
            outOfScope: ["Do not implement before the design is approved."],
            tasks: [
              {
                id: "s2-task-1",
                title: "Draft launch-slice design",
                description: "Define the smallest production-safe slice, ownership boundaries, rollback path, and acceptance criteria. Use the sprint-1 artifacts as context, but keep this task independent from sibling implementation-planning work.",
                assignee: "samantha",
                eligibleAssignees: ["samantha", "corey", "swift"],
                priority: "P1",
                type: "feature",
                executionEngine: "hiverunner",
                modelLane: "default",
                dependsOn: ["s1-task-2"],
                validation: "Design can be reviewed without reading raw discovery notes.",
              },
              {
                id: "s2-task-2",
                title: "QA the launch-slice design",
                description: "Check the design against the risk register and identify any missing validation gates. This is intentionally dependent on the design artifact because it validates that output.",
                assignee: "gator",
                eligibleAssignees: ["gator", "clarity"],
                priority: "P1",
                type: "research",
                executionEngine: "hiverunner",
                modelLane: "default",
                dependsOn: ["s2-task-1"],
                validation: "QA notes list pass/fail items and required changes.",
              },
            ],
          },
          {
            sequenceNumber: 3,
            name: "Ship and validate the launch slice",
            objective: "Implement the approved slice, validate it, and prepare operator handoff.",
            defaultExecutionEngine: "hiverunner",
            defaultModelLane: "default",
            successCriteria: ["The launch slice is implemented, validated, and ready for operator decision."],
            validationChecks: ["Implementation evidence, QA evidence, and handoff notes are all linked."],
            outOfScope: ["Do not expand scope beyond the approved launch slice."],
            tasks: [
              {
                id: "s3-task-1",
                title: "Implement approved launch-slice changes",
                description: "Build only the approved slice and record changed files/artifacts.",
                assignee: "forge",
                eligibleAssignees: ["forge"],
                priority: "P0",
                type: "feature",
                executionEngine: "hiverunner",
                modelLane: "default",
                dependsOn: ["s2-task-2"],
                validation: "Implementation references the approved design and has no unapproved scope expansion.",
              },
              {
                id: "s3-task-2",
                title: "Validate launch-slice behavior",
                description: "Run the agreed checks and summarize pass/fail evidence for operator review.",
                assignee: "gator",
                eligibleAssignees: ["gator", "lens", "clarity"],
                priority: "P0",
                type: "bug",
                executionEngine: "hiverunner",
                modelLane: "default",
                dependsOn: ["s3-task-1"],
                validation: "Validation evidence is linked and any failures become explicit follow-up work.",
              },
            ],
          },
        ],
      },
      null,
      2
    ),
    "```",
    "Team capacity and eligible assignees: distribute sprint work across capable agents instead of assigning everything to one specialist. If you assign more than 3 tasks in this sprint to a single agent, include `eligibleAssignees` on those tasks with the primary assignee first plus 1-2 capable alternates from the team. If no capable alternate exists, flag the bottleneck in the sprint stop condition and recommend hiring.",
    "Dependency discipline: avoid using dependencies to express a preferred order. Use dependencies only for hard prerequisites: generated schemas/API contracts, migrations that must exist before callers, artifacts a reviewer must inspect, or work that would conflict if done concurrently. If two agents can work in separate files, components, endpoints, tests, docs, or verification surfaces with a clear integration owner, keep them parallel. Ralph/release-integration style tasks should integrate parallel work cleanly; they should not force the entire sprint into a serial chain.",
    "Parallelism target: in a normal implementation sprint, at least half of non-QA/non-release tasks should be able to start immediately. If your proposed sprint has a long dependency chain, revise it into independent slices before emitting the plan. Put the reason for any unavoidable dependency in the downstream task description.",
    "Critical-path awareness: before finalizing your proposed tasks, identify which tasks block 2 or more downstream tasks (count tasks where this task appears in their dependsOn array). Treat that as a warning that the plan may be too serialized. Prefer splitting the blocker into parallel-ready contracts, fixtures, or ownership slices. If the dependency is truly unavoidable, prefer `modelLane: 'fast'` unless the task is genuinely complex enough to need a deeper model (architecture, novel design decisions, large refactors). Mechanical build tasks like scaffolding, wiring an existing API to UI buttons, schema migrations with no logic, or test harnesses should always go on 'fast'. In each unavoidable critical-path task's description, prefix the description with '[CRITICAL PATH - blocks N tasks]' so the operator sees this designation during draft review.",
    "Model and lane selection are part of the plan, not decoration. Put cheap/fast models on mechanical or bounded tasks, reserve deeper reasoning for architecture, novel design, high-risk review, and ambiguous product decisions, and make the choice visible in each task's modelLane.",
    "When you are reviewing a just-completed sprint and the goal's stop condition is now satisfied, emit `mark_goal_complete` instead of inventing more work: { \"action\": \"mark_goal_complete\", \"companyGoalId\": \"...\", \"reason\": \"All success criteria have passed and no pending drafts are needed.\" }. This creates an operator approval request; it does not mark the goal done by itself.",
    "Guard reminder: if you find yourself proposing just one sprint when the goal's scope clearly requires more, you have not finished Plan Mode. Continue planning until the arc reaches the stop condition. If you find yourself wanting to write 'Sprint plan proposed' as a comment, you have not yet emitted the action. Stop and emit the `propose_sprint_plan` action instead.",
  ].join("\n");
}

function buildTeamCapacitySnapshot(db: Database.Database, companyId: string | null | undefined): string | null {
  if (!companyId) return null;
  const rows = db
    .prepare(
      `SELECT
         a.id,
         a.name,
         a.role,
         COALESCE(a.eligible_categories, '[]') AS eligible_categories,
         COUNT(er.id) AS in_flight
       FROM agents a
       LEFT JOIN execution_runs er
         ON er.agent_id = a.id
        AND er.status = 'running'
       WHERE a.company_id = ?
         AND a.archived_at IS NULL
         AND a.status NOT IN ('paused', 'offline', 'error')
       GROUP BY a.id
       ORDER BY lower(a.name) ASC`
    )
    .all(companyId) as Array<{ id: string; name: string; role: string | null; eligible_categories: string | null; in_flight: number }>;
  if (!rows.length) return null;
  const lines = rows.map((agent) => {
    let categories: string[] = [];
    try {
      const parsed = JSON.parse(agent.eligible_categories ?? "[]");
      categories = Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {}
    const tags = categories.length ? categories.join(", ") : "uncategorized";
    return `- ${agent.name} (${agent.id}): ${agent.role ?? "Agent"}; eligible=${tags}; in-flight=${Number(agent.in_flight ?? 0)}`;
  });
  return `Team capacity snapshot:\n${lines.join("\n")}`;
}

export function buildTaskGoalContextSection(input: {
  db: Database.Database;
  taskId: string;
  agentId: string;
}): string | null {
  const row = input.db
    .prepare(
      `SELECT
         t.sprint_id,
         COALESCE(t.company_id, p.company_id) AS company_id,
         s.id AS sprint_id,
         s.name AS sprint_name,
         s.goal AS sprint_objective,
         s.goal_kind AS sprint_goal_kind,
         s.status AS sprint_status,
         s.stop_condition AS sprint_stop_condition,
         s.lead_agent_id AS sprint_lead_agent_id,
         parent.id AS company_goal_id,
         parent.name AS company_goal_name,
         parent.goal AS company_goal_objective,
         parent.status AS company_goal_status,
         parent.stop_condition AS company_goal_stop_condition,
         parent.lead_agent_id AS company_goal_lead_agent_id
       FROM tasks t
       LEFT JOIN sprints s ON s.id = t.sprint_id
       LEFT JOIN sprints parent ON parent.id = s.parent_id
       LEFT JOIN projects p ON p.id = COALESCE(t.project_id, s.project_id, parent.project_id)
       WHERE t.id = ?
       LIMIT 1`
    )
    .get(input.taskId) as {
      sprint_id: string | null;
      sprint_name: string | null;
      sprint_objective: string | null;
      sprint_goal_kind: "company" | "sprint" | null;
      sprint_status: string | null;
      sprint_stop_condition: string | null;
      sprint_lead_agent_id: string | null;
      company_goal_id: string | null;
      company_goal_name: string | null;
      company_goal_objective: string | null;
      company_goal_status: string | null;
      company_goal_stop_condition: string | null;
      company_goal_lead_agent_id: string | null;
      company_id: string | null;
    } | undefined;

  if (!row?.sprint_id) return null;
  const sprintIsCompanyGoal = (row.sprint_goal_kind ?? (row.company_goal_id ? "sprint" : "company")) === "company";
  const sprintId = row.sprint_id;
  const companyGoalId = sprintIsCompanyGoal ? row.sprint_id : row.company_goal_id;
  const ids = [sprintId, companyGoalId].filter((id, index, arr): id is string => Boolean(id) && arr.indexOf(id) === index);
  const placeholders = ids.map(() => "?").join(",");
  const items = ids.length
    ? input.db
        .prepare(
          `SELECT sprint_id, kind, text
           FROM goal_contract_items
           WHERE sprint_id IN (${placeholders})
             AND archived_at IS NULL
           ORDER BY sprint_id, kind, position ASC, created_at ASC`
        )
        .all(...ids) as Array<{ sprint_id: string; kind: string; text: string }>
    : [];
  const itemLines = (targetId: string | null | undefined, kind: string) =>
    items
      .filter((item) => item.sprint_id === targetId && item.kind === kind)
      .map((item) => `  - ${clip(item.text, 500)}`);

  const sections: string[] = [];
  sections.push("\n## Goal Context");
  if (sprintIsCompanyGoal) {
    sections.push(`You are working directly under company goal: ${row.sprint_name}`);
    if (row.sprint_objective) sections.push(`Objective: ${clip(row.sprint_objective)}`);
    if (row.sprint_stop_condition) sections.push(`Stop condition: ${clip(row.sprint_stop_condition, 700)}`);
    const success = itemLines(sprintId, "success_criterion");
    const out = itemLines(sprintId, "out_of_scope");
    if (success.length) sections.push(`Success criteria:\n${success.join("\n")}`);
    if (out.length) sections.push(`Out of scope:\n${out.join("\n")}`);
    if (row.sprint_lead_agent_id === input.agentId) {
      sections.push("Lead-agent responsibility: you are the lead for this goal. Plan sprints through operator-reviewable drafts, monitor contract drift, and do not create execution tasks directly until the operator approves a draft.");
      const retrospectiveContext = buildPlanningRetrospectiveContext({ db: input.db, companyId: row.company_id });
      if (retrospectiveContext) sections.push(retrospectiveContext);
      const teamSnapshot = buildTeamCapacitySnapshot(input.db, row.company_id);
      if (teamSnapshot) sections.push(teamSnapshot);
      sections.push(sprintPlanActionInstructions(companyGoalId));
    }
    return sections.join("\n");
  }

  sections.push(`Sprint: ${row.sprint_name} (${row.sprint_status})`);
  if (row.sprint_objective) sections.push(`Sprint objective: ${clip(row.sprint_objective)}`);
  const sprintChecks = itemLines(sprintId, "validation_check");
  const sprintOut = itemLines(sprintId, "out_of_scope");
  if (sprintChecks.length) sections.push(`Sprint validation checks:\n${sprintChecks.join("\n")}`);
  if (sprintOut.length) sections.push(`Sprint out of scope:\n${sprintOut.join("\n")}`);
  if (row.company_goal_id) {
    sections.push(`Company goal: ${row.company_goal_name} (${row.company_goal_status})`);
    if (row.company_goal_objective) sections.push(`Company-goal objective: ${clip(row.company_goal_objective)}`);
    if (row.company_goal_stop_condition) sections.push(`Company-goal stop condition: ${clip(row.company_goal_stop_condition, 700)}`);
    const goalSuccess = itemLines(row.company_goal_id, "success_criterion");
    const goalOut = itemLines(row.company_goal_id, "out_of_scope");
    if (goalSuccess.length) sections.push(`Company-goal success criteria:\n${goalSuccess.join("\n")}`);
    if (goalOut.length) sections.push(`Company-goal out of scope:\n${goalOut.join("\n")}`);
    if (row.company_goal_lead_agent_id === input.agentId) {
      sections.push("Lead-agent responsibility: you are the lead for this parent goal. Watch for contract drift and use sprint-plan drafts for new work.");
      const retrospectiveContext = buildPlanningRetrospectiveContext({ db: input.db, companyId: row.company_id });
      if (retrospectiveContext) sections.push(retrospectiveContext);
      const teamSnapshot = buildTeamCapacitySnapshot(input.db, row.company_id);
      if (teamSnapshot) sections.push(teamSnapshot);
      sections.push(sprintPlanActionInstructions(companyGoalId));
    }
  }
  sections.push("Instruction: execute this task inside the sprint and company-goal contract above. If the task conflicts with out-of-scope boundaries or cannot satisfy validation, report the conflict instead of improvising. When you pick up a to-do task, your first structured action should be `update_task` with status='in_progress'. When you finish your work on this task, your LAST action in this run MUST be `update_task` with status='review' (or status='done' if no review is needed and you have authority to close). Do not let your run terminate without explicitly declaring the terminal status. The engine has a safety-net that auto-moves completed work to review if you forget, but that is fallback behavior, not the expected path.");
  return sections.join("\n");
}

export function buildLeadSupervisorContextSection(input: {
  db: Database.Database;
  agentId: string;
  goalId: string | null;
  planningTaskId: string | null;
}): string | null {
  if (!input.goalId || !input.planningTaskId) return null;

  const goal = input.db
    .prepare(
      `SELECT
         g.id,
         g.name,
         g.goal,
         g.stop_condition,
         g.status,
         g.lead_agent_id,
         pt.task_key AS planning_task_key
       FROM sprints g
       INNER JOIN tasks pt ON pt.id = ?
       WHERE g.id = ?
         AND g.lead_agent_id = ?
       LIMIT 1`,
    )
    .get(input.planningTaskId, input.goalId, input.agentId) as
      | {
          id: string;
          name: string;
          goal: string | null;
          stop_condition: string | null;
          status: string;
          lead_agent_id: string;
          planning_task_key: string | null;
        }
      | undefined;
  if (!goal) return null;

  const lastSupervisorComment = input.db
    .prepare(
      `SELECT created_at
       FROM comments
       WHERE task_id = ?
         AND source = 'lead-supervisor'
       ORDER BY datetime(created_at) DESC, id DESC
       LIMIT 1`,
    )
    .get(input.planningTaskId) as { created_at: string } | undefined;
  const since = lastSupervisorComment?.created_at ?? new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const activeSprints = input.db
    .prepare(
      `SELECT id, name, goal
       FROM sprints
       WHERE parent_id = ?
         AND status = 'active'
       ORDER BY start_date ASC, created_at ASC`,
    )
    .all(input.goalId) as Array<{ id: string; name: string; goal: string | null }>;

  const sprintIds = activeSprints.map((sprint) => sprint.id);
  const sections: string[] = [];
  sections.push("\n## Lead Supervisor Tick");
  sections.push(`You are supervising goal: ${goal.name} (${goal.status})`);
  if (goal.goal) sections.push(`Goal objective: ${clip(goal.goal, 900)}`);
  if (goal.stop_condition) sections.push(`Stop condition: ${clip(goal.stop_condition, 700)}`);
  sections.push(`Planning task: ${goal.planning_task_key ?? input.planningTaskId}`);
  sections.push(`Since prior supervisor tick: ${since}`);
  sections.push("");
  sections.push("Your job in this wake is visibility, not replanning. Post exactly one concise operator-facing status update to the planning task using `add_comment` with `source: \"lead-supervisor\"`. Include counts, bottleneck, and next milestone. Do not create tasks, change task status, revise drafts, or mark the goal complete from this tick.");

  if (activeSprints.length === 0) {
    sections.push("No active child sprint is currently visible under this goal.");
  } else {
    const placeholders = sprintIds.map(() => "?").join(",");
    const tasks = input.db
      .prepare(
        `SELECT
           t.id,
           t.task_key,
           t.title,
           t.status,
           t.blocked_reason,
           t.updated_at,
           s.id AS sprint_id,
           s.name AS sprint_name,
           a.name AS assignee_name
         FROM tasks t
         INNER JOIN sprints s ON s.id = t.sprint_id
         LEFT JOIN agents a ON a.id = t.assignee_agent_id
         WHERE t.sprint_id IN (${placeholders})
           AND t.archived_at IS NULL
         ORDER BY s.created_at ASC,
           CASE t.status WHEN 'in_progress' THEN 0 WHEN 'review' THEN 1 WHEN 'blocked' THEN 2 WHEN 'to-do' THEN 3 WHEN 'backlog' THEN 4 WHEN 'done' THEN 5 ELSE 6 END,
           t.created_at ASC`,
      )
      .all(...sprintIds) as Array<{
        id: string;
        task_key: string | null;
        title: string;
        status: string;
        blocked_reason: string | null;
        updated_at: string;
        sprint_id: string;
        sprint_name: string;
        assignee_name: string | null;
      }>;

    const counts = new Map<string, number>();
    for (const task of tasks) {
      counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
    }
    const orderedStatuses = ["done", "in_progress", "review", "blocked", "to-do", "backlog"];
    sections.push(`Task roll-up: ${orderedStatuses.map((status) => `${status}=${counts.get(status) ?? 0}`).join(", ")}`);

    for (const sprint of activeSprints) {
      sections.push(`\n### Sprint: ${sprint.name}`);
      if (sprint.goal) sections.push(`Objective: ${clip(sprint.goal, 700)}`);
      const sprintTasks = tasks.filter((task) => task.sprint_id === sprint.id);
      if (sprintTasks.length === 0) {
        sections.push("- No tasks are currently attached to this active sprint.");
        continue;
      }
      const activeTasks = sprintTasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
      if (activeTasks.length === 0) {
        sections.push("- All visible tasks are terminal.");
      } else {
        sections.push("Open task snapshot:");
        for (const task of activeTasks) {
          sections.push(`- [${task.task_key ?? task.id}] ${clip(task.title, 160)} (${task.status}; assignee: ${task.assignee_name ?? "unassigned"})`);
          if (task.blocked_reason) sections.push(`  Blocker: ${clip(task.blocked_reason, 500)}`);
        }
      }
    }

    const longestRunning = input.db
      .prepare(
        `SELECT
           t.task_key,
           t.title,
           a.name AS agent_name,
           COALESCE(er.started_at, t.updated_at) AS started_at
         FROM tasks t
         LEFT JOIN agents a ON a.id = t.assignee_agent_id
         LEFT JOIN execution_runs er
           ON er.id = (
             SELECT er2.id
             FROM execution_runs er2
             WHERE er2.task_id = t.id
               AND er2.status = 'running'
             ORDER BY datetime(COALESCE(er2.started_at, er2.created_at)) ASC
             LIMIT 1
           )
         WHERE t.sprint_id IN (${placeholders})
           AND t.status = 'in_progress'
           AND t.archived_at IS NULL
         ORDER BY datetime(COALESCE(er.started_at, t.updated_at)) ASC
         LIMIT 1`,
      )
      .get(...sprintIds) as { task_key: string | null; title: string; agent_name: string | null; started_at: string | null } | undefined;
    if (longestRunning) {
      sections.push(`\nLongest-running in-progress task: [${longestRunning.task_key ?? "task"}] ${clip(longestRunning.title, 180)} — ${longestRunning.agent_name ?? "unassigned"}, started ${longestRunning.started_at ?? "unknown"}.`);
    }

    const blocked = tasks.filter((task) => task.status === "blocked");
    if (blocked.length > 0) {
      sections.push("\nBlocked tasks:");
      for (const task of blocked) {
        sections.push(`- [${task.task_key ?? task.id}] ${clip(task.title, 160)} — ${clip(task.blocked_reason ?? "No blocked_reason recorded.", 500)}`);
      }
    }

    const nonDoneTaskIds = tasks
      .filter((task) => task.status !== "done" && task.status !== "cancelled")
      .map((task) => task.id);
    if (nonDoneTaskIds.length > 0) {
      const commentPlaceholders = nonDoneTaskIds.map(() => "?").join(",");
      const comments = input.db
        .prepare(
          `SELECT
             c.created_at,
             c.body,
             c.source,
             t.task_key,
             t.title,
             COALESCE(a.name, c.author_user_id, 'Operator') AS author_name
           FROM comments c
           INNER JOIN tasks t ON t.id = c.task_id
           LEFT JOIN agents a ON a.id = c.author_agent_id
           WHERE c.task_id IN (${commentPlaceholders})
             AND c.created_at > ?
             AND c.source <> 'lead-supervisor'
           ORDER BY datetime(c.created_at) DESC
           LIMIT 12`,
        )
        .all(...nonDoneTaskIds, since) as Array<{
          created_at: string;
          body: string;
          source: string | null;
          task_key: string | null;
          title: string;
          author_name: string;
        }>;
      if (comments.length > 0) {
        sections.push(`\nRecent task comments since prior tick (${comments.length} shown):`);
        for (const comment of comments.reverse()) {
          sections.push(`- ${comment.created_at} — [${comment.task_key ?? "task"}] ${comment.author_name} (${comment.source ?? "unknown"}): ${clip(comment.body, 450)}`);
        }
      } else {
        sections.push("\nRecent task comments since prior tick: none.");
      }
    }
  }

  sections.push("\nRequired action shape:");
  sections.push("```mc-action");
  sections.push(JSON.stringify({
    action: "add_comment",
    taskKey: goal.planning_task_key ?? "<planning-task-key>",
    source: "lead-supervisor",
    body: "**Supervisor update**\\n\\n- Counts: ...\\n- Bottleneck: ...\\n- Next milestone: ...",
  }, null, 2));
  sections.push("```");

  return sections.join("\n");
}
