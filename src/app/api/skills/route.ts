import { NextRequest, NextResponse } from 'next/server';
import { scanAllSkills, addConfiguredSkill, removeConfiguredSkill } from '@/lib/skill-parser';

export async function GET() {
  try {
    const skills = scanAllSkills();
    return NextResponse.json({ skills });
  } catch (error) {
    console.error('Failed to scan skills:', error);
    return NextResponse.json({ skills: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, location } = body as { name?: string; location?: string };

    if (!name || typeof name !== "string" || name.trim().length < 1) {
      return NextResponse.json(
        { error: { code: "invalid_name", message: "Skill name is required" } },
        { status: 400 }
      );
    }

    if (!location || typeof location !== "string" || location.trim().length < 1) {
      return NextResponse.json(
        { error: { code: "invalid_location", message: "Skill location is required (workspace, system, or absolute path)" } },
        { status: 400 }
      );
    }

    const result = addConfiguredSkill(name.trim(), location.trim());
    if (!result.ok) {
      return NextResponse.json(
        { error: { code: result.code, message: result.message } },
        { status: result.status }
      );
    }

    return NextResponse.json({ skill: result.skill }, { status: 201 });
  } catch (error) {
    console.error("Failed to add skill:", error);
    return NextResponse.json(
      { error: { code: "internal_error", message: "Failed to add skill" } },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { name } = body as { name?: string };

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: { code: "invalid_name", message: "Skill name is required" } },
        { status: 400 }
      );
    }

    const result = removeConfiguredSkill(name.trim());
    if (!result.ok) {
      return NextResponse.json(
        { error: { code: result.code, message: result.message } },
        { status: result.status }
      );
    }

    return NextResponse.json({ removed: name.trim() });
  } catch (error) {
    console.error("Failed to remove skill:", error);
    return NextResponse.json(
      { error: { code: "internal_error", message: "Failed to remove skill" } },
      { status: 500 }
    );
  }
}
