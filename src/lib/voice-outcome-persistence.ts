import { getOrchestrationDb } from "@/lib/orchestration/db";
import { createTaskComment } from "@/lib/orchestration/service";
import type { CommentTypeInput } from "@/lib/orchestration/contracts";
import type { ResolvedVoiceBinding } from "@/lib/voice-binding";
import type { PersistedVoiceTranscript } from "@/lib/voice-memory";

export type VoiceOutcomeKind = "note" | "decision" | "blocker" | "followup";

export interface AcceptedVoiceMarker {
  id: string;
  kind: VoiceOutcomeKind;
  summary: string;
  body: string;
}

export interface PersistTaskBoundVoiceOutcomeInput {
  sessionId?: string | null;
  binding: ResolvedVoiceBinding;
  transcript?: PersistedVoiceTranscript | null;
  acceptedMarkers: AcceptedVoiceMarker[];
}

export interface PersistTaskBoundVoiceOutcomeResult {
  createdSessionComment: boolean;
  createdMarkerComments: number;
  skipped: boolean;
  reason?: string;
}

function normalizeSessionId(sessionId?: string | null): string {
  const normalized = sessionId?.trim();
  return normalized && normalized.length > 0 ? normalized : "unknown-session";
}

function voiceCommentExists(taskId: string, externalRef: string): boolean {
  const db = getOrchestrationDb();
  const row = db
    .prepare("SELECT id FROM comments WHERE task_id = ? AND source = 'voice' AND external_ref = ? LIMIT 1")
    .get(taskId, externalRef) as { id: string } | undefined;
  return Boolean(row?.id);
}

function updateVoiceCommentBody(taskId: string, externalRef: string, newBody: string): boolean {
  const db = getOrchestrationDb();
  const result = db
    .prepare("UPDATE comments SET body = ? WHERE task_id = ? AND source = 'voice' AND external_ref = ?")
    .run(newBody, taskId, externalRef);
  return result.changes > 0;
}

function mapMarkerKindToCommentType(kind: VoiceOutcomeKind): CommentTypeInput {
  switch (kind) {
    case "decision":
      return "status_update";
    case "blocker":
      return "blocker";
    case "followup":
    case "note":
    default:
      return "comment";
  }
}

function formatTaskLabel(binding: ResolvedVoiceBinding): string {
  if (binding.taskKey && binding.taskTitle) {
    return `${binding.taskKey} — ${binding.taskTitle}`;
  }
  return binding.taskTitle ?? binding.taskKey ?? binding.taskId ?? "Task";
}

function buildSessionProofBody(input: PersistTaskBoundVoiceOutcomeInput): string {
  const lines = [
    "Voice session recorded",
    `Task: ${formatTaskLabel(input.binding)}`,
  ];

  if (input.binding.agentName ?? input.binding.agentId) {
    lines.push(`Agent: ${input.binding.agentName ?? input.binding.agentId}`);
  }

  if (input.binding.projectName ?? input.binding.projectSlug) {
    lines.push(`Project: ${input.binding.projectName ?? input.binding.projectSlug}`);
  }

  if (input.transcript) {
    lines.push(`Duration: ${input.transcript.durationSeconds}s`);
    lines.push(`Messages: ${input.transcript.messages}`);
    lines.push(`Transcript: ${input.transcript.relativePath}`);
  }

  return lines.join("\n");
}

function buildMarkerBody(marker: AcceptedVoiceMarker, input: PersistTaskBoundVoiceOutcomeInput): string {
  const lines = [
    `Voice ${marker.kind}`,
    `Summary: ${marker.summary}`,
  ];

  if (input.transcript) {
    lines.push(`Transcript: ${input.transcript.relativePath}`);
  }

  lines.push("", marker.body.trim());
  return lines.join("\n");
}

export function persistTaskBoundVoiceOutcome(
  input: PersistTaskBoundVoiceOutcomeInput,
): PersistTaskBoundVoiceOutcomeResult {
  if (input.binding.scope !== "task" || !input.binding.taskId) {
    return {
      createdSessionComment: false,
      createdMarkerComments: 0,
      skipped: true,
      reason: "not_task_bound",
    };
  }

  const sessionId = normalizeSessionId(input.sessionId);
  const taskId = input.binding.taskId;
  const authorAgentId = input.binding.agentId;
  const authorUserId = `voice:${sessionId}`;

  const sessionExternalRef = `voice:${taskId}:session:${sessionId}:proof`;
  const newBody = buildSessionProofBody(input);
  let createdSessionComment = false;
  if (voiceCommentExists(taskId, sessionExternalRef)) {
    // Same session writing again (start → end) — update the body so the final
    // entry reflects the latest duration/messages data.
    updateVoiceCommentBody(taskId, sessionExternalRef, newBody);
  } else {
    createTaskComment({
      taskId,
      body: newBody,
      type: "comment",
      authorAgentId,
      authorUserId,
      source: "voice",
      externalRef: sessionExternalRef,
    });
    createdSessionComment = true;
  }

  let createdMarkerComments = 0;
  for (const marker of input.acceptedMarkers) {
    const markerExternalRef = `voice:${taskId}:session:${sessionId}:marker:${marker.id}`;
    if (voiceCommentExists(taskId, markerExternalRef)) {
      continue;
    }

    createTaskComment({
      taskId,
      body: buildMarkerBody(marker, input),
      type: mapMarkerKindToCommentType(marker.kind),
      authorAgentId,
      authorUserId,
      source: "voice",
      externalRef: markerExternalRef,
    });
    createdMarkerComments += 1;
  }

  return {
    createdSessionComment,
    createdMarkerComments,
    skipped: false,
  };
}
