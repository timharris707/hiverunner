import { execFile } from "child_process";
import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { promisify } from "util";
import type Database from "better-sqlite3";

import { isPathContained } from "@/lib/workspaces/delete-safety";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_PROJECT = "chromium";
const DEFAULT_ARTIFACT_ROOT = path.join("output", "browser-proof");
const SAFE_SPEC_PATTERN = /^e2e\/[A-Za-z0-9._/-]+\.spec\.[tj]sx?$/;
const SAFE_PROJECT_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export type BrowserProofUrlTarget = {
  label?: string;
  path?: string;
  url?: string;
  fullPage?: boolean;
  viewport?: {
    width?: number;
    height?: number;
  };
};

export type CaptureBrowserProofAction = {
  taskKey: string;
  baseUrl?: string;
  specs?: string[];
  urls?: BrowserProofUrlTarget[];
  project?: string;
  timeoutMs?: number;
};

type BrowserProofCommandInput = {
  cwd: string;
  artifactDir: string;
  baseUrl: string;
  specs: string[];
  project: string;
  timeoutMs: number;
};

type BrowserProofCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CaptureBrowserProofOptions = CaptureBrowserProofAction & {
  runId: string;
  executionRunId?: string | null;
  cwd?: string;
  artifactRoot?: string;
  audit?: BrowserProofAuditContext;
  runner?: (input: BrowserProofCommandInput) => Promise<BrowserProofCommandResult>;
};

export type BrowserProofAuditContext = {
  db?: Database.Database;
  companyId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
  taskKey?: string | null;
};

export type BrowserProofArtifact = {
  path: string;
  uri: string;
  kind: "image" | "video" | "file";
  size: number;
  sha256: string;
};

export type CaptureBrowserProofResult = {
  ok: boolean;
  exitCode: number;
  command: string;
  artifactDir: string;
  manifestPath: string;
  manifestUri: string;
  manifestSha256: string;
  artifacts: BrowserProofArtifact[];
  commentBody: string;
  stdoutTail: string;
  stderrTail: string;
};

function safeSegment(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 80) || fallback;
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.trunc(value), MAX_TIMEOUT_MS);
}

function normalizeProject(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_PROJECT;
  if (!SAFE_PROJECT_PATTERN.test(trimmed)) throw new Error("capture_browser_proof: invalid Playwright project name");
  return trimmed;
}

function defaultBaseUrl(): string {
  const configured = process.env.HIVERUNNER_BROWSER_PROOF_BASE_URL?.trim() || process.env.BASE_URL?.trim();
  if (configured) return configured;
  const port = process.env.PORT?.trim() || "3001";
  return `http://localhost:${port}`;
}

function normalizeLocalUrl(raw: string, baseUrl: string): string {
  const parsed = new URL(raw, baseUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("capture_browser_proof: only http(s) targets are supported");
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("capture_browser_proof: browser proof targets must be local");
  }
  return parsed.toString();
}

function normalizeBaseUrl(value: string | undefined): string {
  return normalizeLocalUrl(value?.trim() || defaultBaseUrl(), defaultBaseUrl()).replace(/\/$/, "");
}

async function resolveContainedPath(root: string, target: string): Promise<string> {
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(target);
  await fs.mkdir(rootPath, { recursive: true });
  const realRoot = await fs.realpath(rootPath);
  const existingParent = await fs.realpath(path.dirname(targetPath)).catch(() => path.dirname(targetPath));
  const realTarget = path.resolve(existingParent, path.basename(targetPath));
  if (!isPathContained(realRoot, realTarget)) {
    throw new Error("capture_browser_proof: artifact path escaped the proof root");
  }
  return targetPath;
}

function normalizeSpecs(input: { specs?: string[]; cwd: string }): string[] {
  const specs = input.specs?.map((spec) => spec.trim()).filter(Boolean) ?? [];
  return specs.map((spec) => {
    const normalized = spec.replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (!SAFE_SPEC_PATTERN.test(normalized) || normalized.includes("..")) {
      throw new Error(`capture_browser_proof: invalid spec path ${spec}`);
    }
    const absolute = path.resolve(input.cwd, normalized);
    const e2eRoot = path.resolve(input.cwd, "e2e");
    if (!isPathContained(e2eRoot, absolute)) {
      throw new Error(`capture_browser_proof: spec outside e2e ${spec}`);
    }
    return normalized;
  });
}

