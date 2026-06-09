import { spawn, spawnSync } from "node:child_process";

const EXTERNAL_RUNNER_ENV_DENYLIST = [
  "HIVERUNNER_RUNTIME_PROMOTION_BASELINE_DB",
  "HIVERUNNER_RUNTIME_PROMOTION_BASELINE_SUMMARIES",
  "HIVERUNNER_RUNTIME_PROMOTION_BASELINE_SUMMARY",
  "HIVERUNNER_RUNTIME_PROMOTION_CANDIDATE_SUMMARIES",
  "HIVERUNNER_RUNTIME_PROMOTION_CANDIDATE_SUMMARY",
  "HIVERUNNER_RUNTIME_PROMOTION_DB",
  "HIVERUNNER_RUNTIME_PROMOTION_EVIDENCE",
  "HIVERUNNER_RUNTIME_PROMOTION_EXPECTED_TASKS",
  "HIVERUNNER_RUNTIME_PROMOTION_FORMAT",
  "HIVERUNNER_RUNTIME_PROMOTION_GATE",
  "HIVERUNNER_RUNTIME_PROMOTION_GATE_ONLY",
  "HIVERUNNER_RUNTIME_PROMOTION_GOAL",
  "HIVERUNNER_RUNTIME_PROMOTION_OUT",
  "HIVERUNNER_RUNTIME_PROMOTION_REQUIRED_REPEATS",
  "HIVERUNNER_EPHEMERAL_DATA_DIR",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_API_KEY",
  "MC_API_KEY",
  "MC_APP_ROOT",
  "MC_DATA_DIR",
  "MC_DEV_EXECUTION_TEST_MODE",
  "MC_ENGINE_TICK",
  "MC_LOG_DIR",
  "MC_SWEEP_COMPANIES",
  "MC_SWEEP_INTERVAL_MS",
  "MC_TICK_MAX_CONCURRENT",
  "MC_WORKSPACE_ROOT",
  "OPENAI_API_BASE",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
  "OPENROUTER_API_KEY",
  "ORCHESTRATION_DB_PATH",
  "PORT",
  "WORKSPACE_ROOT",
];

export function buildExternalRunnerEnv(overrides = {}) {
  const env = {
    ...process.env,
    ...overrides,
  };
  for (const key of EXTERNAL_RUNNER_ENV_DENYLIST) {
    delete env[key];
  }
  return env;
}

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

