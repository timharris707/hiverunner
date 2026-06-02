#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

await import("./register-ts-test-hooks.mjs");

const require = createRequire(import.meta.url);
const root = process.cwd();
const outputRoot = path.join(root, "output", "overseer-continuity");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runRoot = path.join(outputRoot, `proof-${stamp}`);
mkdirSync(runRoot, { recursive: true });

process.env.ORCHESTRATION_DB_PATH = path.join(runRoot, "orchestration.db");
process.env.MC_WORKSPACE_ROOT = path.join(runRoot, "workspaces");
process.env.NODE_ENV = "development";
mkdirSync(process.env.MC_WORKSPACE_ROOT, { recursive: true });

const { createCompany } = require("@/lib/orchestration/company-service");
const { closeOrchestrationDb, getOrchestrationDb } = require("@/lib/orchestration/db");
const { createProject } = require("@/lib/orchestration/service");
const { updateApprovalStatus } = require("@/lib/orchestration/service/approval");
const {
  appendOverseerMessage,
  applyApprovedOverseerCompaction,
  completeOverseerTurn,
  createOverseerSession,
  createOverseerTurn,
  listOverseerContextSnapshots,
  listOverseerEvents,
  requestOverseerSessionCompaction,
  recordOverseerEvent,
} = require("@/lib/orchestration/overseer/service");
const { buildRawOverseerTranscriptExport } = require("@/lib/orchestration/overseer/export");

