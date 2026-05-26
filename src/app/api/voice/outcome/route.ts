import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { normalizeResolvedVoiceBinding } from "@/lib/voice-binding";
import { persistTaskBoundVoiceOutcome } from "@/lib/voice-outcome-persistence";
import { appendAgentSessionSummary } from "@/lib/voice-agent-memory";

const acceptedMarkerSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.enum(["note", "decision", "blocker", "followup"]),
  summary: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(10_000),
});

const transcriptSchema = z.object({
  filePath: z.string().trim().min(1),
  filename: z.string().trim().min(1),
  relativePath: z.string().trim().min(1),
  rollupPath: z.string().trim().min(1),
  rollupRelativePath: z.string().trim().min(1),
  workspaceRoot: z.string().trim().min(1),
  workspaceKind: z.enum(["company", "lane"]),
  durationSeconds: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
});

const voiceOutcomeSchema = z.object({
  sessionId: z.string().trim().min(1).nullish(),
  binding: z.record(z.string(), z.unknown()),
  acceptedMarkers: z.array(acceptedMarkerSchema).default([]),
  transcript: transcriptSchema.nullish(),
});

export async function POST(req: Request) {
  try {
    const parsed = voiceOutcomeSchema.parse(await req.json());
    const binding = normalizeResolvedVoiceBinding(parsed.binding);

    const result = persistTaskBoundVoiceOutcome({
      sessionId: parsed.sessionId ?? undefined,
      binding,
      acceptedMarkers: parsed.acceptedMarkers,
      transcript: parsed.transcript ?? undefined,
    });

    // Log to agent's session log whenever we have a bound agent — independent
    // of scope — so the agent carries voice-session history across tasks.
    if (binding.agentId && binding.companySlug) {
      const taskLabel = binding.taskKey && binding.taskTitle
        ? `${binding.taskKey} — ${binding.taskTitle}`
        : binding.taskTitle ?? binding.taskKey ?? undefined;
      await appendAgentSessionSummary(
        { agentId: binding.agentId, companySlug: binding.companySlug },
        {
          timestamp: new Date().toISOString(),
          taskLabel,
          projectLabel: binding.projectName ?? binding.projectSlug,
          durationSeconds: parsed.transcript?.durationSeconds,
          messages: parsed.transcript?.messages,
        },
      );
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid voice outcome payload", error.flatten());
    }
    return handleRouteError(error, "voice-outcome:post");
  }
}
