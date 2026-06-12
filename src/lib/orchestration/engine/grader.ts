/**
 * H2 — Clean-context grader (maker ≠ grader, structurally).
 *
 * When a review wake is claimed for a task that has a registered G5 artifact,
 * the engine swaps the normal full-context heartbeat for a grader run: a
 * fresh-context prompt that contains ONLY the registered artifact and the
 * task's acceptance criteria — no task thread, no maker comments, no maker
 * reasoning. G1 (no-self-approval) removed identity overlap between maker and
 * reviewer; this removes context contamination. The grader's verdict flows
 * through the existing machinery: a single `update_task` mc-action whose
 * inline comment is the structured review. `done` passes the task (G1 still
 * guards self-approval), `in_progress` routes it down the existing rework
 * path (applyReviewDecision reassigns the producer and queues the rework
 * wake; G2 stamps the rejected artifact sha for no-op-resubmission detection).
 *
 * The grader model is the bake-off cheap-lane winner: claude-haiku-4-5 on the
 * anthropic subscription-CLI path (12/12 succeeded, median total tokens ~17K
 * vs millions for every alternative — run-3 summary, 2026-06-12). Override
 * with HIVERUNNER_GRADER_MODEL / HIVERUNNER_GRADER_RUNNER_PROVIDER; disable
 * with HIVERUNNER_CLEAN_CONTEXT_GRADER=0.
 */

import { fileURLToPath } from "node:url";

import type Database from "better-sqlite3";

import type {
  ResolvedExecutionRouteAttempt,
  ResolvedExecutionRouteTarget,
} from "@/lib/orchestration/execution-route-resolver";
import { getLatestReviewSubmissionAuthor } from "@/lib/orchestration/engine/status-transitions";

export const DEFAULT_GRADER_RUNTIME_PROVIDER = "anthropic";
export const DEFAULT_GRADER_MODEL = "claude-haiku-4-5";

/**
 * Wake reasons that mean "this run exists to review the task". Comment wakes
 * (operator questions on a review task) deliberately stay full-context so the
 * agent can answer conversationally instead of grading.
 */
export const CLEAN_CONTEXT_GRADER_WAKE_REASONS = new Set([
  "engine_default_review_handoff",
  "sweep_review_to_assignee",
  "sweep_review_to_ceo",
  "stale_review_execution_repaired",
]);

const GRADER_RUNTIME_PROVIDERS = new Set(["anthropic", "codex", "gemini", "hermes", "openclaw"]);

export type GraderTaskRow = {
  id: string;
  project_id: string;
  company_id: string | null;
  task_key: string | null;
  title: string | null;
  description: string | null;
  status: string;
  artifact_uri: string | null;
  artifact_kind: string | null;
  artifact_sha256: string | null;
  artifact_registered_at: string | null;
};

export type CleanContextGraderRun = {
  task: GraderTaskRow;
  attempt: ResolvedExecutionRouteAttempt;
};

export function cleanContextGraderEnabled(): boolean {
  return (process.env.HIVERUNNER_CLEAN_CONTEXT_GRADER ?? "1").trim() !== "0";
}

export function graderModel(): string {
  const override = process.env.HIVERUNNER_GRADER_MODEL?.trim();
  return override || DEFAULT_GRADER_MODEL;
}

export function graderRuntimeProvider(): string {
  const override = process.env.HIVERUNNER_GRADER_RUNNER_PROVIDER?.trim().toLowerCase();
  return override && GRADER_RUNTIME_PROVIDERS.has(override)
    ? override
    : DEFAULT_GRADER_RUNTIME_PROVIDER;
}

/**
 * Synthetic route attempt pinning the grader run to the cheap-lane runner,
 * independent of the reviewer agent's profile and the task's model lane.
 * `modelSourceId` must NOT be "agent_profile": the anthropic adapter ignores
 * route-attempt models sourced from agent profiles (routeAttemptModel).
 */
export function graderRouteAttempt(): ResolvedExecutionRouteAttempt {
  const provider = graderRuntimeProvider() as ResolvedExecutionRouteTarget["runtimeProvider"];
  return {
    target: {
      runtimeProvider: provider,
      runtimeLabel: "Clean-context grader",
      model: graderModel(),
      source: {
        mode: "runtime_managed",
        modelSourceId: "clean_context_grader",
        modelSourceLabel: "Clean-context grader (H2)",
        modelId: graderModel(),
      },
    },
    fallbackUsed: false,
    fallbackIndex: null,
    fallbackFromProvider: null,
  };
}

/**
 * Decides at claim time whether this heartbeat should run as a clean-context
 * grader. Claim-time detection (instead of flags stamped at each enqueue
 * site) covers every review-wake producer uniformly — immediate handoff,
 * sweeper routing, watchdog escalation, stale-execution repair — and
 * re-checks live task state so stale wakes degrade to the normal prompt.
 */
