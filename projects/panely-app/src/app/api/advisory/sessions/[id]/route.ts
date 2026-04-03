import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");

async function getAuthUser() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

function loadSession(id: string) {
  const filePath = path.join(DATA_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function canAccess(session: { userId?: string }, userId: string) {
  // Sessions without userId are legacy (dev data); allow access
  return !session.userId || session.userId === userId;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const session = loadSession(id);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    if (!canAccess(session, user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ session });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const session = loadSession(id);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

    if (!canAccess(session, user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const filePath = path.join(DATA_DIR, `${id}.json`);
    const updates = await req.json();
    const updated = { ...session, ...updates };
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
    return NextResponse.json({ session: updated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
