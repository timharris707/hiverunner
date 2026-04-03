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
import fs from "fs";
import path from "path";

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
  /** Optional model override for this turn (e.g. "gpt-5.4", "anthropic/claude-sonnet-4-6") */
  model?: string;
}

export interface SpawnAdvisoryAgentResult {
  text: string;
  model: string;
  durationMs: number;
  openclawSessionId: string;
}

const MODEL_AGENT_PREFIX = "advisory-model-";
const MODEL_ROUTER_DIR = path.join(process.cwd(), ".agents", "model-router");

function normalizeModelId(modelId?: string): string | undefined {
  if (!modelId) return undefined;
  if (modelId.includes("/")) return modelId;
  if (modelId.startsWith("gpt-")) return `openai/${modelId}`;
  if (modelId.startsWith("claude-")) return `anthropic/${modelId}`;
  if (modelId.startsWith("gemini-")) return `google/${modelId}`;
  return modelId;
}

function slugifyModel(modelId: string): string {
  return modelId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function execFileAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function ensureModelAgent(modelId: string): Promise<string> {
  const normalizedModel = normalizeModelId(modelId) || modelId;
  const configuredRaw = await execFileAsync("openclaw", ["agents", "list", "--json"]);
  const configuredAgents = JSON.parse(configuredRaw) as Array<{ id: string; model?: string }>;

  const existingByModel = configuredAgents.find(
    (a) => a.id.startsWith(MODEL_AGENT_PREFIX) && a.model === normalizedModel
  );
  if (existingByModel) return existingByModel.id;

  const agentId = `${MODEL_AGENT_PREFIX}${slugifyModel(normalizedModel)}`;
  if (configuredAgents.some((a) => a.id === agentId)) return agentId;

  const workspaceDir = path.join(MODEL_ROUTER_DIR, agentId, "workspace");
  const agentDir = path.join(MODEL_ROUTER_DIR, agentId, "agent");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });

  try {
    await execFileAsync("openclaw", [
      "agents",
      "add",
      agentId,
      "--workspace",
      workspaceDir,
      "--agent-dir",
      agentDir,
      "--model",
      normalizedModel,
      "--non-interactive",
      "--json",
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes("already exists")) throw err;
  }

  return agentId;
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
export async function spawnAdvisoryAgent(
  options: SpawnAdvisoryAgentOptions
): Promise<SpawnAdvisoryAgentResult> {
  const {
    sessionId,
    agentId,
    systemPrompt,
    userPrompt,
    timeoutSeconds = 120,
    thinkingLevel,
    model,
  } = options;

  // H-7 fix: Use ephemeral sessions per turn to avoid context accumulation.
  // Previously used persistent sessions (`advisory-{sessionId}-{agentId}`) which
  // accumulated all prior messages, creating duplicate/conflicting context with
  // the history injected in the prompt. Now each turn gets a unique session.
  const turnId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const openclawSessionId = `advisory-${sessionId}-${agentId}-${turnId}`;

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

  if (model) {
    const routedAgentId = await ensureModelAgent(model);
    args.push("--agent", routedAgentId);
  }

  if (thinkingLevel && thinkingLevel !== "off") {
    args.push("--thinking", thinkingLevel);
  }

  return new Promise((resolve, reject) => {
    const child = execFile(
      "openclaw",
      args,
      { maxBuffer: 50 * 1024 * 1024, timeout: (timeoutSeconds + 10) * 1000 },
      (error, stdout, stderr) => {
        if (error) {
          // Try to extract useful info from stderr
          const errDetail = stderr?.trim() || error.message;
          reject(new Error(`OpenClaw agent spawn failed for ${agentId}: ${errDetail}`));
          return;
        }

        // Try to extract JSON from stdout first, then stderr (openclaw sometimes mixes output streams)
        let jsonSource = stdout?.trim() || "";
        if (!jsonSource || !jsonSource.startsWith("{")) {
          // Try to find JSON in stderr (after warnings)
          const stderrStr = stderr || "";
          const jsonStart = stderrStr.indexOf("\n{");
          if (jsonStart >= 0) {
            jsonSource = stderrStr.slice(jsonStart + 1).trim();
          }
        }

        try {
          const result = JSON.parse(jsonSource);
          const text = result?.payloads?.[0]?.text || "";
          const meta = result?.meta?.agentMeta || {};

          resolve({
            text,
            model: meta.model || "unknown",
            durationMs: result?.meta?.durationMs || 0,
            openclawSessionId: meta.sessionId || openclawSessionId,
          });
        } catch (parseErr) {
          // If JSON parsing fails, try to extract text field from partial JSON
          const textMatch = jsonSource.match(/"text":\s*"((?:[^"\\]|\\.)*)"/);
          if (textMatch) {
            resolve({
              text: JSON.parse(`"${textMatch[1]}"`),
              model: "unknown",
              durationMs: 0,
              openclawSessionId,
            });
          } else if (stdout?.trim()) {
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
