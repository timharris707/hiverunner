import { STATUS_LABEL } from "@/components/tasks/types";
import type { TaskStatus } from "@/lib/orchestration/types";
import type { ResolvedVoiceBinding } from "@/lib/voice-binding";

export interface VoicePresenterCopy {
  heading: string;
  subtitle: string;
  speakingLabel: string;
  startSessionLabel: string;
  boundSessionHint: string | null;
}

function normalizeName(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function getBoundAgentName(binding: ResolvedVoiceBinding | null | undefined): string | null {
  return normalizeName(binding?.agentName);
}

function normalizeTaskStatus(value: string | null | undefined): TaskStatus | null {
  const normalized = normalizeName(value)?.toLowerCase().replace(/_/g, "-");
  if (!normalized) {
    return null;
  }

  switch (normalized) {
    case "backlog":
    case "to-do":
    case "in-progress":
    case "review":
    case "done":
    case "blocked":
    case "cancelled":
      return normalized satisfies TaskStatus;
    default:
      return null;
  }
}

export function formatVoiceBindingStatusLabel(value: string | null | undefined): string | null {
  const normalized = normalizeTaskStatus(value);
  return normalized ? STATUS_LABEL[normalized] : normalizeName(value);
}

export function buildTaskVoiceLaunchLabel(agentName: string | null | undefined): string {
  const normalized = normalizeName(agentName);
  return normalized ? `Talk to ${normalized}` : "Talk to Agent";
}

export function getVoicePresenterCopy(binding: ResolvedVoiceBinding | null | undefined): VoicePresenterCopy {
  const agentName = getBoundAgentName(binding);

  if (!binding || binding.scope === "global") {
    return {
      heading: "Voice Chat",
      subtitle: "Optional experimental realtime voice conversation with the HiveRunner assistant",
      speakingLabel: "Assistant is speaking",
      startSessionLabel: "Start Voice Session",
      boundSessionHint: null,
    };
  }

  if (binding.scope === "task") {
    return {
      heading: agentName ? `${agentName} via Voice Chat` : "Voice Chat",
      subtitle: agentName
        ? `Optional experimental realtime voice session with ${agentName} for this task.`
        : "Optional experimental task-bound voice session in HiveRunner.",
      speakingLabel: agentName ? `${agentName} is speaking` : "Speaking",
      startSessionLabel: "Start Task Session",
      boundSessionHint:
        "This task-bound session keeps the full transcript in HiveRunner-owned workspace memory and writes a visible voice note back to the task when the session ends.",
    };
  }

  return {
    heading: agentName ? `${agentName} via Voice Chat` : "Voice Chat",
    subtitle: agentName
      ? `Optional experimental realtime voice session with ${agentName} for this project.`
      : "Optional experimental project-bound voice session in HiveRunner.",
    speakingLabel: agentName ? `${agentName} is speaking` : "Speaking",
    startSessionLabel: "Start Project Session",
    boundSessionHint:
      "This project-bound session keeps the full transcript in HiveRunner-owned workspace memory. Project write-back stays curated until HiveRunner has a real project-note model.",
  };
}
