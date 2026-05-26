/**
 * /api/voice/avatar - proxy to the optional local Pipecat avatar backend.
 *
 * GET  → health check (proxies /health)
 * POST → start session (proxies /start, returns { room_url, room_name, user_token })
 *
 * This avoids CORS issues when the browser talks to the Pipecat server directly.
 */
import { NextRequest, NextResponse } from "next/server";

const PIPECAT_URL = process.env.PIPECAT_URL || "http://127.0.0.1:8108";
const SETUP_MESSAGE =
  "Optional HiveRunner voice avatar backend is unavailable. Core HiveRunner still works; start pipecat-server and configure provider keys to enable avatar voice.";

export async function GET() {
  try {
    const res = await fetch(`${PIPECAT_URL}/health`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { available: false, error: `Optional voice avatar backend returned ${res.status}`, setup: SETUP_MESSAGE },
        { status: 503 }
      );
    }
    const data = await res.json();
    return NextResponse.json({ available: true, ...data });
  } catch {
    return NextResponse.json({ available: false, error: SETUP_MESSAGE }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Forward any body from the client (Pipecat /start may accept config)
    let body: string | undefined;
    try {
      const text = await req.text();
      if (text) body = text;
    } catch {
      // empty body is fine
    }

    const res = await fetch(`${PIPECAT_URL}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body || "{}",
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown error");
      return NextResponse.json(
        {
          error: `Optional voice avatar backend returned ${res.status}: ${errText}`,
          setup: SETUP_MESSAGE,
        },
        { status: 503 }
      );
    }

    const data = await res.json();
    // Expected shape: { room_url, room_name, user_token }
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start avatar session";
    return NextResponse.json({ error: msg, setup: SETUP_MESSAGE }, { status: 503 });
  }
}
