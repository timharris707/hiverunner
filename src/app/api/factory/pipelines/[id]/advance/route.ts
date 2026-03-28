import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import type { FactoryPipeline, PipelineStage } from "@/types/factory";

const DATA_PATH = path.join(process.cwd(), "data/factory/pipelines.json");

const STAGE_ORDER: PipelineStage[] = ["idea", "architecture", "build", "test", "deploy"];

function readPipelines(): FactoryPipeline[] {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writePipelines(pipelines: FactoryPipeline[]) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(pipelines, null, 2));
}

/**
 * POST /api/factory/pipelines/[id]/advance
 * Advance a pipeline to the next stage.
 * Body can include stage-specific data to persist.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const pipelines = readPipelines();
  const index = pipelines.findIndex((p) => p.id === id);

  if (index === -1) {
    return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
  }

  const pipeline = pipelines[index];

  if (pipeline.status !== "active") {
    return NextResponse.json(
      { error: `Pipeline is ${pipeline.status}, cannot advance` },
      { status: 400 }
    );
  }

  const currentIdx = STAGE_ORDER.indexOf(pipeline.stage);

  // If at deploy and advancing, mark completed
  if (currentIdx === STAGE_ORDER.length - 1) {
    pipeline.status = "completed";
    pipeline.updatedAt = new Date().toISOString();
    if (body.deploy) pipeline.deploy = { ...pipeline.deploy, ...body.deploy };
    pipelines[index] = pipeline;
    writePipelines(pipelines);
    return NextResponse.json({ pipeline, completed: true });
  }

  const nextStage = STAGE_ORDER[currentIdx + 1];
  const now = new Date().toISOString();

  // Persist any stage data sent in the body
  if (body.stageData) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pipeline as any)[pipeline.stage] = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(pipeline as any)[pipeline.stage],
      ...body.stageData,
    };
  }

  pipeline.stageHistory.push({
    from: pipeline.stage,
    to: nextStage,
    timestamp: now,
    agent: body.agent || pipeline.assignedAgent || "system",
    summary: body.summary,
  });

  pipeline.stage = nextStage;
  pipeline.updatedAt = now;

  // Auto-assign agents based on stage
  const stageAgents: Record<PipelineStage, string> = {
    idea: "scout",
    architecture: "forge",
    build: "pixel",
    test: "forge",
    deploy: "forge",
  };
  pipeline.assignedAgent = stageAgents[nextStage];

  pipelines[index] = pipeline;
  writePipelines(pipelines);

  return NextResponse.json({ pipeline, advanced: true, newStage: nextStage });
}
