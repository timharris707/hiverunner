import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");

export async function POST(
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

    const { text } = await req.json();
    if (!text?.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const eventId = `evt_${String(Date.now()).slice(-6)}`;
    const event = {
      id: eventId,
      timestamp: new Date().toISOString(),
      type: "supervisor",
      speaker: "Tim",
      emoji: "👤",
      role: "supervisor",
      text: `**[Human Directive]** ${text}`,
    };

    session.events = [...(session.events || []), event];
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));

    return NextResponse.json({ event });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
