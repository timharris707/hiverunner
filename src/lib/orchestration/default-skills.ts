import {
  assignCompanySkillToAgent,
  createCompanySkill,
  listAgentSkillAssignments,
  listCompanySkills,
  updateCompanySkill,
  type CompanySkill,
} from "@/lib/orchestration/company-skills";
import { getOrchestrationDb } from "@/lib/orchestration/db";

type DefaultSkillDefinition = {
  slug: string;
  name: string;
  description: string;
  body: string;
  recommendedAgentRoles: string[];
  roleHints: RegExp[];
};

const DEFAULT_SKILL_SOURCE = "hiverunner-default-skills.v1";

export const DEFAULT_HIVERUNNER_SKILLS: DefaultSkillDefinition[] = [
  {
    slug: "diagnose-feedback-loop",
    name: "Diagnose Feedback Loop",
    description:
      "Build a deterministic feedback loop before fixing bugs or regressions. Use when work involves debugging, broken behavior, failing tests, performance regressions, or unclear root cause.",
    recommendedAgentRoles: ["engineering", "qa", "release", "support"],
    roleHints: [/\b(engineer|developer|backend|frontend|full[- ]?stack|integration|qa|quality|test|support|release|steward)\b/i],
    body: `# Diagnose Feedback Loop

## Use When
- A bug, regression, flaky behavior, or performance problem needs root cause analysis.
- A task says something is failing, broken, slow, throwing, rejected, or hard to reproduce.

## Workflow
- Build the smallest agent-runnable pass/fail loop before changing code. Prefer a failing test, then an HTTP/script repro, then browser automation, then a throwaway harness.
- Confirm the loop reproduces the user-described symptom, not a nearby failure.
- Write 3-5 ranked, falsifiable hypotheses. Each hypothesis must predict what would change if it is true.
- Instrument one hypothesis at a time. Tag temporary logs with a unique prefix and remove them before handoff.
- Turn the minimized repro into a regression test when a correct public seam exists.
- Apply the fix, rerun the original feedback loop, rerun the regression test, and report the hypothesis that was actually correct.

## Output Standard
- Name the repro loop, the confirmed symptom, the fix, and verification commands.
- If no reliable loop can be built, report exactly what was tried and what artifact or access would unblock diagnosis.
`,
  },
  {
    slug: "red-green-tdd",
    name: "Red-Green TDD",
    description:
      "Use one behavior-focused test at a time, then implement the minimum code to pass. Use when implementing risky behavior, fixing bugs with a clear seam, or adding important contract coverage.",
    recommendedAgentRoles: ["engineering", "architecture"],
    roleHints: [/\b(engineer|developer|backend|frontend|full[- ]?stack|integration|architect)\b/i],
    body: `# Red-Green TDD

## Use When
- The task changes behavior that can be verified through a public interface.
- A bug fix has a correct test seam.
- A feature has important contracts or edge cases.

## Workflow
- Identify the public interface and the observable behavior before writing tests.
- Write one failing test for one behavior. Do not write a batch of speculative tests.
- Implement only enough code to pass that test.
- Repeat with the next behavior only after the previous test is green.
- Refactor only while green, and rerun the relevant tests after each meaningful refactor.

## Test Quality
- Prefer integration-style tests through public interfaces.
- Avoid tests coupled to private functions, internal call order, or implementation-only data shapes.
- Test names should use the project domain language.

## Output Standard
- Report each meaningful red-green cycle and the final verification command.
`,
  },
  {
    slug: "zoom-out-repo-context",
    name: "Zoom Out Repo Context",
    description:
      "Understand how the touched area fits into the broader codebase before acting. Use when entering unfamiliar code, planning changes, reviewing architecture, or explaining a subsystem.",
    recommendedAgentRoles: ["all"],
    roleHints: [/.*/],
    body: `# Zoom Out Repo Context

## Use When
- The agent is working in unfamiliar code or a broad task touches multiple modules.
- The task needs architecture context before implementation or review.

## Workflow
- Confirm the source workspace and project context.
- Inspect package scripts, nearby modules, existing tests, and established naming patterns.
- Identify the public seams, callers, persistence/API boundaries, and existing verification paths.
- Summarize the relevant architecture before changing behavior.
- Use the current task instructions to keep exploration bounded.

## Output Standard
- State the files or modules inspected, the current architecture in plain language, and the verification path you will use.
`,
  },
  {
    slug: "hands-on-alignment-grill",
    name: "Hands-On Alignment Grill",
    description:
      "Interview the operator one question at a time to resolve ambiguity before work starts. Use when the user wants to be hands-on, stress-test a plan, or make sure the agent fully understands.",
    recommendedAgentRoles: ["all", "lead", "product"],
    roleHints: [/.*/],
    body: `# Hands-On Alignment Grill

## Use When
- The operator explicitly wants to be hands-on, stress-test a plan, or confirm shared understanding.
- A task has important ambiguity that cannot be resolved from code, memory, or artifacts.

## Workflow
- Ask one focused question at a time and include your recommended answer.
- If a question can be answered by inspecting code, task history, memory, or project artifacts, inspect those first instead of asking.
- Walk dependencies in order: goal, user, constraints, acceptance criteria, risks, scope boundaries, and verification.
- Convert resolved decisions into task comments, memory, ADRs, or follow-up tasks only when they need to survive the session.
- Do not force this workflow in autonomous runs when the operator is not present. Record the ambiguity and proceed only when a conservative assumption is safe.

## Output Standard
- End with the resolved scope, open questions, acceptance criteria, and any assumptions used.
`,
  },
  {
    slug: "prototype-to-learn",
    name: "Prototype To Learn",
    description:
      "Build a clearly marked throwaway prototype to answer a design question. Use when validating a state model, data flow, interaction pattern, or UI direction before production implementation.",
    recommendedAgentRoles: ["engineering", "product", "design"],
    roleHints: [/\b(engineer|developer|frontend|backend|product|designer|ux|ui|architect)\b/i],
    body: `# Prototype To Learn

## Use When
- The team needs to learn whether a state model, interaction, UI direction, or data flow feels right.
- A production implementation would be expensive without first answering a narrow design question.

## Workflow
- Name the question the prototype must answer.
- Choose the smallest shape: terminal harness for logic/state, browser route for UI, or isolated script for data/API behavior.
- Mark files clearly as prototype or throwaway.
- Avoid persistence unless persistence is the question being tested.
- Make state visible after each action or variant switch.
- When done, capture the answer in a task comment, issue, ADR, or implementation note, then delete or absorb the prototype.

## Output Standard
- Report the prototype path, run command, question answered, and whether it should be deleted or folded into production work.
`,
  },
  {
    slug: "vertical-task-breakdown",
    name: "Vertical Task Breakdown",
    description:
      "Break broad work into independently verifiable vertical slices. Use when creating child tasks, implementation issues, PRDs, or agent handoffs from a larger directive.",
    recommendedAgentRoles: ["lead", "product", "program", "architecture"],
    roleHints: [/\b(ceo|chief|founder|lead|product|pm|program|orchestrator|manager|architect|ux|analyst)\b/i],
    body: `# Vertical Task Breakdown

## Use When
- A directive, PRD, plan, or large task needs child tasks or implementation issues.
- Work should be delegated across HiveRunner agents.

## Workflow
- Break work into thin vertical slices that are independently demoable or verifiable.
- Prefer slices that cross the required layers end to end instead of separate backend/frontend/test-only chunks.
- Mark dependencies explicitly so validation waits for prerequisites.
- Assign each slice to the narrowest qualified runnable agent.
- Include acceptance criteria and expected evidence for every slice.
- Create separate QA/review tasks when independent verification is needed.

## Output Standard
- Emit one HiveRunner create_task action per task when task creation is requested.
- Name blockers, owner, acceptance criteria, and verification evidence for each slice.
`,
  },
  {
    slug: "task-triage-readiness",
    name: "Task Triage Readiness",
    description:
      "Classify work by readiness, missing information, and delegation fit. Use when reviewing incoming work, preparing tasks for agents, or deciding whether a task is blocked, ready, or out of scope.",
    recommendedAgentRoles: ["lead", "product", "qa", "ops", "support"],
    roleHints: [/\b(ceo|lead|product|pm|program|qa|quality|review|ops|operations|support|triage)\b/i],
    body: `# Task Triage Readiness

## Use When
- Incoming work needs clarification, prioritization, routing, or readiness review.
- A task may need more information before an autonomous agent can execute it.

## Workflow
- Read the full task, comments, artifacts, current status, assignee, and dependencies.
- Classify the task as ready, needs-info, blocked, human-review, or out-of-scope.
- For bugs, attempt a lightweight reproduction or identify the missing reproduction data.
- For ready work, write an agent brief with goal, context, acceptance criteria, constraints, and verification.
- For needs-info work, ask specific questions and preserve what is already known.
- For out-of-scope work, explain the durable reason so future agents do not re-open the same path.

## Output Standard
- Update the task or comment with readiness, rationale, owner recommendation, and next action.
`,
  },
  {
    slug: "architecture-deepening-review",
    name: "Architecture Deepening Review",
    description:
      "Find opportunities to make modules deeper, simpler to call, and easier to test. Use for architecture review, refactoring plans, tangled code, or code that is hard for agents to navigate.",
    recommendedAgentRoles: ["architecture", "engineering"],
    roleHints: [/\b(architect|senior|staff|principal|engineer|developer|backend|frontend|platform)\b/i],
    body: `# Architecture Deepening Review

## Use When
- The code is hard to test, hard to navigate, or spread across shallow pass-through modules.
- A task asks for architecture improvement, refactoring options, or better seams.

## Workflow
- Read domain/context docs and relevant ADRs before proposing changes.
- Look for shallow modules, leaky interfaces, duplicated caller knowledge, and missing test seams.
- Apply the deletion test: if deleting a module removes complexity, it may be shallow; if complexity reappears across callers, it may be earning its keep.
- Present candidates before implementing: files/modules involved, problem, proposed direction, benefits, risks, and testing impact.
- Prefer refactors that improve locality and leverage without changing user-visible behavior.

## Output Standard
- Provide a short ranked list of opportunities or a scoped implementation plan with verification.
`,
  },
  {
    slug: "session-handoff",
    name: "Session Handoff",
    description:
      "Produce a concise continuation note for another agent or later run. Use before stopping complex work, transferring ownership, or preserving context that is not already captured in artifacts.",
    recommendedAgentRoles: ["all"],
    roleHints: [/.*/],
    body: `# Session Handoff

## Use When
- Work is paused, transferred, or too large to finish in the current run.
- Another agent needs enough context to continue without replaying the whole transcript.

## Workflow
- Do not duplicate durable artifacts. Link to task keys, files, commits, PRs, docs, or comments.
- Capture current goal, completed work, current state, open decisions, blockers, verification already run, and the safest next step.
- Suggest relevant skills for the next run.
- Keep the handoff concise and operator-facing.

## Output Standard
- Post the handoff as a task comment or artifact path, depending on the task.
`,
  },
];