export function resolveCleanContextGraderRun(input: {
  db: Database.Database;
  taskKey: string;
  agentId: string;
  contextSnapshot: Record<string, unknown>;
}): CleanContextGraderRun | null {
  if (!cleanContextGraderEnabled()) return null;
  if (!input.taskKey || input.taskKey === "__heartbeat__") return null;

  const wakeReason = String(input.contextSnapshot.wakeReason ?? "").trim();
  if (!CLEAN_CONTEXT_GRADER_WAKE_REASONS.has(wakeReason)) return null;

  const task = input.db
    .prepare(
      `SELECT id, project_id, company_id, task_key, title, description, status,
              artifact_uri, artifact_kind, artifact_sha256, artifact_registered_at
       FROM tasks
       WHERE (id = ? OR task_key = ?) AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(input.taskKey, input.taskKey) as GraderTaskRow | undefined;

  if (!task) return null;
  if (task.status !== "review") return null;
  if (!task.artifact_uri?.trim()) return null;

  // A grader run by the agent who submitted the work would be self-grading —
  // and a PASS would dead-end on the G1 self-approval block anyway. Fall back
  // to the normal review prompt so existing escalation dynamics apply.
  if (getLatestReviewSubmissionAuthor(task.id, input.db) === input.agentId) return null;

  return { task, attempt: graderRouteAttempt() };
}

/**
 * Pulls the "Acceptance Criteria" markdown section out of a task description
 * (same heading convention the legacy build pipeline parses). Returns [] when
 * the section is absent — the prompt then grades against the description.
 */
export function parseAcceptanceCriteria(description: string | null | undefined): string[] {
  if (!description) return [];
  const criteria: string[] = [];
  let inSection = false;
  for (const rawLine of description.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (/^#{1,6}\s*acceptance criteria\b/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{1,6}\s+\S+/.test(line)) {
      inSection = false;
    }
    if (!inSection) continue;
    const stripped = line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim();
    if (stripped) criteria.push(stripped);
  }
  return criteria;
}

function artifactLocationForPrompt(uri: string): string {
  const trimmed = uri.trim();
  if (trimmed.toLowerCase().startsWith("file://")) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…(truncated)` : value;
}

/**
 * The clean-context prompt. Everything the grader sees is here: task key +
 * title, acceptance criteria (or the description as fallback spec), and the
 * registered artifact's location. Deliberately absent: comments, run history,
 * maker identity, agent personality/memory, company context.
 */
export function buildCleanContextGraderPrompt(input: {
  agent: { name: string };
  task: GraderTaskRow;
}): string {
  const { task } = input;
  const taskKey = task.task_key ?? task.id;
  const criteria = parseAcceptanceCriteria(task.description);
  const location = artifactLocationForPrompt(task.artifact_uri ?? "");
  const shaShort = task.artifact_sha256 ? task.artifact_sha256.slice(0, 12) : "not recorded";

  const sections: string[] = [];

  sections.push(`You are ${input.agent.name}, serving as an independent clean-context reviewer.`);
  sections.push(
    "This review is deliberately isolated: you have NOT been shown the task conversation, the maker's reasoning, or any prior review notes — only the deliverable and the acceptance criteria below. Judge the work purely on whether the registered artifact satisfies the criteria.",
  );

  sections.push(`## Task under review\n- Key: ${taskKey}\n- Title: ${task.title ?? "(untitled)"}`);

  if (criteria.length > 0) {
    sections.push(
      `## Acceptance criteria\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
    );
  } else {
    sections.push(
      `## Acceptance criteria\nNo explicit acceptance-criteria section was provided. Grade against the task description:\n\n${truncate(task.description?.trim() || "(no description)", 4000)}`,
    );
  }

  sections.push(
    [
      "## Registered artifact (the deliverable)",
      `- Location: ${location || "(missing)"}`,
      `- Kind: ${task.artifact_kind ?? "file"}`,
      `- SHA-256: ${shaShort}`,
      `- Registered: ${task.artifact_registered_at ?? "unknown"}`,
      "",
      "Read the artifact from its location (you have filesystem access; relative paths resolve from your working directory; URLs may be fetched if tooling allows). If the artifact cannot be opened or does not exist, that is an automatic FAIL with the gap \"artifact inaccessible\".",
    ].join("\n"),
  );

  sections.push(
    [
      "## Verdict protocol — REQUIRED",
      "Respond with EXACTLY ONE fenced mc-action block. The inline `comment` is your structured review; the status is your verdict.",
      "",
      "PASS — every criterion satisfied:",
      "```mc-action",
      `{"action":"update_task","taskKey":"${taskKey}","status":"done","comment":"## Clean-Context Review — PASS\\n\\nArtifact: ${shaShort}\\nCriteria: N/N satisfied\\n- PASS: <criterion> — <one-line evidence from the artifact>"}`,
      "```",
      "",
      "FAIL — any criterion unmet or artifact inaccessible:",
      "```mc-action",
      `{"action":"update_task","taskKey":"${taskKey}","status":"in_progress","comment":"## Clean-Context Review — FAIL\\n\\nArtifact: ${shaShort}\\nCriteria: K/N satisfied\\n\\nGaps:\\n1. <criterion> — <what is missing, specific and actionable>"}`,
      "```",
      "",
      "Rules:",
      "- Verify every criterion against the artifact itself; cite evidence from it.",
      "- Do NOT modify any files. This is a read-only review.",
      "- Do NOT reassign the task or name agents — failure routing is automatic.",
      "- Be decisive: exactly one verdict, no questions, no hedging.",
      "- Keep the comment under 1800 characters, JSON-escaped newlines as shown.",
    ].join("\n"),
  );

  return sections.join("\n\n");
}
