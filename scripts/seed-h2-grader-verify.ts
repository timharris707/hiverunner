/**
 * H2 clean-context grader — live-fire verification seed.
 *
 * Seeds a sandbox orchestration DB with everything the grader path needs,
 * then exits. Run it BEFORE starting the server on that DB (single-writer):
 *
 *   ORCHESTRATION_DB_PATH=/tmp/h2-verify/orchestration.db \
 *     node ./scripts/run-ts-test.mjs scripts/seed-h2-grader-verify.ts
 *   PORT=3030 ORCHESTRATION_DB_PATH=/tmp/h2-verify/orchestration.db \
 *     MC_SWEEP_INTERVAL_MS=15000 npm run dev
 *   curl -X POST http://127.0.0.1:3030/api/orchestration/engine/tick
 *
 * Fixture: company "H2 Verify" with CEO Bruce, maker Mason (codex), reviewer
 * Gator (codex profile — the grader must override to anthropic/haiku). Two
 * tasks sit in review, assigned to Gator, with maker-submitted "Ready for
 * review" comments and registered artifacts in the company workspace:
 *   H2 PASS — artifact satisfies all three acceptance criteria → expect the
 *     grader to post "Clean-Context Review — PASS" and close to done.
 *   H2 FAIL — artifact is missing the "Total: 42" row → expect FAIL, task
 *     back to in_progress, producer reassigned, rework wake queued.
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

function reportHtml(input: { includeTotal: boolean }): string {
  return [
    "<!doctype html>",
    "<html><head><meta charset=\"utf-8\"><title>Quarterly Export Summary</title></head>",
    "<body>",
    "<h1>Quarterly Export Summary</h1>",
    "<ul>",
    "<li>Austin</li>",
    "<li>Boston</li>",
    "<li>Chicago</li>",
    "</ul>",
    input.includeTotal ? "<p>Total: 42</p>" : "<p>Totals pending finance signoff.</p>",
    "</body></html>",
  ].join("\n");
}

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath || !dbPath.includes("h2-verify")) {
    console.error("Refusing to seed: ORCHESTRATION_DB_PATH must point at an h2-verify sandbox DB.");
    process.exit(1);
  }
  rmSync(path.dirname(dbPath), { recursive: true, force: true });
  mkdirSync(path.dirname(dbPath), { recursive: true });

  const { getOrchestrationDb } = await import("@/lib/orchestration/db");
  const { createProject, createTask } = await import("@/lib/orchestration/service");
  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { executeRegisterArtifact } = await import("@/lib/orchestration/engine/action-dispatcher");

  const db = getOrchestrationDb();
  const now = () => new Date().toISOString();

  const company = createCompany({
    name: "H2 Verify",
    description: "Clean-context grader live-fire sandbox",
    status: "active",
  }).company as unknown as { id: string; slug: string };

  const companyRow = db
    .prepare("SELECT id, workspace_root, workspace_slug FROM companies WHERE id = ? LIMIT 1")
    .get(company.id) as { id: string; workspace_root: string | null; workspace_slug: string | null };

  const project = createProject({
    companyId: company.id,
    name: "Grader Verification",
    description: "H2 live-fire fixtures",
    color: "#8b5cf6",
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

  // Artifacts live in the company workspace so the grader CLI can read them
  // with a relative path from its working directory.
  const workspaceRoot =
    companyRow.workspace_root?.trim() ||
    path.join(process.cwd(), "..", "dev", "workspaces", "companies", companyRow.workspace_slug ?? company.slug);
  const outDir = path.join(workspaceRoot, "output");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "h2-pass-report.html"), reportHtml({ includeTotal: true }));
  writeFileSync(path.join(outDir, "h2-fail-report.html"), reportHtml({ includeTotal: false }));

  function seedReviewTask(label: string, artifactRelPath: string): { id: string; key: string | null } {
    const task = createTask({
      projectId: project.id,
      title: `H2 ${label} — quarterly export report`,
      description: DESCRIPTION,
      priority: "P2",
      type: "feature",
      status: "in-progress",
      assignee: makerId,
      labels: [],
      createdBy: "h2-verify-seed",
    }).task as { id: string; key?: string | null };

    const submittedAt = now();
    // Maker finishes: review status + "Ready for review" submission (G1
    // author), then the reviewer is declared as assignee — the exact state
    // the sweeper routes as sweep_review_to_assignee.
    db.prepare("UPDATE tasks SET status = 'review', assignee_agent_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
      .run(reviewerId, submittedAt, submittedAt, task.id);
    db.prepare(
      `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', '{}', ?)`,
    ).run(randomUUID(), project.id, task.id, makerId, submittedAt);
    db.prepare(
      `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'comment', 'agent', ?, ?)`,
    ).run(
      randomUUID(),
      task.id,
      makerId,
      `Ready for review: report generated at ${artifactRelPath}. THREAD-SENTINEL-${label}: the grader prompt must never contain this sentence.`,
      submittedAt,
      submittedAt,
    );

    const keyRow = db.prepare("SELECT task_key FROM tasks WHERE id = ?").get(task.id) as { task_key: string | null };
    const registered = executeRegisterArtifact(
      { action: "register_artifact", taskKey: keyRow.task_key ?? task.id, uri: artifactRelPath, kind: "html" },
      { agentId: makerId, companyId: company.id, runId: `h2-seed-${label.toLowerCase()}` },
      db,
    );
    if (!registered.taskFound) throw new Error(`artifact registration failed for ${label}`);

    const row = db.prepare("SELECT id, task_key FROM tasks WHERE id = ?").get(task.id) as { id: string; task_key: string | null };
    return { id: row.id, key: row.task_key };
  }

  const pass = seedReviewTask("PASS", "output/h2-pass-report.html");
  const fail = seedReviewTask("FAIL", "output/h2-fail-report.html");

  console.log(JSON.stringify({
    company: { id: company.id, slug: company.slug, workspaceRoot },
    project: project.id,
    agents: { ceo: ceoId, maker: makerId, reviewer: reviewerId },
    tasks: { pass, fail },
  }, null, 2));
  process.exit(0);
}

void run();
