import { promises as fs } from "fs";
import path from "path";
import { OPENCLAW_WORKSPACE, WORKSPACE_MEMORY } from "@/lib/paths";

export interface VoiceTranscriptEntry {
  role: "user" | "henry";
  text: string;
  timestamp: number;
}

interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  matches: number;
}

const PACIFIC_TIMEZONE = "America/Los_Angeles";
const VOICE_MEMORY_DIR = path.join(WORKSPACE_MEMORY, "voice");
const VOICE_MEMORY_ROLLUP = path.join(VOICE_MEMORY_DIR, "VOICE_MEMORY.md");
const LONG_TERM_MEMORY_FILE = path.join(OPENCLAW_WORKSPACE, "MEMORY.md");
const HEARTBEAT_FILE = path.join(OPENCLAW_WORKSPACE, "HEARTBEAT.md");
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

function summarizeMessages(entries: VoiceTranscriptEntry[], role: "user" | "henry", limit = 3) {
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

async function listRecentVoiceTranscriptFiles(limit = 6) {
  try {
    const entries = await fs.readdir(VOICE_MEMORY_DIR);
    return entries
      .filter((entry) => /^\d{4}-\d{2}-\d{2}-\d{6}\.md$/.test(entry))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((entry) => path.join(VOICE_MEMORY_DIR, entry));
  } catch {
    return [] as string[];
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

export async function persistVoiceTranscript(transcript: VoiceTranscriptEntry[]) {
  await fs.mkdir(VOICE_MEMORY_DIR, { recursive: true });

  const now = new Date();
  const pacific = getPacificParts(now);
  const filename = `${pacific.year}-${pacific.month}-${pacific.day}-${pacific.hour}${pacific.minute}${pacific.second}.md`;
  const relativePath = `memory/voice/${filename}`;
  const filePath = path.join(VOICE_MEMORY_DIR, filename);

  const durationSeconds = transcript.length > 1
    ? Math.max(0, Math.round((transcript[transcript.length - 1].timestamp - transcript[0].timestamp) / 1000))
    : 0;

  let markdown = `# Voice Session — ${now.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric", timeZone: PACIFIC_TIMEZONE })} ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: PACIFIC_TIMEZONE })}\n\n`;
  markdown += `**Duration:** ${formatDuration(durationSeconds)} · **Messages:** ${transcript.length}\n\n---\n\n`;

  for (const entry of transcript) {
    const speaker = entry.role === "user" ? "**Tim:**" : "**Henry ⚡:**";
    markdown += `${speaker} ${entry.text}\n\n`;
  }

  await fs.writeFile(filePath, markdown, "utf-8");

  const userSummary = summarizeMessages(transcript, "user") || "- No user transcript captured";
  const henrySummary = summarizeMessages(transcript, "henry") || "- No Henry transcript captured";
  const rollupEntry = [
    `## ${pacific.year}-${pacific.month}-${pacific.day} ${pacific.hour}:${pacific.minute}:${pacific.second} PT`,
    `- Transcript: ${relativePath}`,
    `- Duration: ${formatDuration(durationSeconds)}`,
    `- Messages: ${transcript.length}`,
    "- Tim highlights:",
    userSummary,
    "- Henry highlights:",
    henrySummary,
    "",
  ].join("\n");

  const existingRollup = await readFileIfExists(VOICE_MEMORY_ROLLUP);
  const rollupHeader = "# Voice Memory\n\nRolling memory for Henry's voice-only conversations with Tim. Each entry points to a full transcript under `memory/voice/` so Voice Henry can review this lane independently of text-chat sessions.\n\n";
  const nextRollup = existingRollup.trim()
    ? `${existingRollup.trimEnd()}\n\n${rollupEntry}`
    : `${rollupHeader}${rollupEntry}`;

  await fs.writeFile(VOICE_MEMORY_ROLLUP, nextRollup, "utf-8");

  return {
    filePath,
    filename,
    relativePath,
    durationSeconds,
    messages: transcript.length,
  };
}

export async function getRecentVoiceMemoryContext(limit = 4) {
  const rollup = await readFileIfExists(VOICE_MEMORY_ROLLUP);
  const rollupSections = getVoiceRollupSections(rollup, limit);
  if (rollupSections.trim()) {
    return clip(rollupSections, 4000);
  }

  const transcripts = await listRecentVoiceTranscriptFiles(limit);
  if (!transcripts.length) return "No saved voice memories yet.";

  const previews = await Promise.all(
    transcripts.map(async (filePath) => {
      const content = await readFileIfExists(filePath);
      return `## ${path.basename(filePath)}\n${clip(tailLines(content, 12), 800)}`;
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
  const heartbeat = await readFileIfExists(HEARTBEAT_FILE);
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
    "### Heartbeat / current-ops instructions",
    clip(tailLines(heartbeat, 80), 4000) || "No heartbeat instructions found.",
    "",
    "### Recent voice-only memory lane",
    recentVoice,
  ].join("\n");
}

export async function searchVoiceMemory(query: string, limit = 5) {
  const voiceFiles = [
    { filePath: VOICE_MEMORY_ROLLUP, displayPath: "memory/voice/VOICE_MEMORY.md" },
    ...((await listRecentVoiceTranscriptFiles(10)).map((filePath) => ({
      filePath,
      displayPath: `memory/voice/${path.basename(filePath)}`,
    }))),
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
  const dailyFiles = (await listRecentDailyMemoryFiles(14)).map((filePath) => ({
    filePath,
    displayPath: `memory/${path.basename(filePath)}`,
  }));
  const voiceRollup = { filePath: VOICE_MEMORY_ROLLUP, displayPath: "memory/voice/VOICE_MEMORY.md" };

  const results = await searchFiles([...rootFiles, ...dailyFiles, voiceRollup], query, limit);
  return {
    query,
    count: results.length,
    results: buildSearchSummary(results),
  };
}
