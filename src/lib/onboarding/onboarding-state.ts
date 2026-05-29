/**
 * onboarding-state.ts — durable, server-side record of first-run software setup.
 *
 * This tracks whether the one-time HiveRunner *software* onboarding wizard
 * (`/setup`) has been completed. It is intentionally independent of company /
 * workspace creation: completing software setup must never require a company
 * to exist or be auto-created.
 *
 * Persistence is a small JSON file under MC_DATA_DIR (the same lane-scoped data
 * directory used by the other local JSON stores), not browser storage, so the
 * decision survives across browsers, private windows, and devices on the same
 * local install.
 *
 * The pure helpers here take their inputs explicitly so the root-route logic
 * and tests can reason about completion without touching the filesystem.
 */
import fs from "fs";
import path from "path";

import { MC_DATA_DIR } from "@/lib/data-dir";

export const ONBOARDING_STATE_VERSION = 1;
export const ONBOARDING_STATE_FILENAME = "onboarding-state.json";

export type OnboardingCompletionReason =
  | "created-workspace"
  | "opened-existing"
  | "skipped"
  | "completed";

const COMPLETION_REASONS: ReadonlySet<OnboardingCompletionReason> = new Set([
  "created-workspace",
  "opened-existing",
  "skipped",
  "completed",
]);

export type OnboardingState = {
  version: number;
  /** ISO timestamp of the first time software setup was marked complete, or null. */
  softwareSetupCompletedAt: string | null;
  /** How the operator left the wizard the first time setup was completed. */
  completedVia: OnboardingCompletionReason | null;
};

export function defaultOnboardingState(): OnboardingState {
  return {
    version: ONBOARDING_STATE_VERSION,
    softwareSetupCompletedAt: null,
    completedVia: null,
  };
}

export function onboardingStateFilePath(dataDir: string = MC_DATA_DIR): string {
  return path.join(dataDir, ONBOARDING_STATE_FILENAME);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Coerce arbitrary parsed JSON into a safe OnboardingState (never throws). */
export function normalizeOnboardingState(raw: unknown): OnboardingState {
  if (!raw || typeof raw !== "object") {
    return defaultOnboardingState();
  }

  const record = raw as Record<string, unknown>;
  const completedAt = isNonEmptyString(record.softwareSetupCompletedAt)
    ? record.softwareSetupCompletedAt
    : null;
  const reasonCandidate = record.completedVia;
  const completedVia =
    typeof reasonCandidate === "string" && COMPLETION_REASONS.has(reasonCandidate as OnboardingCompletionReason)
      ? (reasonCandidate as OnboardingCompletionReason)
      : null;

  return {
    version: typeof record.version === "number" ? record.version : ONBOARDING_STATE_VERSION,
    // A reason without a timestamp still counts as "not complete" — completion
    // is defined solely by the presence of the timestamp.
    softwareSetupCompletedAt: completedAt,
    completedVia: completedAt ? completedVia : null,
  };
}

/** True when the one-time software setup wizard has been completed. */
export function isSoftwareSetupComplete(state: OnboardingState): boolean {
  return isNonEmptyString(state.softwareSetupCompletedAt);
}

/** Read the durable state from disk. Missing/corrupt files resolve to defaults. */
export function readOnboardingState(filePath: string = onboardingStateFilePath()): OnboardingState {
  let contents: string;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch {
    // Missing/unreadable file is the normal fresh-install case — stay quiet.
    return defaultOnboardingState();
  }

  try {
    return normalizeOnboardingState(JSON.parse(contents));
  } catch (error) {
    // The file exists but is not valid JSON. Surface it instead of silently
    // resetting completion (which would bounce the operator back through /setup).
    console.warn(`[onboarding-state] ignoring corrupt state file ${filePath}; treating software setup as incomplete`, error);
    return defaultOnboardingState();
  }
}

/**
 * Mark software setup complete and persist it. Write-once: the first completion
 * timestamp AND reason are preserved on subsequent calls, so re-running the
 * wizard does not rewrite history. Making the reason write-once (rather than
 * last-writer-wins) also removes the read-modify-write hazard when two clients
 * POST completion concurrently — whichever lands first defines the record.
 */
export function markSoftwareSetupComplete(
  input: { via?: OnboardingCompletionReason; now?: string } = {},
  filePath: string = onboardingStateFilePath(),
): OnboardingState {
  const existing = readOnboardingState(filePath);
  const completedAt = existing.softwareSetupCompletedAt ?? input.now ?? new Date().toISOString();
  const next: OnboardingState = {
    version: ONBOARDING_STATE_VERSION,
    softwareSetupCompletedAt: completedAt,
    completedVia: existing.completedVia ?? input.via ?? "completed",
  };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
