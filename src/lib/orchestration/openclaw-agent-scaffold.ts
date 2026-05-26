import fs from "fs";
import os from "os";
import path from "path";

import { OrchestrationApiError } from "@/lib/orchestration/api";

type OpenClawAgentScaffoldInput = {
  openclawAgentId: string;
  name: string;
  role: string;
  personality: string;
  projectName: string;
  projectSlug: string;
  model?: string;
  skills: string[];
  soulMarkdown?: string;
  voiceId?: string | null;
  avatar?: {
    styleId?: string;
    gender?: string;
    age?: number;
    hairColor?: string;
    hairLength?: string;
    eyeColor?: string;
    vibe?: string;
  } | null;
};

const OPENCLAW_AGENT_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

function resolveOpenClawDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OPENCLAW_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(os.homedir(), ".openclaw");
}

function buildSoulMarkdown(input: OpenClawAgentScaffoldInput): string {
  const lines: string[] = [
    "# Identity",
    `Name: ${input.name}`,
    `Role: ${input.role}`,
    "",
    "# Mission",
    `Build and operate HiveRunner work for project \`${input.projectName}\` (\`${input.projectSlug}\`).`,
    "",
    "# Working Rules",
    "- Validate every endpoint and input contract.",
    "- Keep route handlers thin; put logic in typed backend modules.",
    "- Return predictable, machine-parseable error payloads.",
    "- Favor durable migrations over ad-hoc schema edits.",
    "- Preserve compatibility for SQLite now and Postgres later.",
  ];

  if (input.personality.trim()) {
    lines.push("", "# Personality", input.personality.trim());
  }

  if (input.skills.length > 0) {
    lines.push("", "# Skills", ...input.skills.map((skill) => `- ${skill}`));
  }

  return `${lines.join("\n")}\n`;
}

function buildAgentConfig(input: OpenClawAgentScaffoldInput): Record<string, unknown> {
  return {
    id: input.openclawAgentId,
    name: input.name,
    role: input.role,
    model: input.model ?? "gpt-5.3-codex",
    project: {
      slug: input.projectSlug,
      name: input.projectName,
    },
    permissions: {
      filesystem: "workspace",
      network: true,
    },
    tools: ["shell", "git"],
    metadata: {
      generatedBy: "hiverunner",
      generatedAt: new Date().toISOString(),
      voiceId: input.voiceId ?? null,
      avatar: input.avatar ?? null,
    },
  };
}

export function ensureOpenClawAgentScaffold(input: OpenClawAgentScaffoldInput): {
  agentDir: string;
  createdAgentJson: boolean;
  createdSoul: boolean;
} {
  if (!OPENCLAW_AGENT_ID_PATTERN.test(input.openclawAgentId)) {
    throw new OrchestrationApiError(
      400,
      "invalid_openclaw_agent_id",
      "openclawAgentId must only contain letters, numbers, dot, underscore, or hyphen"
    );
  }

  const openclawDir = resolveOpenClawDir();
  const agentDir = path.join(openclawDir, "agents", input.openclawAgentId);
  const memoryDir = path.join(agentDir, "memory");
  const agentJsonPath = path.join(agentDir, "agent.json");
  const soulPath = path.join(agentDir, "SOUL.md");

  fs.mkdirSync(memoryDir, { recursive: true });

  let createdAgentJson = false;
  if (!fs.existsSync(agentJsonPath)) {
    fs.writeFileSync(agentJsonPath, `${JSON.stringify(buildAgentConfig(input), null, 2)}\n`, "utf8");
    createdAgentJson = true;
  }

  let createdSoul = false;
  if (!fs.existsSync(soulPath)) {
    fs.writeFileSync(soulPath, input.soulMarkdown?.trim() ? `${input.soulMarkdown.trim()}\n` : buildSoulMarkdown(input), "utf8");
    createdSoul = true;
  }

  return { agentDir, createdAgentJson, createdSoul };
}
