import { promises as fs } from "fs";
import path from "path";

import type { ResolvedVoiceBinding } from "@/lib/voice-binding";
import { OPENCLAW_WORKSPACE, WORKSPACE_MEMORY } from "@/lib/paths";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import {
  ensureCompanyWorkspaceScaffold,
  resolveCanonicalCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";
import { resolveHiveRunnerWorkspaceRoot } from "@/lib/workspaces/root";

export interface VoiceTranscriptEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

export interface PersistedVoiceTranscript {
  filePath: string;
  filename: string;
  relativePath: string;
  rollupPath: string;
  rollupRelativePath: string;
  workspaceRoot: string;
  workspaceKind: "company" | "lane";
  durationSeconds: number;
  messages: number;
}

interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  matches: number;
}

interface VoiceTranscriptPersistOptions {
  binding?: ResolvedVoiceBinding | null;
  sessionId?: string | null;
}

interface VoiceMemoryLocation {
  workspaceRoot: string;
  workspaceKind: "company" | "lane" | "legacy-openclaw";
  workspaceLabel: string;
  voiceDir: string;
  rollupPath: string;
}

const PACIFIC_TIMEZONE = "America/Los_Angeles";
const LEGACY_VOICE_MEMORY_DIR = path.join(WORKSPACE_MEMORY, "voice");
const LEGACY_VOICE_MEMORY_ROLLUP = path.join(LEGACY_VOICE_MEMORY_DIR, "VOICE_MEMORY.md");
const LONG_TERM_MEMORY_FILE = path.join(OPENCLAW_WORKSPACE, "MEMORY.md");
const ROOT_MEMORY_FILES = [
  "MEMORY.md",
  "SOUL.md",
  "USER.md",
  "AGENTS.md",
  "TOOLS.md",
  "IDENTITY.md",
  "HEARTBEAT.md",
];

function getPacificParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

function clip(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function tailLines(text: string, count: number) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-count).join("\n");
}

function extractSection(markdown: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^##\\s+${escaped}\\s*[\\r\\n]+([\\s\\S]*?)(?=^##\\s+|\\Z)`, "m");
  const match = markdown.match(regex);
  return match?.[1]?.trim() ?? "";
}

function summarizeMessages(entries: VoiceTranscriptEntry[], role: "user" | "assistant", limit = 3) {
  return entries
    .filter((entry) => entry.role === role && entry.text.trim())
    .slice(0, limit)
    .map((entry) => `- ${clip(entry.text.replace(/\s+/g, " ").trim(), 180)}`)
    .join("\n");
}

