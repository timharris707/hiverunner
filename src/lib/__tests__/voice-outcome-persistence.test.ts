import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  createProject,
  createProjectAgent,
  createTask,
  getTaskDetail,
  listActivityFeed,
  listTaskComments,
} from "@/lib/orchestration/service";
import { persistTaskBoundVoiceOutcome } from "@/lib/voice-outcome-persistence";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${name}`);
      console.error(`    ${message}`);
    });
}

console.log("\nVoice Outcome Persistence Tests\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }
  const company = createCompany({
    name: `Voice Outcome Co ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  const project = createProject({
    companyId: company.id,
    name: `Voice Outcome Project ${Date.now()}`,
    description: "fixture",
    color: "#2563eb",
    emoji: "🎙️",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: `Scout ${Date.now()}`,
    emoji: "🧭",
    role: "Research Agent",
    personality: "Direct",
    status: "idle",
    skills: ["voice", "research"],
  }).agent;

  const task = createTask({
    projectId: project.id,
    title: "Voice-bound task",
    description: "fixture",
    priority: "P1",
    type: "feature",
    status: "in-progress",
    assignee: agent.id,
    labels: ["voice"],
    createdBy: "test",
  }).task;

  const transcriptRef = {
    filePath: "/tmp/mc-voice/2026-04-16-161807.md",
    filename: "2026-04-16-161807.md",
    relativePath: "memory/voice/2026-04-16-161807.md",
    rollupPath: "/tmp/mc-voice/VOICE_MEMORY.md",
    rollupRelativePath: "memory/voice/VOICE_MEMORY.md",
    workspaceRoot: "/tmp/mc-workspaces/companies/test",
    workspaceKind: "company" as const,
    durationSeconds: 73,
    messages: 8,
  };

  await test("task-bound session creates a visible voice-session proof comment even without accepted markers", async () => {
    const result = persistTaskBoundVoiceOutcome({
      sessionId: "voice-session-proof",
      binding: {
        scope: "task",
        companySlug: company.slug,
        projectId: project.id,
        projectSlug: project.slug,
        projectName: project.name,
        taskId: task.id,
        taskKey: task.key ?? task.id,
        taskTitle: task.title,
        taskStatus: task.status,
        agentId: agent.id,
        agentName: agent.name,
        mode: "discuss",
        source: "task-detail",
      },
      transcript: transcriptRef,
      acceptedMarkers: [],
    });

    assert.equal(result.createdSessionComment, true);
    assert.equal(result.createdMarkerComments, 0);

    const comments = listTaskComments(task.id).comments;
    assert.equal(comments.length, 1);
    assert.match(comments[0]!.text, /Voice session recorded/i);

    const detail = getTaskDetail(task.id);
    assert.ok(detail.detail.timeline.some((item) => item.provenance === "comment" && /Voice/.test(item.summary)));

    const feed = listActivityFeed({ limit: 10, projectId: project.id }).activity;
    assert.ok(feed.some((item) => /voice note/i.test(item.message)));
  });

  await test("accepted markers map onto task comments with voice source and dedupe by session/externalRef", async () => {
    const payload = {
      sessionId: "voice-session-markers",
      binding: {
        scope: "task" as const,
        companySlug: company.slug,
        projectId: project.id,
        projectSlug: project.slug,
        projectName: project.name,
        taskId: task.id,
        taskKey: task.key ?? task.id,
        taskTitle: task.title,
        taskStatus: task.status,
        agentId: agent.id,
        agentName: agent.name,
        mode: "discuss" as const,
        source: "task-detail" as const,
      },
      transcript: transcriptRef,
      acceptedMarkers: [
        { id: "marker-note", kind: "note" as const, summary: "Useful note", body: "Summarized implementation risk." },
        { id: "marker-blocker", kind: "blocker" as const, summary: "Blocked on auth", body: "Gemini key path still needs attention." },
        { id: "marker-decision", kind: "decision" as const, summary: "Storage decision", body: "Store transcripts in MC-owned workspace." },
      ],
    };

    const first = persistTaskBoundVoiceOutcome(payload);
    const second = persistTaskBoundVoiceOutcome(payload);

    assert.equal(first.createdMarkerComments, 3);
    assert.equal(second.createdMarkerComments, 0);

    const db = getOrchestrationDb();
    const rows = db
      .prepare("SELECT body, type, source, external_ref FROM comments WHERE task_id = ? ORDER BY created_at ASC")
      .all(task.id) as Array<{ body: string; type: string; source: string; external_ref: string | null }>;

    const voiceRows = rows.filter((row) => row.source === "voice");
    assert.equal(voiceRows.length, 5);
    assert.ok(voiceRows.some((row) => row.type === "comment" && /Useful note/.test(row.body)));
    assert.ok(voiceRows.some((row) => row.type === "blocker" && /Blocked on auth/.test(row.body)));
    assert.ok(voiceRows.some((row) => row.type === "status_update" && /Storage decision/.test(row.body)));
    assert.equal(new Set(voiceRows.map((row) => row.external_ref)).size, 5);
  });

  await test("global sessions do not create task comments", async () => {
    const before = listTaskComments(task.id).comments.length;

    const result = persistTaskBoundVoiceOutcome({
      sessionId: "voice-global-session",
      binding: {
        scope: "global",
        mode: "discuss",
        source: "voice-lab",
      },
      transcript: transcriptRef,
      acceptedMarkers: [
        { id: "ignored", kind: "note", summary: "Ignore me", body: "Should not persist without task binding." },
      ],
    });

    assert.equal(result.createdSessionComment, false);
    assert.equal(result.createdMarkerComments, 0);
    assert.equal(listTaskComments(task.id).comments.length, before);
  });

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

void run();
