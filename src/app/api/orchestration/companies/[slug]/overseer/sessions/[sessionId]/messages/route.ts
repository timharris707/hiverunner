import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { detectCodexStatus, runOverseerCodexTurn } from "@/lib/orchestration/overseer/codex-runtime";
import { detectOverseerCliStatus, runOverseerCliTurn } from "@/lib/orchestration/overseer/cli-runtime";
import {
  appendOverseerMessage,
  assertOverseerSessionCompany,
  getOverseerSettings,
  handleOverseerMonitoringFastPath,
  listOverseerEvents,
  listOverseerMessages,
  normalizeOverseerRuntimeProvider,
  recordOverseerEvent,
  updateOverseerMessageMetadata,
} from "@/lib/orchestration/overseer/service";
import type { OverseerMessage, OverseerRuntimeProvider, OverseerSession } from "@/lib/orchestration/overseer/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createMessageSchema = z.object({
  content: z.string().trim().min(1).max(12000).optional(),
  deferRun: z.boolean().optional(),
  queuedMessageId: z.string().trim().min(1).max(120).optional(),
  attachments: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(260),
    mimeType: z.string().trim().max(180).optional(),
    size: z.number().int().nonnegative().max(50 * 1024 * 1024),
    path: z.string().trim().min(1).max(2000),
  })).max(12).optional(),
}).refine((value) => Boolean(value.content || value.queuedMessageId), {
  message: "content or queuedMessageId is required",
});

type CreateMessagePayload = z.infer<typeof createMessageSchema>;
type MessageAttachment = NonNullable<CreateMessagePayload["attachments"]>[number];

function formatAttachmentSection(attachments: MessageAttachment[]): string {
  if (attachments.length === 0) return "";
  const lines = attachments.map((attachment, index) => {
    const type = attachment.mimeType ? `, ${attachment.mimeType}` : "";
    return `${index + 1}. ${attachment.name} (${attachment.size} bytes${type})\n   Path: ${attachment.path}`;
  });
  return [
    "",
    "Attached files for this Overseer turn:",
    ...lines,
    "Use the absolute paths above when you need to inspect an attachment.",
  ].join("\n");
}

function sessionIsRunning(session: OverseerSession): boolean {
  return session.status === "running" || session.processPid !== null;
}

function queuedAttachments(message: OverseerMessage): MessageAttachment[] {
  return Array.isArray(message.metadata.attachments)
    ? message.metadata.attachments.flatMap((attachment) => {
      if (typeof attachment !== "object" || attachment === null || Array.isArray(attachment)) return [];
      const record = attachment as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const path = typeof record.path === "string" ? record.path.trim() : "";
      const size = typeof record.size === "number" && Number.isFinite(record.size) ? record.size : null;
      if (!id || !name || !path || size === null || size < 0) return [];
      return [{
        id,
        name,
        path,
        size,
        mimeType: typeof record.mimeType === "string" ? record.mimeType.trim() : undefined,
      }];
    })
    : [];
}