function normalizeViewport(viewport: BrowserProofUrlTarget["viewport"]): { width: number; height: number } {
  const width = Number(viewport?.width);
  const height = Number(viewport?.height);
  return {
    width: Number.isFinite(width) && width >= 320 && width <= 3840 ? Math.trunc(width) : 1320,
    height: Number.isFinite(height) && height >= 320 && height <= 2400 ? Math.trunc(height) : 900,
  };
}

async function writeGeneratedUrlSpec(input: {
  cwd: string;
  artifactDir: string;
  baseUrl: string;
  taskKey: string;
  runId: string;
  urls?: BrowserProofUrlTarget[];
}): Promise<string | null> {
  const targets = input.urls?.filter((target) => target && (target.path || target.url)) ?? [];
  if (targets.length === 0) return null;

  const cases = targets.map((target, index) => {
    const label = safeSegment(target.label || target.path || target.url || `target-${index + 1}`, `target-${index + 1}`);
    const targetUrl = normalizeLocalUrl(target.url || target.path || "/", input.baseUrl);
    return {
      label,
      url: targetUrl,
      fullPage: target.fullPage !== false,
      viewport: normalizeViewport(target.viewport),
      screenshotPath: path.join(input.artifactDir, `${String(index + 1).padStart(2, "0")}-${label}.png`),
    };
  });

  const specDir = path.join(input.cwd, "e2e", ".generated-browser-proof");
  await fs.mkdir(specDir, { recursive: true });
  const specName = `${safeSegment(input.taskKey, "task")}-${safeSegment(input.runId, "run")}.spec.ts`;
  const specPath = path.join(specDir, specName);
  const content = `import { expect, test } from "@playwright/test";

const cases = ${JSON.stringify(cases, null, 2)};

for (const item of cases) {
  test(\`browser proof: \${item.label}\`, async ({ page }) => {
    const consoleIssues: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("__nextjs_original-stack-frames")) {
        consoleIssues.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      if (!error.message.includes("__nextjs_original-stack-frames")) {
        consoleIssues.push(error.message);
      }
    });

    await page.setViewportSize(item.viewport);
    await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: item.screenshotPath, fullPage: item.fullPage });
    expect(consoleIssues).toEqual([]);
  });
}
`;
  await fs.writeFile(specPath, content, "utf8");
  return path.relative(input.cwd, specPath).replace(/\\/g, "/");
}

async function runPlaywrightProofCommand(input: BrowserProofCommandInput): Promise<BrowserProofCommandResult> {
  const playwrightBin = path.join(input.cwd, "node_modules", ".bin", "playwright");
  const args = [
    playwrightBin,
    "test",
    ...input.specs,
    `--project=${input.project}`,
    `--output=${path.join(input.artifactDir, "test-results")}`,
  ];

  try {
    const result = await execFileAsync(process.execPath, args, {
      cwd: input.cwd,
      encoding: "utf8",
      timeout: input.timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: buildBrowserProofChildEnv({
        baseUrl: input.baseUrl,
        artifactDir: input.artifactDir,
      }),
    });
    return { exitCode: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string | null };
    const code = typeof err.code === "number" ? err.code : 1;
    return { exitCode: code, stdout: err.stdout ?? "", stderr: err.stderr ?? err.message ?? "" };
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

function artifactKind(filePath: string): BrowserProofArtifact["kind"] {
  const ext = path.extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return "image";
  if ([".webm", ".mp4"].includes(ext)) return "video";
  return "file";
}

async function collectArtifacts(root: string, manifestPath: string): Promise<BrowserProofArtifact[]> {
  const collected: BrowserProofArtifact[] = [];
  async function visit(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile() || fullPath === manifestPath || fullPath.endsWith(".spec.ts")) continue;
      const stat = await fs.stat(fullPath);
      collected.push({
        path: fullPath,
        uri: pathToFileURL(fullPath).href,
        kind: artifactKind(fullPath),
        size: stat.size,
        sha256: await sha256File(fullPath),
      });
    }
  }
  await visit(root);
  return collected.sort((a, b) => a.path.localeCompare(b.path));
}

