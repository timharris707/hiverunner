import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { detectCodexStatus, runOverseerCodexTurn } from "@/lib/orchestration/overseer/codex-runtime";
import { detectOverseerCliStatus, runOverseerCliTurn } from "@/lib/orchestration/overseer/cli-runtime";
import {
  appendOverseerMessage,
  assertOverseerSessionCompany,
  getOverseerSettings,
  listOverseerEvents,
  listOverseerMessages,
  normalizeOverseerRuntimeProvider,
} from "@/lib/orchestration/overseer/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createMessageSchema = z.object({
  content: z.string().trim().min(1).max(12000),
  attachments: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(260),
    mimeType: z.string().trim().max(180).optional(),
    size: z.number().int().nonnegative().max(50 * 1024 * 1024),
    path: z.string().trim().min(1).max(2000),
  })).max(12).optional(),
});

function formatAttachmentSection(attachments: NonNullable<z.infer<typeof createMessageSchema>["attachments"]>): string {
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
) {
  try {
    const { slug, sessionId } = await params;
    const parsed = createMessageSchema.parse(await req.json());
    const session = assertOverseerSessionCompany({ sessionId, companyIdOrSlug: slug });
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
    const userMessage = appendOverseerMessage({
      sessionId,
      role: "user",
      content: parsed.content,
      metadata: { attachments: parsed.attachments ?? [] },
    });
    const promptContent = `${parsed.content}${formatAttachmentSection(parsed.attachments ?? [])}`;
    const run = provider === "codex"
      ? await runOverseerCodexTurn({
          sessionId,
          userMessageId: userMessage.id,
          userMessage: promptContent,
          command: settings.codexCommand,
        })
      : await runOverseerCliTurn({
          sessionId,
          userMessageId: userMessage.id,
          userMessage: promptContent,
          provider,
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
