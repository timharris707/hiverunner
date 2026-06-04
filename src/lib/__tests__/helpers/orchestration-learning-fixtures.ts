import assert from "node:assert";

import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createCompany } from "@/lib/orchestration/company-service";
import { createProject, createProjectAgent } from "@/lib/orchestration/service";

type FixtureName = string | ((stamp: number) => string);

type CompanyProjectAgentFixtureOptions = {
  companyName: FixtureName;
  projectName: FixtureName;
  projectColor?: string;
  projectEmoji?: string;
  agentName: FixtureName;
  emoji: string;
  role: string;
  personality?: string;
};

function resolveFixtureName(name: FixtureName, stamp: number): string {
  return typeof name === "function" ? name(stamp) : name;
}

export function jsonRequest(url: string, body: Record<string, unknown>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function assertJsonErrorCode(
  res: Response,
  status: number,
  code: string,
): Promise<void> {
  assert.strictEqual(res.status, status);
  const payload = await res.json() as { error?: { code?: string } };
  assert.strictEqual(payload.error?.code, code);
}

export function resetLearningTestDatabase(): void {
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);
}

export function createCompanyProjectAgentFixture(options: CompanyProjectAgentFixtureOptions) {
  const stamp = Date.now();
  const company = createCompany({
    name: resolveFixtureName(options.companyName, stamp),
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: resolveFixtureName(options.projectName, stamp),
    description: "fixture project",
    color: options.projectColor ?? "#22d3ee",
    emoji: options.projectEmoji ?? "icon:folder",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: resolveFixtureName(options.agentName, stamp),
    emoji: options.emoji,
    role: options.role,
    personality: options.personality ?? "Precise test fixture agent.",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;

  return { agent, company, project, stamp };
}
