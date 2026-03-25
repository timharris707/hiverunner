import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const filePath = path.join(DATA_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const session = JSON.parse(raw);

    const url = new URL(req.url);
    const after = url.searchParams.get("after");

    let events = session.events || [];
    if (after) {
      const idx = events.findIndex((e: { id: string }) => e.id === after);
      if (idx !== -1) {
        events = events.slice(idx + 1);
      }
    }

    return NextResponse.json({
      events,
      status: session.status,
      paused: session.paused ?? false,
      thinkingAgent: session.thinkingAgent ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