async function runOverseerTurn(input: {
  sessionId: string;
  userMessageId: string;
  userMessage: string;
  provider: OverseerRuntimeProvider;
  codexCommand: string;
}) {
  return input.provider === "codex"
    ? runOverseerCodexTurn({
        sessionId: input.sessionId,
        userMessageId: input.userMessageId,
        userMessage: input.userMessage,
        command: input.codexCommand,
      })
    : runOverseerCliTurn({
        sessionId: input.sessionId,
        userMessageId: input.userMessageId,
        userMessage: input.userMessage,
        provider: input.provider,
      });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
) {
  try {
    const { slug, sessionId } = await params;
    const parsed = createMessageSchema.parse(await req.json());
    const session = assertOverseerSessionCompany({ sessionId, companyIdOrSlug: slug });
    const attachments = parsed.attachments ?? [];
    if (!parsed.queuedMessageId && parsed.content && attachments.length === 0) {
      const fastPath = handleOverseerMonitoringFastPath({
        sessionId: session.id,
        content: parsed.content,
        metadata: { attachments },
      });
      if (fastPath) {
        return NextResponse.json({
          ...fastPath,
          session: fastPath.session,
          messages: listOverseerMessages(session.id).messages,
          events: listOverseerEvents(session.id).events,
        });
      }
    }
    const settings = getOverseerSettings(slug).settings;
    const provider = normalizeOverseerRuntimeProvider(session.scope.overseerProvider);
    if (provider === "codex") {
      const status = detectCodexStatus(settings.codexCommand);
      if (!status.installed || !status.authReady) {
        return errorResponse(
          409,
          "codex_not_ready",
          status.installed ? "Codex CLI is not logged in with ChatGPT." : "Codex CLI is not installed.",
          status,
        );
      }
    } else {
      const status = detectOverseerCliStatus(provider);
      if (!status.installed || !status.authReady) {
        return errorResponse(
          409,
          `${provider}_not_ready`,
          status.installed ? `${provider} CLI auth is not ready.` : `${provider} CLI is not installed.`,
          status,
        );
      }
    }
    if (parsed.queuedMessageId) {
      if (sessionIsRunning(session)) {
        return NextResponse.json({
          session,
          messages: listOverseerMessages(sessionId).messages,
          events: listOverseerEvents(sessionId).events,
          queued: true,
          queuedMessageId: parsed.queuedMessageId,
        }, { status: 202 });
      }
      const queuedMessage = listOverseerMessages(sessionId).messages.find((message) => message.id === parsed.queuedMessageId);
      if (!queuedMessage || queuedMessage.role !== "user" || queuedMessage.metadata.queueStatus !== "queued") {
        return errorResponse(409, "queued_message_not_pending", "The queued Overseer message is no longer pending.");
      }
      const submittedAt = new Date().toISOString();
      updateOverseerMessageMetadata({
        sessionId,
        messageId: queuedMessage.id,
        metadata: {
          ...queuedMessage.metadata,
          queueStatus: "running",
          submittedAt,
        },
      });
      const attachments = queuedAttachments(queuedMessage);
      const promptContent = `${queuedMessage.content}${formatAttachmentSection(attachments)}`;
      let run: Awaited<ReturnType<typeof runOverseerTurn>>;
      try {
        run = await runOverseerTurn({
          sessionId,
          userMessageId: queuedMessage.id,
          userMessage: promptContent,
          provider,
          codexCommand: settings.codexCommand,
        });
      } catch (error) {
        updateOverseerMessageMetadata({
          sessionId,
          messageId: queuedMessage.id,
          metadata: {
            ...queuedMessage.metadata,
            queueStatus: "failed",
            submittedAt,
            failedAt: new Date().toISOString(),
          },
        });
        throw error;
      }
      updateOverseerMessageMetadata({
        sessionId,
        messageId: queuedMessage.id,
        metadata: {
          ...queuedMessage.metadata,
          queueStatus: run.ok ? "completed" : "failed",
          submittedAt,
          completedAt: new Date().toISOString(),
          turnId: run.turnId,
        },
      });
      return NextResponse.json({
        ...run,
        session: run.session,
        messages: listOverseerMessages(sessionId).messages,
        events: listOverseerEvents(sessionId).events,
      });
    }

    const content = parsed.content;
    if (!content) {
      return errorResponse(400, "validation_error", "Invalid Overseer message payload");
    }
    if (parsed.deferRun || sessionIsRunning(session)) {
      const queuedAt = new Date().toISOString();
      const userMessage = appendOverseerMessage({
        sessionId,
        role: "user",
        content,
        metadata: {
          attachments: parsed.attachments ?? [],
          queueStatus: "queued",
          queuedAt,
          queueReason: parsed.deferRun ? "client_deferred" : "session_running",
        },
      });
      recordOverseerEvent({
        sessionId,
        eventType: "overseer.message.queued",
        event: {
          messageId: userMessage.id,
          reason: parsed.deferRun ? "client_deferred" : "session_running",
        },
      });
      return NextResponse.json({
        session: assertOverseerSessionCompany({ sessionId, companyIdOrSlug: slug }),
        messages: listOverseerMessages(sessionId).messages,
        events: listOverseerEvents(sessionId).events,
        queued: true,
        queuedMessageId: userMessage.id,
      }, { status: 202 });
    }

    const userMessage = appendOverseerMessage({
      sessionId,
      role: "user",
      content,
      metadata: { attachments },
    });
    const promptContent = `${content}${formatAttachmentSection(attachments)}`;
    const run = await runOverseerTurn({
      sessionId,
      userMessageId: userMessage.id,
      userMessage: promptContent,
      provider,
      codexCommand: settings.codexCommand,
    });
    return NextResponse.json({
      ...run,
      session: run.session,
      messages: listOverseerMessages(sessionId).messages,
      events: listOverseerEvents(sessionId).events,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid Overseer message payload", error.flatten());
    }
    return handleRouteError(error, "overseer-session-messages:post");
  }
}
