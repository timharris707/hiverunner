import { spawn } from "node:child_process";

export function readStdin() {
  return new Promise((resolve, reject) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      body += chunk;
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(body));
  });
}

export function splitCommandLine(value) {
  const parts = [];
  const pattern = /"((?:[^"\\]|\\.)*)"|'([^']*)'|[^\s]+/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    if (match[1] !== undefined) {
      parts.push(match[1].replace(/\\"/g, "\"").replace(/\\\\/g, "\\"));
    } else if (match[2] !== undefined) {
      parts.push(match[2]);
    } else {
      parts.push(match[0]);
    }
  }
  return parts;
}

export function stringFrom(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function numberFromEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function numberFrom(value) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function runBufferedCommand({
  command,
  args,
  cwd,
  env,
  stdio = ["ignore", "pipe", "pipe"],
  stdin,
  timeoutMs,
  maxBufferBytes,
  describeTimeout,
  describeBufferLimit,
  describeExit,
}) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio });
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let killedForBuffer = false;
    let spawnError = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= maxBufferBytes) stdoutChunks.push(chunk);
      if (stdoutBytes > maxBufferBytes && !killedForBuffer) {
        killedForBuffer = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= maxBufferBytes) stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const error =
        spawnError ??
        (timedOut ? describeTimeout({ timeoutMs }) : null) ??
        (killedForBuffer ? describeBufferLimit({ maxBufferBytes }) : null) ??
        (exitCode === 0 ? null : describeExit({ exitCode, signal }));
      resolve({
        stdout,
        stderr,
        exitCode,
        signal,
        error,
        durationMs: Date.now() - startedAt,
      });
    });
    if (stdin !== undefined) child.stdin?.end(stdin);
  });
}

export function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function stringArrayFrom(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function firstString(values) {
  for (const value of values) {
    const text = stringFrom(value);
    if (text) return text;
  }
  return "";
}

function firstStringOrFallback(values, fallback) {
  const text = firstString(values);
  return text || fallback;
}

function optionalJoinedLine(label, values) {
  if (values.length === 0) return "";
  return `${label}: ${values.join(", ")}`;
}

function trustedRuntimeLine(runtimeCapabilities) {
  if (!runtimeCapabilities.trustedLocalExecution) return "";
  return "This task is running in a trusted local HiveRunner runtime. Use local services and verification tools when the task requires them, and report any unavailable capability explicitly.";
}

function externalRunnerPromptParts(payload) {
  const task = asRecord(payload.task) ?? {};
  const project = asRecord(task.project) ?? {};
  const company = asRecord(task.company) ?? {};
  const workspace = asRecord(payload.workspace) ?? {};
  const runtimeCapabilities = asRecord(workspace.runtimeCapabilities) ?? {};
  return {
    task,
    project,
    company,
    workspace,
    runtimeCapabilities,
    capabilities: stringArrayFrom(runtimeCapabilities.capabilities),
    additionalWritableDirs: stringArrayFrom(workspace.additionalWritableDirs),
  };
}

export function buildExternalRunnerPrompt(payload, introLine) {
  const parts = externalRunnerPromptParts(payload);
  const context = [
    introLine,
    "",
    `HiveRunner run ID: ${firstStringOrFallback([payload.runId], "unknown")}`,
    `Task: ${firstStringOrFallback([parts.task.key, parts.task.id], "unknown")} - ${firstStringOrFallback([parts.task.title], "Untitled task")}`,
    `Project: ${firstStringOrFallback([parts.project.name, parts.project.slug], "unknown")}`,
    `Company: ${firstStringOrFallback([parts.company.name, parts.company.slug, parts.company.code], "unknown")}`,
    `Source workspace for code changes and tests: ${firstStringOrFallback([parts.workspace.sourceWorkspaceRoot, parts.workspace.cwd], "unknown")}`,
    `Company workspace for HiveRunner artifacts: ${firstStringOrFallback([parts.workspace.companyWorkspaceRoot], "unknown")}`,
    optionalJoinedLine("Additional writable directories", parts.additionalWritableDirs),
    optionalJoinedLine("Trusted local runtime capabilities", parts.capabilities),
    trustedRuntimeLine(parts.runtimeCapabilities),
    "",
    "HiveRunner is the source of truth for task state. If you need to update HiveRunner task state, include a fenced mc-action block in your final response.",
    "Make product code changes in the source workspace. Use the company workspace only for HiveRunner artifacts, notes, or task outputs when requested.",
  ].join("\n");

  return [context, stringFrom(payload.prompt)].filter(Boolean).join("\n\n");
}