function metadataFor(definition: DefaultSkillDefinition): Record<string, unknown> {
  return {
    defaultSkill: true,
    source: DEFAULT_SKILL_SOURCE,
    recommendedAgentRoles: definition.recommendedAgentRoles,
    runtimeSkillBody: definition.body,
  };
}

function skillNeedsUpdate(skill: CompanySkill, definition: DefaultSkillDefinition): boolean {
  return (
    skill.name !== definition.name ||
    skill.description !== definition.description ||
    skill.status !== "active" ||
    skill.source !== "seed" ||
    skill.scope !== "company" ||
    skill.reviewRequired ||
    skill.reviewState !== "approved" ||
    skill.metadata.defaultSkill !== true ||
    skill.metadata.source !== DEFAULT_SKILL_SOURCE ||
    JSON.stringify(skill.metadata.recommendedAgentRoles ?? []) !== JSON.stringify(definition.recommendedAgentRoles) ||
    skill.metadata.runtimeSkillBody !== definition.body
  );
}

export function ensureDefaultCompanySkills(companyIdOrSlug: string): { skills: CompanySkill[]; created: number; updated: number } {
  const existing = listCompanySkills(companyIdOrSlug, { includeArchived: true, status: "all" });
  const bySlug = new Map(existing.skills.map((skill) => [skill.slug, skill]));
  const skills: CompanySkill[] = [];
  let created = 0;
  let updated = 0;

  for (const definition of DEFAULT_HIVERUNNER_SKILLS) {
    const current = bySlug.get(definition.slug);
    if (!current) {
      const result = createCompanySkill(companyIdOrSlug, {
        slug: definition.slug,
        name: definition.name,
        description: definition.description,
        status: "active",
        source: "seed",
        scope: "company",
        reviewRequired: false,
        reviewState: "approved",
        metadata: metadataFor(definition),
      });
      skills.push(result.skill);
      created += 1;
      continue;
    }

    if (skillNeedsUpdate(current, definition)) {
      const result = updateCompanySkill(companyIdOrSlug, current.id, {
        name: definition.name,
        description: definition.description,
        status: "active",
        source: "seed",
        scope: "company",
        reviewRequired: false,
        reviewState: "approved",
        metadata: {
          ...current.metadata,
          ...metadataFor(definition),
        },
      });
      skills.push(result.skill);
      updated += 1;
    } else {
      skills.push(current);
    }
  }

  return { skills, created, updated };
}

