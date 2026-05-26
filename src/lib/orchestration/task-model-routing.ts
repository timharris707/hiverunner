export type TaskModelLane = "default" | "fast" | "mini" | "deep";

export type TaskModelRouting = {
  lane: TaskModelLane;
  model?: string;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  speedPreference?: string;
  label: string;
};

export const TASK_MODEL_LANES: Array<{ value: TaskModelLane; label: string; description: string }> = [
  {
    value: "default",
    label: "Default",
    description: "Use the agent default model and High reasoning.",
  },
  {
    value: "fast",
    label: "Fast lane",
    description: "Use Codex Spark with High reasoning for low-risk quick work.",
  },
  {
    value: "mini",
    label: "Mini lane",
    description: "Use GPT-5.4 mini with High reasoning for bounded work.",
  },
  {
    value: "deep",
    label: "Deep lane",
    description: "Use GPT-5.5 with extra-high reasoning for high-risk work.",
  },
];

export function normalizeTaskModelLane(value: unknown): TaskModelLane {
  if (typeof value !== "string") return "default";
  const normalized = value.trim().toLowerCase();
  if (normalized === "fast" || normalized === "mini" || normalized === "deep") return normalized;
  return "default";
}

export function resolveTaskModelRouting(value: unknown): TaskModelRouting {
  const lane = normalizeTaskModelLane(value);
  switch (lane) {
    case "fast":
      return {
        lane,
        label: "Fast lane",
        model: "openai-codex/gpt-5.3-codex-spark",
        reasoningEffort: "high",
        speedPreference: "fast_1_5x",
      };
    case "mini":
      return {
        lane,
        label: "Mini lane",
        model: "openai-codex/gpt-5.4-mini",
        reasoningEffort: "high",
        speedPreference: "fast_1_5x",
      };
    case "deep":
      return {
        lane,
        label: "Deep lane",
        model: "openai-codex/gpt-5.5",
        reasoningEffort: "xhigh",
        speedPreference: "normal",
      };
    case "default":
    default:
      return {
        lane: "default",
        label: "Default",
        reasoningEffort: "high",
        speedPreference: "fast_1_5x",
      };
  }
}

export function taskModelLaneLabel(value: unknown): string {
  const lane = normalizeTaskModelLane(value);
  return TASK_MODEL_LANES.find((option) => option.value === lane)?.label ?? "Default";
}