async function readFileIfExists(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function getVoiceRollupSections(markdown: string, limit: number) {
  const sections = [...markdown.matchAll(/^##\s+[\s\S]*?(?=^##\s+|\Z)/gm)]
    .map((match) => match[0].trim())
    .filter(Boolean);

  return sections.slice(-limit).join("\n\n");
}

async function searchFiles(filePaths: Array<{ filePath: string; displayPath: string }>, query: string, limit = 5) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [] as SearchResult[];

  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
  const results = await Promise.all(
    filePaths.map(async ({ filePath, displayPath }) => {
      const content = await readFileIfExists(filePath);
      if (!content) return null;

      const lower = content.toLowerCase();
      let matches = 0;
      for (const word of queryWords) {
        let from = 0;
        while (true) {
          const idx = lower.indexOf(word, from);
          if (idx === -1) break;
          matches += 1;
          from = idx + word.length;
        }
      }

      if (!matches) return null;

      const firstIdx = lower.indexOf(queryWords[0]);
      const snippetStart = Math.max(0, firstIdx - 80);
      const snippetEnd = Math.min(content.length, firstIdx + 220);
      let snippet = content.slice(snippetStart, snippetEnd).replace(/\n+/g, " ").trim();
      if (snippetStart > 0) snippet = `...${snippet}`;
      if (snippetEnd < content.length) snippet = `${snippet}...`;

      const headingMatch = content.match(/^#\s+(.+)/m);
      return {
        path: displayPath,
        title: headingMatch?.[1] ?? path.basename(displayPath, ".md"),
        snippet,
        matches,
      } satisfies SearchResult;
    })
  );

  return results
    .filter((result): result is SearchResult => Boolean(result))
    .sort((a, b) => b.matches - a.matches)
    .slice(0, limit);
}

function buildSearchSummary(results: SearchResult[]) {
  return results.map((result) => ({
    path: result.path,
    title: result.title,
    snippet: result.snippet,
    matches: result.matches,
  }));
}

function buildUnboundHiveRunnerVoiceLocation(env: NodeJS.ProcessEnv = process.env): VoiceMemoryLocation {
  const workspaceRoot = path.join(resolveHiveRunnerWorkspaceRoot(env), "_voice-lab");
  const voiceDir = path.join(workspaceRoot, "memory", "voice");
  return {
    workspaceRoot,
    workspaceKind: "lane",
    workspaceLabel: "hiverunner-voice-lab",
    voiceDir,
    rollupPath: path.join(voiceDir, "VOICE_MEMORY.md"),
  };
}

function buildLegacyOpenClawVoiceLocation(): VoiceMemoryLocation {
  return {
    workspaceRoot: OPENCLAW_WORKSPACE,
    workspaceKind: "legacy-openclaw",
    workspaceLabel: "legacy-openclaw-workspace",
    voiceDir: LEGACY_VOICE_MEMORY_DIR,
    rollupPath: LEGACY_VOICE_MEMORY_ROLLUP,
  };
}

async function resolveBoundHiveRunnerVoiceLocation(
  binding?: ResolvedVoiceBinding | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VoiceMemoryLocation | null> {
  if (!binding || binding.scope === "global" || !binding.companySlug) {
    return null;
  }

  const company = resolveCompanyIdBySlug(binding.companySlug);
  if (!company) {
    return null;
  }

  const workspaceRoot = resolveCanonicalCompanyWorkspaceRoot(
    company.id,
    company.workspace_slug ?? company.slug,
    env,
  );
  const { memoryDir } = ensureCompanyWorkspaceScaffold(workspaceRoot);
  const voiceDir = path.join(memoryDir, "voice");

  return {
    workspaceRoot,
    workspaceKind: "company",
    workspaceLabel: `company:${company.slug}`,
    voiceDir,
    rollupPath: path.join(voiceDir, "VOICE_MEMORY.md"),
  };
}

async function resolveWriteLocation(
  binding?: ResolvedVoiceBinding | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VoiceMemoryLocation> {
  return (await resolveBoundHiveRunnerVoiceLocation(binding, env)) ?? buildUnboundHiveRunnerVoiceLocation(env);
}

async function listKnownVoiceLocations(env: NodeJS.ProcessEnv = process.env): Promise<VoiceMemoryLocation[]> {
  const locations: VoiceMemoryLocation[] = [
    buildUnboundHiveRunnerVoiceLocation(env),
    buildLegacyOpenClawVoiceLocation(),
  ];

  const companiesRoot = path.join(resolveHiveRunnerWorkspaceRoot(env), "companies");
  try {
    const entries = await fs.readdir(companiesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const workspaceRoot = path.join(companiesRoot, entry.name);
      const voiceDir = path.join(workspaceRoot, "memory", "voice");
      locations.push({
        workspaceRoot,
        workspaceKind: "company",
        workspaceLabel: `company:${entry.name}`,
        voiceDir,
        rollupPath: path.join(voiceDir, "VOICE_MEMORY.md"),
      });
    }
  } catch {
    // No company workspaces yet.
  }

  const deduped = new Map<string, VoiceMemoryLocation>();
  for (const location of locations) {
    deduped.set(path.resolve(location.voiceDir), location);
  }
  return [...deduped.values()];
}

async function listRecentVoiceTranscriptFiles(limit = 6, env: NodeJS.ProcessEnv = process.env) {
  const locations = await listKnownVoiceLocations(env);
  const files: Array<{ filePath: string; displayPath: string; mtimeMs: number }> = [];

  for (const location of locations) {
    try {
      const entries = await fs.readdir(location.voiceDir);
      for (const entry of entries) {
        if (!/^\d{4}-\d{2}-\d{2}-\d{6}\.md$/.test(entry)) continue;
        const filePath = path.join(location.voiceDir, entry);
        const stat = await fs.stat(filePath);
        files.push({
          filePath,
          displayPath: `${location.workspaceLabel}/${path.relative(location.workspaceRoot, filePath)}`,
          mtimeMs: stat.mtimeMs,
        });
      }
    } catch {
      // Location missing or unreadable.
    }
  }

  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}

async function listRecentVoiceRollups(limit = 6, env: NodeJS.ProcessEnv = process.env) {
  const locations = await listKnownVoiceLocations(env);
  const rollups: Array<{ filePath: string; displayPath: string; mtimeMs: number }> = [];

  for (const location of locations) {
    if (!(await pathExists(location.rollupPath))) continue;
    const stat = await fs.stat(location.rollupPath);
    rollups.push({
      filePath: location.rollupPath,
      displayPath: `${location.workspaceLabel}/${path.relative(location.workspaceRoot, location.rollupPath)}`,
      mtimeMs: stat.mtimeMs,
    });
  }

  return rollups.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}

function buildBindingSummary(binding?: ResolvedVoiceBinding | null): string[] {
  if (!binding || binding.scope === "global") {
    return ["**Binding:** Unbound HiveRunner voice lab"];
  }

  const lines = [
    `**Binding:** ${binding.scope}-bound · ${binding.mode} · ${binding.source}`,
  ];

  if (binding.companySlug) lines.push(`**Company:** ${binding.companySlug}`);
  if (binding.projectName || binding.projectSlug || binding.projectId) {
    lines.push(`**Project:** ${binding.projectName ?? binding.projectSlug ?? binding.projectId}`);
  }
  if (binding.taskKey || binding.taskTitle || binding.taskId) {
    lines.push(`**Task:** ${binding.taskKey ?? binding.taskId ?? "Task"}${binding.taskTitle ? ` — ${binding.taskTitle}` : ""}`);
  }
  if (binding.agentName || binding.agentId) {
    lines.push(`**Agent:** ${binding.agentName ?? binding.agentId}`);
  }
  return lines;
}

export async function persistVoiceTranscript(
  transcript: VoiceTranscriptEntry[],
  options?: VoiceTranscriptPersistOptions,
): Promise<PersistedVoiceTranscript> {
  const location = await resolveWriteLocation(options?.binding);
  await fs.mkdir(location.voiceDir, { recursive: true });

  const now = new Date();
  const pacific = getPacificParts(now);
  const filename = `${pacific.year}-${pacific.month}-${pacific.day}-${pacific.hour}${pacific.minute}${pacific.second}.md`;
  const relativePath = path.join("memory", "voice", filename);
  const filePath = path.join(location.voiceDir, filename);
  const rollupRelativePath = path.join("memory", "voice", "VOICE_MEMORY.md");

  const durationSeconds = transcript.length > 1
    ? Math.max(0, Math.round((transcript[transcript.length - 1].timestamp - transcript[0].timestamp) / 1000))
    : 0;

  let markdown = `# Voice Session — ${now.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric", timeZone: PACIFIC_TIMEZONE })} ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: PACIFIC_TIMEZONE })}\n\n`;
  markdown += `**Duration:** ${formatDuration(durationSeconds)} · **Messages:** ${transcript.length}\n`;
  markdown += `**Stored in:** ${location.workspaceLabel}\n`;
  if (options?.sessionId?.trim()) {
    markdown += `**Session ID:** ${options.sessionId.trim()}\n`;
  }
  markdown += `${buildBindingSummary(options?.binding).join("\n")}\n\n---\n\n`;

  for (const entry of transcript) {
    const speaker = entry.role === "user" ? "**Operator:**" : "**Assistant:**";
    markdown += `${speaker} ${entry.text}\n\n`;
  }

  await fs.writeFile(filePath, markdown, "utf-8");

  const userSummary = summarizeMessages(transcript, "user") || "- No user transcript captured";
  const assistantSummary = summarizeMessages(transcript, "assistant") || "- No assistant transcript captured";
  const binding = options?.binding;
  const rollupEntry = [
    `## ${pacific.year}-${pacific.month}-${pacific.day} ${pacific.hour}:${pacific.minute}:${pacific.second} PT`,
    `- Transcript: ${relativePath}`,
    `- Workspace: ${location.workspaceLabel}`,
    `- Duration: ${formatDuration(durationSeconds)}`,
    `- Messages: ${transcript.length}`,
    `- Scope: ${binding?.scope === "global" || !binding ? "voice-lab" : `${binding.scope}-bound`}`,
    ...(binding?.projectName || binding?.projectSlug || binding?.projectId
      ? [`- Project: ${binding.projectName ?? binding.projectSlug ?? binding.projectId}`]
      : []),
    ...(binding?.taskKey || binding?.taskTitle || binding?.taskId
      ? [`- Task: ${binding.taskKey ?? binding.taskId ?? "Task"}${binding.taskTitle ? ` — ${binding.taskTitle}` : ""}`]
      : []),
    ...(binding?.agentName || binding?.agentId ? [`- Agent: ${binding.agentName ?? binding.agentId}`] : []),
    "- Operator highlights:",
    userSummary,
    "- Assistant highlights:",
    assistantSummary,
    "",
  ].join("\n");

  const existingRollup = await readFileIfExists(location.rollupPath);
  const rollupHeader = "# Voice Memory\n\nRolling memory for voice-only conversations inside HiveRunner. Each entry points to a full transcript under `memory/voice/` so bound task/project sessions keep their own durable trail outside the workspace.\n\n";
  const nextRollup = existingRollup.trim()
    ? `${existingRollup.trimEnd()}\n\n${rollupEntry}`
    : `${rollupHeader}${rollupEntry}`;

  await fs.writeFile(location.rollupPath, nextRollup, "utf-8");

  return {
    filePath,
    filename,
    relativePath,
    rollupPath: location.rollupPath,
    rollupRelativePath,
    workspaceRoot: location.workspaceRoot,
    workspaceKind: location.workspaceKind === "company" ? "company" : "lane",
    durationSeconds,
    messages: transcript.length,
  };
}

export async function getRecentVoiceMemoryContext(limit = 4) {
  const rollups = await listRecentVoiceRollups(limit);
  const rollupSections: string[] = [];

  for (const rollup of rollups) {
    const content = await readFileIfExists(rollup.filePath);
    const sections = getVoiceRollupSections(content, 1);
    if (sections.trim()) {
      rollupSections.push(sections);
    }
    if (rollupSections.length >= limit) {
      break;
    }
  }

  if (rollupSections.length > 0) {
    return clip(rollupSections.join("\n\n"), 4000);
  }

  const transcripts = await listRecentVoiceTranscriptFiles(limit);
  if (!transcripts.length) return "No saved voice memories yet.";

  const previews = await Promise.all(
    transcripts.map(async ({ filePath, displayPath }) => {
      const content = await readFileIfExists(filePath);
      return `## ${displayPath}\n${clip(tailLines(content, 12), 800)}`;
    })
  );

  return previews.join("\n\n");
}

export async function buildCurrentVoiceContext() {
  const now = new Date();
  const longTermMemory = await readFileIfExists(LONG_TERM_MEMORY_FILE);
  const core = extractSection(longTermMemory, "Core");
  const workingStyle = extractSection(longTermMemory, "Working Style");
  const hardRules = extractSection(longTermMemory, "Hard Rules (PERMANENT)");
  const dailyFiles = await listRecentDailyMemoryFiles(2);
  const dailyMemories = await Promise.all(dailyFiles.map((filePath) => readFileIfExists(filePath)));
  const recentVoice = await getRecentVoiceMemoryContext(4);

  return [
    `Current Pacific time: ${now.toLocaleString("en-US", { timeZone: PACIFIC_TIMEZONE })}`,
    "",
    "### Fresh long-term memory",
    clip([core, workingStyle, hardRules].filter(Boolean).join("\n\n"), 4500) || "No long-term memory loaded.",
    "",
    "### Fresh operating context from recent daily memory",
    clip(
      dailyMemories
        .map((content, idx) => `#### ${path.basename(dailyFiles[idx])}\n${tailLines(content, 60)}`)
        .join("\n\n"),
      6000
    ) || "No recent daily notes found.",
    "",
    "### Recent voice-only memory lane",
    recentVoice,
  ].join("\n");
}

async function listRecentDailyMemoryFiles(limit = 5) {
  try {
    const entries = await fs.readdir(WORKSPACE_MEMORY);
    return entries
      .filter((entry) => /^\d{4}-\d{2}-\d{2}\.md$/.test(entry))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((entry) => path.join(WORKSPACE_MEMORY, entry));
  } catch {
    return [] as string[];
  }
}

export async function searchVoiceMemory(query: string, limit = 5) {
  const rollups = await listRecentVoiceRollups(12);
  const transcripts = await listRecentVoiceTranscriptFiles(12);
  const voiceFiles = [
    ...rollups.map(({ filePath, displayPath }) => ({ filePath, displayPath })),
    ...transcripts.map(({ filePath, displayPath }) => ({ filePath, displayPath })),
  ];

  const results = await searchFiles(voiceFiles, query, limit);
  return {
    query,
    count: results.length,
    results: buildSearchSummary(results),
  };
}

export async function searchWorkspaceMemory(query: string, limit = 5) {
  const rootFiles = ROOT_MEMORY_FILES.map((file) => ({
    filePath: path.join(OPENCLAW_WORKSPACE, file),
    displayPath: file,
  }));
  const dailyFiles = (await listRecentDailyMemoryFiles(10)).map((filePath) => ({
    filePath,
    displayPath: `memory/${path.basename(filePath)}`,
  }));

  const results = await searchFiles([...rootFiles, ...dailyFiles], query, limit);
  return {
    query,
    count: results.length,
    results: buildSearchSummary(results),
  };
}
