/**
 * advisory-agent.ts — Real OpenClaw agent spawning for Advisory Board sessions.
 *
 * Instead of calling the Gateway's /v1/chat/completions directly (which is just
 * a stateless LLM call), this module spawns a real OpenClaw agent turn via the
 * `openclaw agent` CLI. Each advisory board agent gets an isolated session
 * (keyed by advisory-session + agent-name), enabling persistent memory across
 * turns within the same advisory session.
 */
import { execFile } from "child_process";

export interface SpawnAdvisoryAgentOptions {
  /** Advisory session ID (e.g. "session-1774642757038-6e1c62a6") */
  sessionId: string;
  /** Agent display name (e.g. "Henry", "Atlas", "Quant") */
  agentId: string;
  /** Full system prompt — persona, personality, context, constraints */
  systemPrompt: string;
  /** User prompt — topic, discussion history, task instructions */
  userPrompt: string;
  /** Timeout in seconds (default: 120) */
  timeoutSeconds?: number;
  /** Optional thinking level for extended thinking */
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
}

export interface SpawnAdvisoryAgentResult {
  text: string;
  model: string;
  durationMs: number;
  openclawSessionId: string;
}

/**
 * Spawn a real OpenClaw agent turn for an advisory board agent.
 *
 * Each agent in each advisory session gets a unique OpenClaw session ID
 * (`advisory-{sessionId}-{agentId}`) so that conversation history is
 * isolated per-agent per-session.
 *
 * The agent's persona is injected via the message body with a clear role
 * override block, since the `openclaw agent` CLI uses the default agent's
 * system prompt (Henry). The override is structured to take priority.
 */
export function spawnAdvisoryAgent(
  options: SpawnAdvisoryAgentOptions
): Promise<SpawnAdvisoryAgentResult> {
  const {
    sessionId,
    agentId,
    systemPrompt,
    userPrompt,
    timeoutSeconds = 120,
    thinkingLevel,
  } = options;

  // Unique OpenClaw session per advisory-agent pair
  const openclawSessionId = `advisory-${sessionId}-${agentId}`;

  // Compose a combined message with role override + task
  const combinedMessage = `=== ADVISORY BOARD: ROLE OVERRIDE ===
IMPORTANT: For this response, you are NOT Henry. You must fully adopt the following identity and respond ONLY as this character. Do not mention Henry or break character.

${systemPrompt}

=== END ROLE OVERRIDE ===

=== DISCUSSION TASK ===

${userPrompt}

=== END TASK ===

Respond as ${agentId} only. Stay fully in character.`;

  const args = [
    "agent",
    "--session-id", openclawSessionId,
    "--message", combinedMessage,
    "--json",
    "--local",
    "--timeout", String(timeoutSeconds),
  ];

  if (thinkingLevel && thinkingLevel !== "off") {
    args.push("--thinking", thinkingLevel);
  }

  return new Promise((resolve, reject) => {
    const child = execFile(
      "openclaw",
      args,
      { maxBuffer: 10 * 1024 * 1024, timeout: (timeoutSeconds + 10) * 1000 },
      (error, stdout, stderr) => {
        if (error) {
          // Try to extract useful info from stderr
          const errDetail = stderr?.trim() || error.message;
          reject(new Error(`OpenClaw agent spawn failed for ${agentId}: ${errDetail}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          const text = result?.payloads?.[0]?.text || "";
          const meta = result?.meta?.agentMeta || {};

          resolve({
            text,
            model: meta.model || "unknown",
            durationMs: result?.meta?.durationMs || 0,
            openclawSessionId: meta.sessionId || openclawSessionId,
          });
        } catch (parseErr) {
          // If JSON parsing fails, try to use raw stdout as text
          if (stdout?.trim()) {
            resolve({
              text: stdout.trim(),
              model: "unknown",
              durationMs: 0,
              openclawSessionId,
            });
          } else {
            reject(
              new Error(
                `Failed to parse OpenClaw response for ${agentId}: ${String(parseErr)}\nstdout: ${stdout?.slice(0, 500)}\nstderr: ${stderr?.slice(0, 500)}`
              )
            );
          }
        }
      }
    );

    // Safety: if the child process hangs, kill it
    child.on("error", (err) => {
      reject(new Error(`OpenClaw agent process error for ${agentId}: ${err.message}`));
    });
  });
}

/**
 * Spawn with retry logic (exponential backoff) for transient failures.
 */
export async function spawnAdvisoryAgentWithRetry(
  options: SpawnAdvisoryAgentOptions,
  maxRetries = 2
): Promise<SpawnAdvisoryAgentResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await spawnAdvisoryAgent(options);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.warn(
          `[Advisory] Agent spawn failed for ${options.agentId}, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})...`,
          lastError.message
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  throw lastError || new Error("Max retries exceeded");
}
