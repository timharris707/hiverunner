import { NextRequest, NextResponse } from "next/server";

import {
  buildAvatarSession,
  buildLiveCallScaffold,
  getAvatarProviders,
  resolveAvatarProvider,
  type AvatarProviderId,
  type CallTransportKind,
} from "@/lib/avatar-session";

export const dynamic = "force-dynamic";

/**
 * GET /api/avatar/session
 *
 * Discovery endpoint for UI + orchestration layers.
 * Returns available providers, selected provider, and capability surface.
 */
export async function GET() {
  const providers = getAvatarProviders();
  const selected = resolveAvatarProvider();

  return NextResponse.json({
    selectedProvider: selected.id,
    providers,
    callProfile: {
      mode: "video-call",
      preferredTransport: "webrtc",
      tracks: {
        operatorWebcamExpected: true,
        assistantVideoExpected: true,
        geminiAudioExpected: true,
      },
    },
    notes: {
      status: "Scaffold mode active",
      guidance:
        "Mock provider is functional now. fal/Replicate/self-host entries are capability placeholders until runtime adapters are implemented.",
    },
    liveCall: buildLiveCallScaffold({
      callSessionId: "call_preview",
      avatarSessionId: "avatar_preview",
    }),
  });
}

/**
 * POST /api/avatar/session
 *
 * Initializes an avatar session envelope. No external provider call yet.
 * This gives Pixel a stable contract for UI wiring while backend integrations land.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    provider?: AvatarProviderId;
    voiceSessionId?: string;
    callSessionId?: string;
    persona?: string;
    preferredTransport?: CallTransportKind;
  };

  const session = buildAvatarSession(body);

  return NextResponse.json({
    ...session,
    warnings:
      session.mode === "mock"
        ? [
            "Using mock avatar renderer. No realtime lip sync/video stream is produced yet.",
          ]
        : [
            "Provider marked experimental. Implement adapter + auth/request mapping before production use.",
          ],
  });
}
