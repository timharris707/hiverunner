import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import type { FactoryPipeline, IdeaStage } from "@/types/factory";

const DATA_PATH = path.join(process.cwd(), "data/factory/pipelines.json");

function readPipelines(): FactoryPipeline[] {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writePipelines(pipelines: FactoryPipeline[]) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(pipelines, null, 2));
}

/** GET /api/factory/pipelines — list all pipelines */
export async function GET() {
  const pipelines = readPipelines();
  return NextResponse.json({ pipelines });
}

/** POST /api/factory/pipelines — create a new pipeline */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, description, source, idea } = body as {
    name: string;
    description: string;
    source?: "manual" | "reddit" | "idea-intake";
    idea?: IdeaStage;
  };

  if (!name || !description) {
    return NextResponse.json({ error: "name and description are required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const pipeline: FactoryPipeline = {
    id: `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    description,
    source: source || "manual",
    stage: "idea",
    status: "active",
    createdAt: now,
    updatedAt: now,
    assignedAgent: "scout",
    idea: idea || {
      problem: description,
      targetAudience: "TBD",
    },
    stageHistory: [
      { from: "created", to: "idea", timestamp: now, agent: "system" },
    ],
  };

  const pipelines = readPipelines();
  pipelines.unshift(pipeline);
  writePipelines(pipelines);

  return NextResponse.json({ pipeline }, { status: 201 });
}
