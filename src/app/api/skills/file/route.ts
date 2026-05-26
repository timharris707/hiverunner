import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { scanAllSkills } from "@/lib/skill-parser";

export async function GET(req: NextRequest) {
  const skillName = req.nextUrl.searchParams.get("skill");
  const filePath = req.nextUrl.searchParams.get("path");

  if (!skillName || !filePath) {
    return NextResponse.json({ error: "skill and path are required" }, { status: 400 });
  }

  // Find the skill by name to get its location
  const skills = scanAllSkills();
  const skill = skills.find((s) => s.name === skillName || s.id === skillName);
  if (!skill) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }

  // Resolve and validate the file path (prevent directory traversal)
  const normalizedPath = path.normalize(filePath);
  const fullPath = path.resolve(skill.location, normalizedPath);
  if (!fullPath.startsWith(skill.location)) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
  }

  if (!fs.existsSync(fullPath)) {
    return NextResponse.json({ error: "File not found", path: filePath }, { status: 404 });
  }

  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: "Path is a directory" }, { status: 400 });
    }
    // Limit file size to 100KB
    if (stat.size > 100_000) {
      return NextResponse.json({
        content: null,
        truncated: true,
        size: stat.size,
        path: filePath,
      });
    }
    const content = fs.readFileSync(fullPath, "utf-8");
    return NextResponse.json({
      content,
      truncated: false,
      size: stat.size,
      path: filePath,
    });
  } catch {
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }
}
