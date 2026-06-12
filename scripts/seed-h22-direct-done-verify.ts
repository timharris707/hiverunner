/**
 * H2.2 direct-done grader gate — live-fire verification seed.
 *
 * Seeds a sandbox orchestration DB, then — still inside the seed process,
 * before any server owns the DB (single-writer) — drives the maker's direct
 * in_progress→done request through the REAL engine action path
 * (executeUpdateTask). The H2.2 conversion must hold the task in review and
 * route the reviewer handoff; the live server's grader loop then closes it.
 *
 *   ORCHESTRATION_DB_PATH=/tmp/h22-verify/orchestration.db \
 *     node ./scripts/run-ts-test.mjs scripts/seed-h22-direct-done-verify.ts
 *   PORT=3031 ORCHESTRATION_DB_PATH=/tmp/h22-verify/orchestration.db \
 *     MC_SWEEP_INTERVAL_MS=15000 npm run dev
 *   curl -X POST http://127.0.0.1:3031/api/orchestration/engine/tick
 *
 * (Port note: 3030 belongs to Tim's PM2 chili-dev — pick an unclaimed port.)
 *
 * Expected end state after the grader fires: task done, with a
 * "Clean-Context Review — PASS" comment from the grader run — the maker's
 * done request never closed the task directly.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DESCRIPTION = [
  "Produce the quarterly export report as a single HTML file.",
  "",
  "## Acceptance Criteria",
  "- The report contains the exact heading \"Quarterly Export Summary\"",
  "- The report lists exactly three cities: Austin, Boston, Chicago",
  "- The report includes the line \"Total: 42\"",
].join("\n");

const REPORT_HTML = [
  "<!doctype html>",
  "<html><head><meta charset=\"utf-8\"><title>Quarterly Export Summary</title></head>",
  "<body>",
  "<h1>Quarterly Export Summary</h1>",
  "<ul>",
  "<li>Austin</li>",
  "<li>Boston</li>",
  "<li>Chicago</li>",
  "</ul>",
  "<p>Total: 42</p>",
  "</body></html>",
].join("\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath || !dbPath.includes("h22-verify")) {
    console.error("Refusing to seed: ORCHESTRATION_DB_PATH must point at an h22-verify sandbox DB.");
    process.exit(1);
  }
  rmSync(path.dirname(dbPath), { recursive: true, force: true });
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const { getOrchestrationDb } = await import("@/lib/orchestration/db");
  const { createProject, createTask } = await import("@/lib/orchestration/service");
  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { executeRegisterArtifact, executeUpdateTask } = await import("@/lib/orchestration/engine/action-dispatcher");

  const db = getOrchestrationDb();
  const now = () => new Date().toISOString();

  const company = createCompany({
    name: "H2.2 Verify",
    description: "Direct-done grader gate live-fire sandbox",
    status: "active",
  }).company as unknown as { id: string; slug: string };

  const companyRow = db
    .prepare("SELECT id, workspace_root, workspace_slug FROM companies WHERE id = ? LIMIT 1")
    .get(company.id) as { id: string; workspace_root: string | null; workspace_slug: string | null };

  const project = createProject({
    companyId: company.id,
    name: "Direct-Done Verification",
    description: "H2.2 live-fire fixtures",
    color: "#f59e0b",
    emoji: "🧪",
    status: "active",
  }).project as { id: string };

  function seedAgent(name: string, role: string): string {
    const id = randomUUID();
    const slug = `${name.toLowerCase()}-${id.slice(0, 6)}`;
    const at = now();
    db.prepare(
      `INSERT INTO agents
        (id, company_id, project_id, name, slug, runtime_slug, emoji, role, personality,
         status, adapter_type, model, skills_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', 'codex', 'gpt-5.5', ?, ?, ?)`,
    ).run(id, company.id, project.id, name, slug, slug, "🤖", role, "Deterministic", JSON.stringify([]), at, at);
    db.prepare(
      `INSERT INTO agent_runtime_state (agent_id, company_id, adapter_type, created_at, updated_at)
       VALUES (?, ?, 'codex', ?, ?)`,
    ).run(id, company.id, at, at);
    return id;
  }

  const ceoId = seedAgent("Bruce", "CEO");
  const makerId = seedAgent("Mason", "Builder");
  const reviewerId = seedAgent("Gator", "QA Reviewer");
  db.prepare("UPDATE companies SET lead_agent_id = ? WHERE id = ?").run(ceoId, company.id);

  const workspaceRoot =
    companyRow.workspace_root?.trim() ||
    path.join(process.cwd(), "..", "dev", "workspaces", "companies", companyRow.workspace_slug ?? company.slug);
  const outDir = path.join(workspaceRoot, "output");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "h22-report.html"), REPORT_HTML);

  const task = createTask({
    projectId: project.id,
    title: "H2.2 direct done — quarterly export report",
    description: DESCRIPTION,
    priority: "P2",
    type: "feature",
    status: "in-progress",
    assignee: makerId,
    labels: [],
    createdBy: "h22-verify-seed",
  }).task as { id: string; key?: string | null };

  const keyRow = db.prepare("SELECT task_key FROM tasks WHERE id = ?").get(task.id) as { task_key: string | null };
  const taskKey = keyRow.task_key ?? task.id;

  const registered = executeRegisterArtifact(
    { action: "register_artifact", taskKey, uri: "output/h22-report.html", kind: "html" },
    { agentId: makerId, companyId: company.id, runId: "h22-seed-register" },
    db,
  );
  if (!registered.taskFound) throw new Error("artifact registration failed");

  // THE H2.2 MOMENT — the maker tries to close its own artifact-carrying
  // task directly, exactly the INS-G008 bypass. The engine must convert the
  // request to review and route the reviewer handoff.
  const result = executeUpdateTask(
    { action: "update_task", taskKey, status: "done", comment: "Report generated and registered. Closing." },
    { agentId: makerId, companyId: company.id, runId: "h22-seed-direct-done" },
    db,
  );

  const row = db
    .prepare("SELECT status, completed_at, assignee_agent_id FROM tasks WHERE id = ?")
    .get(task.id) as { status: string; completed_at: string | null; assignee_agent_id: string | null };
  const wake = db
    .prepare(
      `SELECT COUNT(*) AS n FROM agent_wakeup_requests
       WHERE reason = 'engine_default_review_handoff'
         AND json_extract(payload_json, '$.taskId') = ?`,
    )
    .get(task.id) as { n: number };

  const checks = {
    statusApplied: result.statusApplied === true,
    heldInReview: row.status === "review",
    notCompleted: row.completed_at === null,
    reviewerRouted: row.assignee_agent_id === reviewerId,
    graderWakeQueued: wake.n >= 1,
  };
  const allPass = Object.values(checks).every(Boolean);

  console.log(JSON.stringify({
    company: { id: company.id, slug: company.slug, workspaceRoot },
    project: project.id,
    agents: { ceo: ceoId, maker: makerId, reviewer: reviewerId },
    task: { id: task.id, key: taskKey, ...row },
    conversionChecks: checks,
  }, null, 2));

  if (!allPass) {
    console.error("H2.2 conversion checks FAILED — do not start the server; investigate first.");
    process.exit(1);
  }
  console.log("Seed OK: direct done held in review + handoff routed. Start the sandbox server and tick the engine.");
  process.exit(0);
}

void run();
