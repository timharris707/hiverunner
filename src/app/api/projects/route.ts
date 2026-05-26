import { NextResponse } from "next/server";
import { getProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ projects: getProjects() });
  } catch (error) {
    console.error("Error reading projects:", error);
    return NextResponse.json({ error: "Failed to load projects" }, { status: 500 });
  }
}
