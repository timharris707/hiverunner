/**
 * HiveRunner — Lead/CEO recommended-model default.
 *
 * Product decision (2026-06-12): whichever agent a user makes team lead/CEO,
 * the recommended default is Claude Fable 5 at extra-high thinking — when the
 * machine's subscription CLI can actually serve it. Servability is probed with
 * a real one-token generation (`claude -p --model claude-fable-5`), the same
 * spawn path the runner uses, so clone-and-run users on a plan or CLI version
 * without Fable degrade to the best servable tier with a visible note instead
 * of a hard failure on their first agent run.
 *
 * The probe never uses the metered Anthropic API: the child env is built with
 * buildExternalRunnerEnv, which strips ANTHROPIC_API_KEY/CLAUDE_API_KEY, so a
 * stray key in the parent process cannot leak into the check.
 */

import { spawn } from "child_process";

import { buildExternalRunnerEnv } from "@/lib/orchestration/execution/adapters/child-env";

export const LEAD_RECOMMENDED_MODEL = "anthropic/claude-fable-5";
export const LEAD_RECOMMENDED_REASONING_EFFORT = "xhigh";
const LEAD_ANTHROPIC_FALLBACK_MODEL = "anthropic/claude-sonnet-4-6";
const LEAD_PROVIDER_FALLBACK_MODEL = "openai-codex/gpt-5.5";

const SUCCESS_TTL_MS = 10 * 60 * 1000;
const FAILURE_TTL_MS = 2 * 60 * 1000;
const PROBE_TIMEOUT_MS = 20_000;

export type LeadModelProbeOutcome = "ok" | "model_unavailable" | "cli_missing";

export type LeadModelDefault = {
  model: string;
  reasoningEffort: string | null;
  source: "verified" | "fallback_anthropic" | "fallback_provider";
  note: string;
  probedAt: string;
};

let cached: { value: LeadModelDefault; expiresAt: number } | null = null;
let inflight: Promise<LeadModelDefault> | null = null;

export function leadDefaultFromProbeOutcome(
  outcome: LeadModelProbeOutcome,
  probedAt = new Date().toISOString(),
): LeadModelDefault {
  if (outcome === "ok") {
    return {
      model: LEAD_RECOMMENDED_MODEL,
      reasoningEffort: LEAD_RECOMMENDED_REASONING_EFFORT,
      source: "verified",
      note: "Verified servable on this machine's subscription CLI.",
      probedAt,
    };
  }
  if (outcome === "model_unavailable") {
    return {
      model: LEAD_ANTHROPIC_FALLBACK_MODEL,
      reasoningEffort: LEAD_RECOMMENDED_REASONING_EFFORT,
      source: "fallback_anthropic",
      note: "The recommended frontier model isn't servable on this machine's Claude Code subscription or CLI version. Defaulting the lead to the balanced tier instead.",
      probedAt,
    };
  }
  return {
    model: LEAD_PROVIDER_FALLBACK_MODEL,
    reasoningEffort: null,
    source: "fallback_provider",
    note: "Claude Code CLI isn't available on this machine. Keeping the standard default for the lead role.",
    probedAt,
  };
}

function probeFableServability(): Promise<LeadModelProbeOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: LeadModelProbeOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        "claude",
        ["-p", "Reply with exactly: ok", "--model", "claude-fable-5", "--output-format", "text"],
        {
          env: buildExternalRunnerEnv(process.env),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch {
      resolve("cli_missing");
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // Process may already be gone.
      }
      // CLI present but could not complete a Fable generation in time —
      // recommend the safe anthropic tier rather than blocking onboarding.
      finish("model_unavailable");
    }, PROBE_TIMEOUT_MS);

    child.stdout?.on("data", () => {});
    child.stderr?.on("data", () => {});
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(error.code === "ENOENT" ? "cli_missing" : "model_unavailable");
    });
    child.on("close", (code) => {
      finish(code === 0 ? "ok" : "model_unavailable");
    });
  });
}

export async function resolveLeadModelDefault(): Promise<LeadModelDefault> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (inflight) return inflight;

  inflight = (async () => {
    const outcome = await probeFableServability();
    const value = leadDefaultFromProbeOutcome(outcome);
    cached = {
      value,
      expiresAt: Date.now() + (outcome === "ok" ? SUCCESS_TTL_MS : FAILURE_TTL_MS),
    };
    return value;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function __resetLeadModelDefaultCacheForTests(): void {
  cached = null;
  inflight = null;
}