function defaultSkillSlugsForRole(role: string): string[] {
  const matched = DEFAULT_HIVERUNNER_SKILLS
    .filter((definition) => definition.roleHints.some((hint) => hint.test(role)))
    .map((definition) => definition.slug);
  return Array.from(new Set(matched));
}

export function assignDefaultSkillsForAgent(companyIdOrSlug: string, agentIdOrSlugOrName: string): {
  assigned: number;
  slugs: string[];
} {
  const db = getOrchestrationDb();
  const company = db
    .prepare("SELECT id FROM companies WHERE id = ? OR slug = ? OR company_code = ? LIMIT 1")
    .get(companyIdOrSlug, companyIdOrSlug, companyIdOrSlug) as { id: string } | undefined;
  if (!company) return { assigned: 0, slugs: [] };

  const agent = db
    .prepare(
      `SELECT id, role
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
         AND (id = ? OR slug = ? OR lower(name) = lower(?))
       LIMIT 1`,
    )
    .get(company.id, agentIdOrSlugOrName, agentIdOrSlugOrName, agentIdOrSlugOrName) as { id: string; role: string | null } | undefined;
  if (!agent) return { assigned: 0, slugs: [] };

  const seeded = ensureDefaultCompanySkills(company.id);
  const bySlug = new Map(seeded.skills.map((skill) => [skill.slug, skill]));
  const slugs = defaultSkillSlugsForRole(agent.role ?? "");
  const existing = listAgentSkillAssignments(company.id, {
    agentId: agent.id,
    includeArchived: true,
    status: "all",
  });
  const activeSkillIds = new Set(
    existing.assignments
      .filter((assignment) => assignment.status === "active" && !assignment.archivedAt)
      .map((assignment) => assignment.skillId),
  );
  let assigned = 0;

  for (const slug of slugs) {
    const skill = bySlug.get(slug);
    if (!skill || activeSkillIds.has(skill.id)) continue;
    assignCompanySkillToAgent(company.id, {
      agentId: agent.id,
      skillId: skill.id,
      status: "active",
      source: "seed",
      notes: "Assigned by HiveRunner default skill policy.",
      metadata: {
        defaultSkill: true,
        source: DEFAULT_SKILL_SOURCE,
      },
    });
    assigned += 1;
  }

  return { assigned, slugs };
}

export function assignDefaultSkillsForCompanyAgents(companyIdOrSlug: string): {
  agents: number;
  assigned: number;
} {
  ensureDefaultCompanySkills(companyIdOrSlug);
  const db = getOrchestrationDb();
  const company = db
    .prepare("SELECT id FROM companies WHERE id = ? OR slug = ? OR company_code = ? LIMIT 1")
    .get(companyIdOrSlug, companyIdOrSlug, companyIdOrSlug) as { id: string } | undefined;
  if (!company) return { agents: 0, assigned: 0 };

  const agents = db
    .prepare("SELECT id FROM agents WHERE company_id = ? AND archived_at IS NULL")
    .all(company.id) as Array<{ id: string }>;
  let assigned = 0;
  for (const agent of agents) {
    assigned += assignDefaultSkillsForAgent(company.id, agent.id).assigned;
  }
  return { agents: agents.length, assigned };
}
