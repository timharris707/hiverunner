import { NextResponse } from "next/server";
import { execSync } from "child_process";

import { COMPANY_WIZARD_MODEL_FALLBACK } from "@/lib/orchestration/company-wizard";

export const dynamic = "force-dynamic";

interface OpenClawModel {
  key: string;
  name: string;
  input: string;
  contextWindow: number;
  local: boolean;
  available: boolean;
  tags: string[];
  missing: boolean;
}

function friendlyLabel(model: OpenClawModel): string {
  const alias = model.tags.find((t) => t.startsWith("alias:"));
  const aliasLabel = alias ? alias.slice(6) : null;
  const cleanName = model.name
    .replace(/^(gpt|claude|gemini|gemma|glm|qwen|mimo)-?/i, (m) => m.toUpperCase())
    .replace(/-/g, " ")
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
  // Use alias if descriptive enough; otherwise capitalize the model name
  if (aliasLabel && aliasLabel.length >= 8) return aliasLabel;
  return cleanName;
}

function providerFromKey(key: string): string {
  const slash = key.indexOf("/");
  return slash > 0 ? key.slice(0, slash) : key;
}

// Cache the model list — openclaw models list takes ~10s and the catalog
// doesn't change during a server lifetime. Cache for 10 minutes.
let cachedModels: { models: ReturnType<typeof transformModels>; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

function transformModels(parsed: { models: OpenClawModel[] }) {
  return parsed.models
    .filter((m) => m.available && !m.missing)
    .map((m) => ({
      value: m.key,
      label: friendlyLabel(m),
      provider: providerFromKey(m.key),
      contextWindow: m.contextWindow,
      input: m.input,
      local: m.local,
      tags: m.tags,
    }));
}

export async function GET() {
  // Serve from cache if fresh
  if (cachedModels && Date.now() - cachedModels.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ models: cachedModels.models, source: "openclaw-cached", count: cachedModels.models.length });
  }

  try {
    const output = execSync("/opt/homebrew/bin/openclaw models list --json", {
      encoding: "utf-8",
      timeout: 30000,
    });
    const parsed = JSON.parse(output) as { count: number; models: OpenClawModel[] };
    const models = transformModels(parsed);
    cachedModels = { models, fetchedAt: Date.now() };
    return NextResponse.json({ models, source: "openclaw", count: models.length });
  } catch {
    return NextResponse.json({
      models: COMPANY_WIZARD_MODEL_FALLBACK,
      source: "fallback",
      count: COMPANY_WIZARD_MODEL_FALLBACK.length,
    });
  }
}