function processGroupId(pid) {
  if (!pid || process.platform === "win32") return null;
  try {
    const result = spawnSync("ps", ["-o", "pgid=", "-p", String(pid)], {
      encoding: "utf8",
    });
    if (result.status !== 0) return null;
    const parsed = Number.parseInt(result.stdout.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function childProcessIds(pid) {
  if (process.platform === "win32") return [];
  try {
    const result = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
    if (result.status !== 0 && !result.stdout.trim()) return [];
    return result.stdout
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value > 0);
  } catch {
    return [];
  }
}

function descendantProcessIds(pid) {
  const seen = new Set();
  const visit = (parentPid) => {
    for (const childPid of childProcessIds(parentPid)) {
      if (seen.has(childPid)) continue;
      seen.add(childPid);
      visit(childPid);
    }
  };
  visit(pid);
  return [...seen];
}

function signalProcessGroup(pid, pgid, signal) {
  if (process.platform === "win32" || !pid || !pgid || pgid !== pid) return false;
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false;
  }
}

function signalDescendants(pid, signal) {
  const descendants = pid ? descendantProcessIds(pid).reverse() : [];
  for (const childPid of descendants) {
    try {
      process.kill(childPid, signal);
    } catch {
      // The child may have exited while walking the process tree.
    }
  }
  return descendants.length;
}

function terminateChildProcess(child, { pid, pgid, signal, terminateProcessTree }) {
  if (!terminateProcessTree) {
    child.kill(signal);
    return "process";
  }

  if (signalProcessGroup(pid, pgid, signal)) return "process_group";

  const descendantCount = signalDescendants(pid, signal);
  child.kill(signal);
  return descendantCount > 0 ? "process_tree" : "process";
}

function signalExitCode(signal) {
  switch (signal) {
    case "SIGINT":
      return 130;
    case "SIGTERM":
      return 143;
    case "SIGHUP":
      return 129;
    default:
      return 1;
  }
}

function noOutputError({ noOutputTimedOut, noOutputTimeoutMs, describeNoOutputTimeout }) {
  if (!noOutputTimedOut) return null;
  return describeNoOutputTimeout?.({ noOutputTimeoutMs }) ?? `Command produced no stdout/stderr for ${noOutputTimeoutMs}ms`;
}

function timeoutError({ timedOut, timeoutMs, describeTimeout }) {
  return timedOut ? describeTimeout({ timeoutMs }) : null;
}

function bufferLimitError({ killedForBuffer, maxBufferBytes, describeBufferLimit }) {
  return killedForBuffer ? describeBufferLimit({ maxBufferBytes }) : null;
}

function exitError({ exitCode, signal, describeExit }) {
  return exitCode === 0 ? null : describeExit({ exitCode, signal });
}

function commandError(input) {
  return input.spawnError ??
    noOutputError(input) ??
    timeoutError(input) ??
    bufferLimitError(input) ??
    exitError(input);
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
  noOutputTimeoutMs,
  progressIntervalMs,
  terminationGraceMs = 5_000,
  terminateProcessTree = false,
  describeTimeout,
  describeNoOutputTimeout,
  describeBufferLimit,
  describeExit,
  isMeaningfulOutput,
  onProgress,
  onStdout,
  onStderr,
}) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio,
      detached: terminateProcessTree && process.platform !== "win32",
    });
    const pid = child.pid;
    const pgid = terminateProcessTree ? processGroupId(pid) : null;
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let noOutputTimedOut = false;
    let killedForBuffer = false;
    let forcedKilled = false;
    let spawnError = null;
    let lastOutputAt = null;
    let terminationReason = null;
    let terminationSignalMethod = null;
    let lastMeaningfulOutputAt = null;
    const timer = setTimeout(() => {
      timedOut = true;
      requestTermination("timeout");
    }, timeoutMs);
    let noOutputTimer = null;
    let progressTimer = null;
    let forceKillTimer = null;
    let parentExitTimer = null;
    let parentTerminationSignal = null;
    const parentSignalHandlers = new Map();

    const clearRuntimeTimers = () => {
      clearTimeout(timer);
      if (noOutputTimer) clearTimeout(noOutputTimer);
      if (progressTimer) clearInterval(progressTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (parentExitTimer) clearTimeout(parentExitTimer);
    };

    const removeParentSignalHandlers = () => {
      for (const [signal, handler] of parentSignalHandlers) {
        process.off(signal, handler);
      }
      parentSignalHandlers.clear();
    };

    function requestTermination(reason) {
      if (!terminationReason) terminationReason = reason;
      if (!terminationSignalMethod) {
        terminationSignalMethod = terminateChildProcess(child, {
          pid,
          pgid,
          signal: "SIGTERM",
          terminateProcessTree,
        });
      }
      if (terminationGraceMs > 0 && !forceKillTimer) {
        forceKillTimer = setTimeout(() => {
          forcedKilled = true;
          terminationSignalMethod = terminateChildProcess(child, {
            pid,
            pgid,
            signal: "SIGKILL",
            terminateProcessTree,
          });
        }, terminationGraceMs);
      }
    }

    const requestParentSignalTermination = (signal) => {
      parentTerminationSignal = signal;
      requestTermination(`parent_signal:${signal}`);
      if (!parentExitTimer) {
        parentExitTimer = setTimeout(() => {
          process.exit(signalExitCode(signal));
        }, Math.max(terminationGraceMs, 0) + 250);
      }
    };

    if (terminateProcessTree) {
      for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
        const handler = () => requestParentSignalTermination(signal);
        parentSignalHandlers.set(signal, handler);
        process.once(signal, handler);
      }
    }

    const resetNoOutputTimer = () => {
      if (!noOutputTimeoutMs) return;
      if (noOutputTimer) clearTimeout(noOutputTimer);
      noOutputTimer = setTimeout(() => {
        noOutputTimedOut = true;
        requestTermination("no_output_timeout");
      }, noOutputTimeoutMs);
    };

    if (noOutputTimeoutMs) resetNoOutputTimer();
    if (progressIntervalMs && onProgress) {
      progressTimer = setInterval(() => {
        onProgress({
          durationMs: Date.now() - startedAt,
          silentForMs: Date.now() - (lastOutputAt ?? startedAt),
          meaningfulSilentForMs: Date.now() - (lastMeaningfulOutputAt ?? startedAt),
          lastOutputAt,
          lastMeaningfulOutputAt,
          stdoutBytes,
          stderrBytes,
        });
      }, progressIntervalMs);
    }

    const outputCountsForNoOutput = (stream, chunk) => {
      if (!isMeaningfulOutput) return true;
      try {
        return isMeaningfulOutput({
          stream,
          chunk,
          stdoutBytes,
          stderrBytes,
          lastOutputAt,
          lastMeaningfulOutputAt,
        }) === true;
      } catch {
        return true;
      }
    };

    child.stdout?.on("data", (chunk) => {
      lastOutputAt = Date.now();
      stdoutBytes += chunk.length;
      const isMeaningful = outputCountsForNoOutput("stdout", chunk);
      try {
        onStdout?.(chunk);
      } catch {
        // Output taps are observational and must not break command execution.
      }
      if (stdoutBytes <= maxBufferBytes) stdoutChunks.push(chunk);
      if (isMeaningful) {
        lastMeaningfulOutputAt = lastOutputAt;
        resetNoOutputTimer();
      }
      if (stdoutBytes > maxBufferBytes && !killedForBuffer) {
        killedForBuffer = true;
        requestTermination("buffer_limit");
      }
    });
    child.stderr?.on("data", (chunk) => {
      lastOutputAt = Date.now();
      stderrBytes += chunk.length;
      const isMeaningful = outputCountsForNoOutput("stderr", chunk);
      try {
        onStderr?.(chunk);
      } catch {
        // Output taps are observational and must not break command execution.
      }
      if (stderrBytes <= maxBufferBytes) stderrChunks.push(chunk);
      if (isMeaningful) {
        lastMeaningfulOutputAt = lastOutputAt;
        resetNoOutputTimer();
      }
    });
    child.on("error", (error) => {
      spawnError = error.message;
    });
    child.on("close", (exitCode, signal) => {
      clearRuntimeTimers();
      removeParentSignalHandlers();
      if (parentTerminationSignal) {
        process.exit(signalExitCode(parentTerminationSignal));
      }
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const error = commandError({
        spawnError,
        noOutputTimedOut,
        noOutputTimeoutMs,
        timedOut,
        timeoutMs,
        killedForBuffer,
        maxBufferBytes,
        exitCode,
        signal,
        describeNoOutputTimeout,
        describeTimeout,
        describeBufferLimit,
        describeExit,
      });
      resolve({
        stdout,
        stderr,
        exitCode,
        signal,
        error,
        timedOut,
        noOutputTimedOut,
        killedForBuffer,
        forcedKilled,
        terminationReason,
        terminationSignalMethod,
        stdoutBytes,
        stderrBytes,
        lastOutputAt,
        lastMeaningfulOutputAt,
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
