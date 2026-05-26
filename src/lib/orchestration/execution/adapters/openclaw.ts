/**
 * HiveRunner — OpenClaw Execution Adapter
 *
 * Dispatches a heartbeat turn against the OpenClaw gateway.
 *
 * History: session key handling went through three landings on
 * 2026-04-17 (commits 9fa8d15b → 0df97ad4 → 1c39a5e2) before the
 * self-heal loop closed. The rules captured here:
 *   - Resumes use the stored key, or a deterministic legacy key
 *     when the stored value is absent.
 *   - Fresh creates append a random suffix to the deterministic
 *     key AND to the session label so OpenClaw cannot silently
 *     hand back a degraded session under a colliding key.
 *   - No silent fallback to `sessions.get-by-key` when the
 *     fresh create returns no session id.
 */

import { randomUUID } from "crypto";
import fs from "fs";
import type Database from "better-sqlite3";

import type {
  CancelAdapterResult,
  ExecutionAdapter,
  ExecutionInput,
  ExecutionResult,
  ExecutionSelfHealInput,
} from "./types";

function resolveOpenClawBin(): string {
  const explicit = process.env.ORCHESTRATION_OPENCLAW_CLI?.trim();
  if (explicit) return explicit;
  for (const candidate of ["/opt/homebrew/bin/openclaw", "/usr/local/bin/openclaw"]) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return "openclaw";
}

export const OPENCLAW_BIN = resolveOpenClawBin();

