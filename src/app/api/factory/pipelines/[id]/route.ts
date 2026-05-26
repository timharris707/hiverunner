import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import type { FactoryPipeline } from "@/types/factory";

const DATA_PATH = path.join(process.cwd(), "data/factory/pipelines.json");

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

/** GET /api/factory/pipelines/[id] — get a single pipeline */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pipelines = readPipelines();
  const pipeline = pipelines.find((p) => p.id === id);
  if (!pipeline) {
    return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
  }
  return NextResponse.json({ pipeline });
}

/** PATCH /api/factory/pipelines/[id] — update pipeline fields */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const pipelines = readPipelines();
  const index = pipelines.findIndex((p) => p.id === id);

  if (index === -1) {
    return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
  }

  const pipeline = pipelines[index];
  const updatable = ["name", "description", "status", "assignedAgent", "idea", "architecture", "build", "test", "deploy"] as const;

  for (const key of updatable) {
    if (body[key] !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pipeline as any)[key] = body[key];
    }
  }
  pipeline.updatedAt = new Date().toISOString();
  pipelines[index] = pipeline;
  writePipelines(pipelines);

  return NextResponse.json({ pipeline });
}

/** DELETE /api/factory/pipelines/[id] — remove a pipeline */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pipelines = readPipelines();
  const index = pipelines.findIndex((p) => p.id === id);

  if (index === -1) {
    return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
  }

  pipelines.splice(index, 1);
  writePipelines(pipelines);

  return NextResponse.json({ ok: true });
}