function sha(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const db = getOrchestrationDb();
const company = createCompany({
  name: "Overseer Continuity Proof Co",
  description: "Fixture company for reproducible Overseer continuity proof.",
  status: "active",
}).company;
const project = createProject({
  companyId: company.id,
  name: "HiveRunner Continuity Proof",
  description: "Fixture project for raw transcript and compaction proof.",
  color: "#10a37f",
  emoji: "icon:bot",
  status: "active",
}).project;

const session = createOverseerSession({
  companyIdOrSlug: company.id,
  projectId: project.id,
  title: "Continuity proof session",
  createdBy: "proof-script",
}).session;

const attachmentPath = path.join(session.workspaceRoot, "overseer", "sessions", session.id, "attachments", "proof-note.md");
mkdirSync(path.dirname(attachmentPath), { recursive: true });
writeFileSync(attachmentPath, "# Proof note\nThis file proves attachment durability.\n", "utf8");
const attachmentHash = createHash("sha256").update("# Proof note\nThis file proves attachment durability.\n").digest("hex");

const user = appendOverseerMessage({
  sessionId: session.id,
  role: "user",
  content: "Summarize and preserve this session.",
  metadata: {
    attachments: [{
      id: "proof-attachment",
      name: "proof-note.md",
      mimeType: "text/markdown",
      size: 47,
      path: attachmentPath,
      sha256: attachmentHash,
      uploadedAt: new Date().toISOString(),
    }],
  },
});
const turn = createOverseerTurn({
  sessionId: session.id,
  userMessageId: user.id,
  prompt: user.content,
});
const assistant = appendOverseerMessage({
  sessionId: session.id,
  turnId: turn.id,
  role: "assistant",
  content: "Preserved source context and ready for compaction.",
});
recordOverseerEvent({
  sessionId: session.id,
  turnId: turn.id,
  eventType: "turn.completed",
  event: { provider: "codex", usage: { totalTokens: 128 } },
});
completeOverseerTurn({
  sessionId: session.id,
  turnId: turn.id,
  status: "completed",
  assistantMessageId: assistant.id,
  codexSessionId: "proof-codex-session",
  usage: { inputTokens: 90, outputTokens: 38, totalTokens: 128, turnCount: 1 },
});

const beforeExport = buildRawOverseerTranscriptExport({
  companyIdOrSlug: company.slug,
  sessionId: session.id,
}).package;
const beforeMessagesHash = sha(beforeExport.messages);
const beforeTurnsHash = sha(beforeExport.turns);
const beforeEventsHash = sha(beforeExport.events);

const requested = requestOverseerSessionCompaction({
  sessionId: session.id,
  summary: "Compacted proof summary preserving the user request, attachment, answer, usage, and approval state.",
  source: "manual",
  reason: "Proof script validates approval-gated compaction continuity.",
  requestedBy: "proof-script",
});
updateApprovalStatus({
  approvalId: requested.approvalId,
  status: "approved",
  decidedByUserId: "proof-script",
  decisionNote: "Approved by reproducible proof script.",
});
const applied = applyApprovedOverseerCompaction({
  approvalId: requested.approvalId,
  actorUserId: "proof-script",
});

const afterExport = buildRawOverseerTranscriptExport({
  companyIdOrSlug: company.slug,
  sessionId: session.id,
}).package;
const snapshots = listOverseerContextSnapshots({ sessionId: session.id, companyIdOrSlug: company.slug }).snapshots;
const afterMessagesHash = sha(afterExport.messages);
const afterTurnsHash = sha(afterExport.turns);
const initialEventsStillPresent = beforeExport.events.every((event, index) => (
  JSON.stringify(afterExport.events[index]) === JSON.stringify(event)
));

const checks = {
  snapshotCreated: snapshots.length === 1,
  snapshotVersion: snapshots[0]?.version ?? null,
  continuityStatus: afterExport.continuityProof.status,
  attachmentDurable: existsSync(attachmentPath) && attachmentPath.startsWith(session.workspaceRoot),
  messagesUnchanged: beforeMessagesHash === afterMessagesHash,
  turnsUnchanged: beforeTurnsHash === afterTurnsHash,
  initialEventsStillPresent,
  expectedAdditionalEvents: afterExport.events.length >= beforeExport.events.length + 2,
  proofLinksSnapshot: afterExport.continuityProof.latestCompaction.snapshotId === snapshots[0]?.id,
  proofLinksApproval: afterExport.continuityProof.latestCompactionApprovalId === requested.approvalId,
};
const failures = Object.entries(checks).flatMap(([key, value]) => (
  value === true || (key === "snapshotVersion" && value === 1) || (key === "continuityStatus" && value === "verified")
    ? []
    : [key]
));
if (failures.length > 0) {
  throw new Error(`Overseer continuity proof failed: ${failures.join(", ")}`);
}

const proof = {
  generatedAt: new Date().toISOString(),
  outputRoot: runRoot,
  company: { id: company.id, slug: company.slug },
  project: { id: project.id, name: project.name },
  session: { id: session.id, title: session.title },
  approvalId: requested.approvalId,
  applied: applied.applied,
  before: {
    counts: beforeExport._counts,
    messagesHash: beforeMessagesHash,
    turnsHash: beforeTurnsHash,
    eventsHash: beforeEventsHash,
    transcriptHash: beforeExport.contentHashes.payloadSha256,
  },
  after: {
    counts: afterExport._counts,
    continuityProof: afterExport.continuityProof,
    transcriptHash: afterExport.contentHashes.payloadSha256,
  },
  checks,
};

writeFileSync(path.join(runRoot, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`, "utf8");
writeFileSync(
  path.join(runRoot, "proof.md"),
  [
    "# Overseer Continuity Proof",
    "",
    `Generated: ${proof.generatedAt}`,
    `Session: ${session.title} (${session.id})`,
    `Approval: ${requested.approvalId}`,
    "",
    "## Result",
    "",
    `- Compaction applied: ${proof.applied}`,
    `- Continuity status: ${proof.after.continuityProof.status}`,
    `- Snapshot version: ${proof.checks.snapshotVersion}`,
    `- Attachment durable: ${proof.checks.attachmentDurable}`,
    `- Messages unchanged: ${proof.checks.messagesUnchanged}`,
    `- Turns unchanged: ${proof.checks.turnsUnchanged}`,
    `- Existing events still present: ${proof.checks.initialEventsStillPresent}`,
    "",
    "## Hashes",
    "",
    `- Before transcript: ${proof.before.transcriptHash}`,
    `- After transcript: ${proof.after.transcriptHash}`,
    `- Messages: ${proof.after.continuityProof.hashes.messagesSha256}`,
    `- Events: ${proof.after.continuityProof.hashes.eventsSha256}`,
    `- Attachments: ${proof.after.continuityProof.hashes.attachmentManifestSha256}`,
    "",
  ].join("\n"),
  "utf8",
);

closeOrchestrationDb();
console.log(JSON.stringify({ ok: true, outputRoot: runRoot, proof: path.join(runRoot, "proof.json") }, null, 2));