const GATEWAY_ENV = {
  ...process.env,
  PATH: ["/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? ""].join(":"),
} as NodeJS.ProcessEnv;

export async function callGateway<T>(
  _command: string,
  method: string,
  params: Record<string, unknown>,
  execFileAsync: (
    cmd: string,
    args: string[],
    opts: { maxBuffer: number; env: NodeJS.ProcessEnv },
  ) => Promise<{ stdout: string }>,
): Promise<T | undefined> {
  const command = resolveOpenClawBin();
  try {
    const { stdout } = await execFileAsync(
      command,
      ["gateway", "call", method, "--json", "--params", JSON.stringify(params)],
      { maxBuffer: 2 * 1024 * 1024, env: GATEWAY_ENV },
    );
    return JSON.parse(stdout) as T;
  } catch (err) {
    const primaryMsg = err instanceof Error ? err.message : String(err);
    if (primaryMsg.includes("unknown method")) {
      try {
        const fallbackMethod = method.replace(".", "_");
        const { stdout } = await execFileAsync(
          command,
          ["gateway", "call", fallbackMethod, "--json", "--params", JSON.stringify(params)],
          { maxBuffer: 2 * 1024 * 1024, env: GATEWAY_ENV },
        );
        return JSON.parse(stdout) as T;
      } catch (fallbackErr) {
        console.error(
          `[engine] gateway call ${method} failed:`,
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        );
        return undefined;
      }
    }
    console.error(`[engine] gateway call ${method} failed:`, primaryMsg);
    return undefined;
  }
}

async function execute(input: ExecutionInput): Promise<ExecutionResult> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const { agent, prompt, session } = input;
  const existingSessionId = session.sessionParams.sessionId as string | undefined;
  const existingSessionKey = session.sessionParams.sessionKey as string | undefined;
  const openclawAgentId = agent.openclaw_agent_id;

  if (!openclawAgentId) {
    return {
      error: "Agent has no openclaw_agent_id mapping. Cannot execute via OpenClaw gateway.",
    };
  }

  try {
    const deterministicKey = `agent:${openclawAgentId}:heartbeat:${session.taskKey}`;
    const resumeSessionKey = existingSessionKey ?? deterministicKey;
    const freshSuffix = randomUUID().slice(0, 8);
    const freshSessionKey = `${deterministicKey}:${freshSuffix}`;

    let messageCountBefore = 0;

    if (existingSessionId) {
      const liveState = await callGateway<{
        sessionId?: string;
        status?: string;
        messages?: unknown[];
      }>(OPENCLAW_BIN, "sessions.get", { key: resumeSessionKey }, execFileAsync);

      messageCountBefore = Array.isArray(liveState?.messages) ? liveState.messages.length : 0;

      const sendResult = await callGateway<{ runId?: string; status?: string }>(
        OPENCLAW_BIN,
        "sessions.send",
        { key: resumeSessionKey, message: prompt },
        execFileAsync,
      );

      if (sendResult?.runId || sendResult?.status === "started") {
        return {
          sessionId: existingSessionId,
          sessionKey: resumeSessionKey,
          messageCountBefore,
          runnerProvider: "openclaw",
          runnerModel: null,
          usage: {
            runnerProvider: "openclaw",
            runnerModel: null,
            openclawRunId: sendResult.runId ?? null,
            openclawStatus: sendResult.status ?? null,
            integrationPath: "openclaw-gateway-sessions",
            invocationMode: "gateway.sessions.send",
            promptDelivery: "json_params_message",
            jsonEventCapture: false,
            sessionReused: true,
          },
        };
      }
      // Resume send returned nothing — treat as stale session and fall
      // through to a fresh create with a NEW random-suffix key. Do NOT
      // re-derive to `resumeSessionKey`; that's the potentially-degraded
      // key we just failed to send to.
      console.log(
        `[engine] openclaw resume send returned no runId on ${resumeSessionKey}; creating fresh session instead`,
      );
    }

    // Fresh create path: random-suffix key + label guarantee no silent
    // collision with a degraded session under a stale deterministic key.
    const createResult = await callGateway<{ sessionId: string; key: string; ok?: boolean }>(
      OPENCLAW_BIN,
      "sessions.create",
      {
        key: freshSessionKey,
        agentId: openclawAgentId,
        label: `Heartbeat: ${agent.name} [${session.taskKey.slice(0, 8)}·${freshSuffix}]`,
      },
      execFileAsync,
    );
    const newSessionId = createResult?.sessionId;

    if (!newSessionId) {
      // Intentionally no sessions.get-by-key fallback. That silent
      // fallback is what defeated the empty_assistant_output self-heal
      // in the 2026-04-17 live test.
      return {
        error: `Failed to create OpenClaw session under fresh key ${freshSessionKey}`,
      };
    }

    const sendResult = await callGateway<{ runId?: string; status?: string }>(
      OPENCLAW_BIN,
      "sessions.send",
      { key: freshSessionKey, message: prompt },
      execFileAsync,
    );

    return {
      sessionId: newSessionId,
      sessionKey: freshSessionKey,
      messageCountBefore: 0,
      runnerProvider: "openclaw",
      runnerModel: null,
      usage: {
        runnerProvider: "openclaw",
        runnerModel: null,
        openclawRunId: sendResult?.runId ?? null,
        openclawStatus: sendResult?.status ?? null,
        integrationPath: "openclaw-gateway-sessions",
        invocationMode: "gateway.sessions.create_then_send",
        promptDelivery: "json_params_message",
        jsonEventCapture: false,
        sessionReused: false,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `OpenClaw execution failed: ${message}` };
  }
}

function clearTaskSessionForSelfHeal(
  db: Database.Database,
  input: ExecutionSelfHealInput,
): void {
  try {
    db.prepare(
      `UPDATE agent_task_sessions
       SET session_params_json = '{}',
           session_display_id = NULL,
           last_error = ?,
           updated_at = ?
       WHERE company_id = ?
         AND agent_id = ?
         AND adapter_type = 'openclaw'
         AND task_key = ?`,
    ).run(
      `self_heal:${input.reason}`,
      new Date().toISOString(),
      input.companyId,
      input.agentId,
      input.taskKey,
    );
  } catch (err) {
    console.warn(
      `[engine:runtime] failed to clear openclaw task session for ${input.agentId}/${input.taskKey} (${input.reason}):`,
      err,
    );
  }
}

async function cancel(_runId: string, _pid: number | null, sessionId: string | null): Promise<CancelAdapterResult> {
  if (!sessionId) return { killed: false, method: "no-op:session-null" };
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);
  const methods = ["sessions.cancel", "sessions_cancel", "sessions.stop", "sessions_stop"] as const;
  for (const method of methods) {
    try {
      const result = await callGateway<Record<string, unknown>>(OPENCLAW_BIN, method, { sessionId }, execFileAsync);
      if (!result) continue;
      const acknowledged = Boolean(
        result.ok || result.cancelled || result.canceled || result.stopped || result.terminated ||
        ["cancelled", "canceled", "stopped", "terminated", "done", "completed", "success"].includes(String(result.status ?? ""))
      );
      if (acknowledged) return { killed: true, method: `gateway:${method}` };
    } catch { /* try next */ }
  }
  return { killed: false, method: "gateway:sessions.cancel", error: "cancellation not acknowledged by gateway" };
}

export const openclawExecutionAdapter: ExecutionAdapter = {
  adapterType: "openclaw",
  execute,
  clearTaskSessionForSelfHeal,
  cancel,
};