function tail(value: string, max = 4000): string {
  return value.length > max ? value.slice(value.length - max) : value;
}

function commandSummary(input: BrowserProofCommandInput): string {
  return `BASE_URL=${input.baseUrl} playwright test ${input.specs.join(" ")} --project=${input.project}`;
}

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return row?.name === tableName;
}

export function buildBrowserProofChildEnv(input: {
  baseUrl: string;
  artifactDir: string;
}): NodeJS.ProcessEnv {
  const allowedKeys = [
    "CI",
    "DISPLAY",
    "HOME",
    "LANG",
    "LC_ALL",
    "LOGNAME",
    "NODE_ENV",
    "PATH",
    "PLAYWRIGHT_BROWSERS_PATH",
    "TMPDIR",
    "USER",
    "XDG_CACHE_HOME",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of allowedKeys) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.BASE_URL = input.baseUrl;
  env.HIVERUNNER_BROWSER_PROOF_ARTIFACT_DIR = input.artifactDir;
  env.PLAYWRIGHT_HTML_REPORT = path.join(input.artifactDir, "html-report");
  return env;
}

function recordBrowserProofAudit(input: {
  audit?: BrowserProofAuditContext;
  runId: string;
  executionRunId?: string | null;
  taskKey: string;
  baseUrl: string;
  command: string;
  project: string;
  specs: string[];
  urls?: BrowserProofUrlTarget[];
  artifactDir: string;
  manifestPath: string;
  manifestSha256: string;
  artifacts: BrowserProofArtifact[];
  exitCode: number;
  durationMs: number;
}): void {
  const db = input.audit?.db;
  if (!db) return;
  try {
    if (!hasTable(db, "runtime_browser_proof_audit")) return;
    const screenshots = input.artifacts.filter((artifact) => artifact.kind === "image").length;
    const videos = input.artifacts.filter((artifact) => artifact.kind === "video").length;
    db.prepare(
      `INSERT INTO runtime_browser_proof_audit
         (id, company_id, agent_id, task_id, task_key, heartbeat_run_id, execution_run_id,
          status, exit_code, duration_ms, base_url, project, command, artifact_dir,
          manifest_path, manifest_sha256, artifact_count, screenshot_count, video_count,
          specs_json, urls_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      input.audit?.companyId ?? null,
      input.audit?.agentId ?? null,
      input.audit?.taskId ?? null,
      input.audit?.taskKey ?? input.taskKey,
      input.runId,
      input.executionRunId ?? null,
      input.exitCode === 0 ? "succeeded" : "failed",
      input.exitCode,
      Math.max(0, Math.round(input.durationMs)),
      input.baseUrl,
      input.project,
      input.command,
      input.artifactDir,
      input.manifestPath,
      input.manifestSha256,
      input.artifacts.length,
      screenshots,
      videos,
      JSON.stringify(input.specs),
      JSON.stringify(input.urls ?? []),
      new Date().toISOString(),
    );
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[browser-proof] failed to record proof audit row", err);
    }
  }
}

function buildComment(input: {
  taskKey: string;
  ok: boolean;
  exitCode: number;
  command: string;
  manifestPath: string;
  manifestSha256: string;
  artifacts: BrowserProofArtifact[];
  stderrTail: string;
}): string {
  const screenshots = input.artifacts.filter((artifact) => artifact.kind === "image");
  const videos = input.artifacts.filter((artifact) => artifact.kind === "video");
  const lines = [
    `**Browser proof ${input.ok ? "captured" : "failed"}**`,
    "",
    `Task: ${input.taskKey}`,
    `Command: \`${input.command}\``,
    `Exit code: ${input.exitCode}`,
    `Manifest: \`${input.manifestPath}\``,
    `Manifest sha256: \`${input.manifestSha256}\``,
    `Screenshots: ${screenshots.length}`,
    `Videos: ${videos.length}`,
  ];
  for (const artifact of [...screenshots, ...videos].slice(0, 12)) {
    lines.push(`- ${artifact.kind}: \`${artifact.path}\` (${artifact.sha256})`);
  }
  if (!input.ok && input.stderrTail.trim()) {
    lines.push("", "**Failure tail**", "```text", input.stderrTail.trim().slice(-1200), "```");
  }
  return lines.join("\n");
}

export async function captureBrowserProof(input: CaptureBrowserProofOptions): Promise<CaptureBrowserProofResult> {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const project = normalizeProject(input.project);
  const timeoutMs = boundedTimeout(input.timeoutMs);
  const artifactRoot = path.resolve(cwd, input.artifactRoot ?? DEFAULT_ARTIFACT_ROOT);
  const artifactDir = await resolveContainedPath(
    artifactRoot,
    path.join(artifactRoot, `${safeSegment(input.taskKey, "task")}-${safeSegment(input.runId, "run")}`),
  );
  await fs.mkdir(artifactDir, { recursive: true });

  const specs = normalizeSpecs({ specs: input.specs, cwd });
  const generatedSpec = await writeGeneratedUrlSpec({
    cwd,
    artifactDir,
    baseUrl,
    taskKey: input.taskKey,
    runId: input.runId,
    urls: input.urls,
  });
  if (generatedSpec) specs.push(generatedSpec);
  if (specs.length === 0) {
    throw new Error("capture_browser_proof: provide at least one spec or local URL target");
  }

  const commandInput = { cwd, artifactDir, baseUrl, specs, project, timeoutMs };
  const command = commandSummary(commandInput);
  const runner = input.runner ?? runPlaywrightProofCommand;
  const startedAt = Date.now();
  let commandResult: BrowserProofCommandResult;
  try {
    commandResult = await runner(commandInput);
  } finally {
    if (generatedSpec) {
      const generatedSpecPath = path.resolve(cwd, generatedSpec);
      await fs.rm(generatedSpecPath, { force: true }).catch(() => undefined);
      await fs.rmdir(path.dirname(generatedSpecPath)).catch(() => undefined);
    }
  }
  const manifestPath = path.join(artifactDir, "manifest.json");
  const artifacts = await collectArtifacts(artifactDir, manifestPath);

  const manifest = {
    schema: "hiverunner.browser_proof_manifest.v1",
    taskKey: input.taskKey,
    runId: input.runId,
    baseUrl,
    command,
    project,
    exitCode: commandResult.exitCode,
    ok: commandResult.exitCode === 0,
    capturedAt: new Date().toISOString(),
    artifacts,
    stdoutTail: tail(commandResult.stdout),
    stderrTail: tail(commandResult.stderr),
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  const manifestSha256 = await sha256File(manifestPath);
  const stderrTail = tail(commandResult.stderr);
  recordBrowserProofAudit({
    audit: input.audit,
    runId: input.runId,
    executionRunId: input.executionRunId ?? null,
    taskKey: input.taskKey,
    baseUrl,
    command,
    project,
    specs,
    urls: input.urls,
    artifactDir,
    manifestPath,
    manifestSha256,
    artifacts,
    exitCode: commandResult.exitCode,
    durationMs: Date.now() - startedAt,
  });

  return {
    ok: commandResult.exitCode === 0,
    exitCode: commandResult.exitCode,
    command,
    artifactDir,
    manifestPath,
    manifestUri: pathToFileURL(manifestPath).href,
    manifestSha256,
    artifacts,
    stdoutTail: tail(commandResult.stdout),
    stderrTail,
    commentBody: buildComment({
      taskKey: input.taskKey,
      ok: commandResult.exitCode === 0,
      exitCode: commandResult.exitCode,
      command,
      manifestPath,
      manifestSha256,
      artifacts,
      stderrTail,
    }),
  };
}
