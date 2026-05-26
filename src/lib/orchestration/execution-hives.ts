import type { TaskExecutionEngine, TaskModelLane } from "@/lib/orchestration/types";
import type { SecretSource } from "@/lib/secrets";

export type HiveRoutingLaneId = TaskModelLane | "vision" | "local";

export type ExecutionHivePreset = "balanced" | "max_quality" | "cost_saver" | "local_private" | "custom";
export type HiveOptimizeFor = "balanced" | "quality" | "cost" | "speed" | "privacy";
export type HiveAutonomy = "manual-review" | "supervised" | "autonomous";
export type RouteTargetMode = "runtime_managed" | "hive_managed" | "direct_source" | "broker" | "local";
export type ModelSourceKind = "first-party" | "broker" | "local" | "self-hosted";
export type VerificationStatus = "verified" | "warning" | "failed" | "untested";
export type ExecutionHiveRuntimeProvider = "codex" | "anthropic" | "gemini" | "hermes" | "openclaw";
export type ExecutionHiveModelRouting = "runtime-managed" | "hive-managed" | "openrouter" | "anthropic" | "openai" | "google";

export interface ExecutionHiveMatrixConfig {
  orchestrationMode: TaskExecutionEngine;
  runtimeProvider: ExecutionHiveRuntimeProvider;
  runtimeLabel: string;
  modelRouting: ExecutionHiveModelRouting;
  modelRoutingLabel: string;
}

export interface RouteTarget {
  runtimeId?: string;
  runtimeLabel?: string;
  modelSourceId?: string;
  modelSourceLabel?: string;
  modelId?: string;
  modelLabel?: string;
  mode: RouteTargetMode;
}

export interface ApprovalPolicy {
  mode: "none" | "cost_threshold" | "always";
  thresholdUsd?: number;
  label: string;
}

export interface RoutingLane {
  id: HiveRoutingLaneId;
  label: string;
  description: string;
  useFor: string[];
  primary: RouteTarget;
  fallbacks: RouteTarget[];
  approvalPolicy: ApprovalPolicy;
  verificationStatus: VerificationStatus;
  verificationNote: string;
}

export interface ExecutionHive {
  id: string;
  name: string;
  description: string;
  preset: ExecutionHivePreset;
  recommended?: boolean;
  isActive?: boolean;
  orchestrationMode: TaskExecutionEngine;
  optimizeFor: HiveOptimizeFor;
  autonomy: HiveAutonomy;
  runtimePriority: string[];
  routingPolicy: string;
  lanes: RoutingLane[];
  verification: ExecutionHiveVerification;
  usage?: {
    cost7dLabel?: string;
    tasks7d?: number;
    runs7d?: number;
  };
}

export interface RuntimeInventoryItem {
  id: string;
  label: string;
  kind: "runtime" | "control-plane" | "manual";
  status: "ready" | "needs_login" | "missing_cli" | "warning" | "disabled";
  capabilities: string[];
  note: string;
}

export interface ModelSourceInventoryItem {
  id: string;
  label: string;
  kind: ModelSourceKind;
  status: "connected" | "available" | "needs_key" | "not_configured" | "warning";
  capabilities: string[];
  note: string;
  authSurface?: SecretSource | "local" | "runtime" | "none";
  credentialStorage?: {
    adapterId: string;
    label: string;
    productionReady: boolean;
    note: string;
  };
  credentialSecretNames?: string[];
  configuredSecretNames?: string[];
  setupHint?: string;
  lastCheckedAt?: string;
}

export interface ModelSourceProbeResult {
  sourceId: string;
  status: "pass" | "warn" | "fail";
  label: string;
  checkedAt: string;
  authSurface?: ModelSourceInventoryItem["authSurface"];
  configuredSecretNames?: string[];
  endpointLabel?: string;
  latencyMs?: number;
  note: string;
}

export interface ExecutionHiveVerification {
  pass: number;
  warn: number;
  fail: number;
  total: number;
  lastVerifiedLabel?: string;
  modelSourceProbes?: Record<string, ModelSourceProbeResult>;
  modelSourceSummary?: {
    pass: number;
    warn: number;
    fail: number;
    total: number;
    lastCheckedLabel?: string;
  };
}

export interface VerificationProbeResult {
  id: string;
  label: string;
  laneId: HiveRoutingLaneId | "all";
  status: "pass" | "warn" | "fail" | "idle";
  latencyLabel?: string;
  costLabel?: string;
  verifies: string[];
  note?: string;
}

export type ExecutionHiveProbeKind = "lane" | "conformance";

export interface ExecutionHiveProbeRuntimeSummary {
  selectedRuntimeLabel: string | null;
  selectedRuntimeStatus: string | null;
  checkedRuntimes: number;
  readyRuntimes: number;
  warningRuntimes: number;
  missingRuntimes: number;
  details: string[];
}

export interface ExecutionHiveProbeRunPayload {
  probe: VerificationProbeResult;
  hive: ExecutionHive;
  hives: ExecutionHive[];
  activeHive: ExecutionHive | null;
  executionDefaults: Record<string, unknown>;
  lane: RoutingLane;
  checkedAt: string;
  runtimeSummary: ExecutionHiveProbeRuntimeSummary;
}

const noApproval: ApprovalPolicy = { mode: "none", label: "No approval required" };
const reviewExpensive: ApprovalPolicy = { mode: "cost_threshold", thresholdUsd: 1, label: "Approval above estimated $1" };
const alwaysReview: ApprovalPolicy = { mode: "always", label: "Approval required" };

function target(input: RouteTarget): RouteTarget {
  return input;
}

function lane(input: RoutingLane): RoutingLane {
  return input;
}

const balancedLanes: RoutingLane[] = [
  lane({
    id: "mini",
    label: "Mini lane",
    description: "Cheap bounded work, summaries, cleanup, and low-risk bookkeeping.",
    useFor: ["summaries", "small edits", "classification", "triage"],
    primary: target({ mode: "hive_managed", runtimeId: "codex", runtimeLabel: "Codex", modelSourceId: "openai", modelSourceLabel: "OpenAI", modelLabel: "mini/fast model" }),
    fallbacks: [target({ mode: "broker", runtimeId: "codex", runtimeLabel: "Codex", modelSourceId: "openrouter", modelSourceLabel: "OpenRouter", modelLabel: "cheap capable fallback" })],
    approvalPolicy: noApproval,
    verificationStatus: "verified",
    verificationNote: "Quick probe passed with structured output.",
  }),
  lane({
    id: "fast",
    label: "Fast lane",
    description: "Speed-first coding and operational tasks where latency matters more than exhaustive reasoning.",
    useFor: ["quick fixes", "lint cleanup", "routine ops", "short scripts"],
    primary: target({ mode: "runtime_managed", runtimeId: "codex", runtimeLabel: "Codex", modelLabel: "runtime managed" }),
    fallbacks: [target({ mode: "runtime_managed", runtimeId: "gemini-cli", runtimeLabel: "Gemini CLI", modelLabel: "runtime managed" })],
    approvalPolicy: noApproval,
    verificationStatus: "verified",
    verificationNote: "Runtime responded and returned artifact metadata.",
  }),
  lane({
    id: "default",
    label: "Default lane",
    description: "Balanced implementation path for normal HiveRunner work.",
    useFor: ["feature work", "bug fixes", "repo inspection", "moderate refactors"],
    primary: target({ mode: "runtime_managed", runtimeId: "claude-code", runtimeLabel: "Claude Code", modelLabel: "runtime managed" }),
    fallbacks: [
      target({ mode: "runtime_managed", runtimeId: "codex", runtimeLabel: "Codex", modelLabel: "runtime managed" }),
      target({ mode: "runtime_managed", runtimeId: "hermes", runtimeLabel: "Hermes", modelLabel: "profile managed" }),
    ],
    approvalPolicy: noApproval,
    verificationStatus: "verified",
    verificationNote: "File-read, file-write, and status-report probes passed.",
  }),
  lane({
    id: "deep",
    label: "Deep lane",
    description: "Hard reasoning, architecture, review, and multi-file changes.",
    useFor: ["architecture", "complex bugs", "code review", "multi-file refactors"],
    primary: target({ mode: "runtime_managed", runtimeId: "claude-code", runtimeLabel: "Claude Code", modelLabel: "deep reasoning profile" }),
    fallbacks: [target({ mode: "runtime_managed", runtimeId: "codex", runtimeLabel: "Codex", modelLabel: "deep profile" })],
    approvalPolicy: reviewExpensive,
    verificationStatus: "warning",
    verificationNote: "Deep route is valid; cost guard still needs live budget thresholds.",
  }),
  lane({
    id: "vision",
    label: "Vision lane",
    description: "Screenshots, visual QA, mockup review, and multimodal input.",
    useFor: ["screenshots", "visual QA", "mockup review"],
    primary: target({ mode: "direct_source", runtimeId: "gemini-cli", runtimeLabel: "Gemini CLI", modelSourceId: "google", modelSourceLabel: "Google AI", modelLabel: "Gemini vision-capable model" }),
    fallbacks: [target({ mode: "direct_source", runtimeId: "codex", runtimeLabel: "Codex", modelSourceId: "openai", modelSourceLabel: "OpenAI", modelLabel: "vision-capable model" })],
    approvalPolicy: noApproval,
    verificationStatus: "verified",
    verificationNote: "Vision capability declared; live multimodal probe pending in next pass.",
  }),
  lane({
    id: "local",
    label: "Local/private lane",
    description: "Sensitive work and local-only trials. External fallbacks require approval.",
    useFor: ["private context", "offline experiments", "local model trials"],
    primary: target({ mode: "local", runtimeId: "openclaw", runtimeLabel: "OpenClaw", modelSourceId: "ollama", modelSourceLabel: "Ollama / LM Studio", modelLabel: "local capable model" }),
    fallbacks: [target({ mode: "runtime_managed", runtimeId: "openclaw", runtimeLabel: "OpenClaw", modelLabel: "platform managed" })],
    approvalPolicy: alwaysReview,
    verificationStatus: "untested",
    verificationNote: "Local model inventory is not connected to the hive checker yet.",
  }),
];

function cloneLanes(lanes: RoutingLane[], overrides: Partial<RoutingLane> = {}): RoutingLane[] {
  return lanes.map((entry) => ({ ...entry, ...overrides }));
}

export const SEEDED_EXECUTION_HIVES: ExecutionHive[] = [
  {
    id: "balanced-builder",
    name: "Balanced Builder",
    description: "Recommended default for shipping code, reviewing work, and keeping automation moving without runaway cost.",
    preset: "balanced",
    recommended: true,
    isActive: true,
    orchestrationMode: "hiverunner",
    optimizeFor: "balanced",
    autonomy: "supervised",
    runtimePriority: ["Claude Code", "Codex", "Hermes", "OpenClaw", "Gemini CLI"],
    routingPolicy: "Use runtime-managed models for agent CLIs; Hive manages lane selection and fallbacks.",
    lanes: balancedLanes,
    verification: { pass: 5, warn: 1, fail: 0, total: 6, lastVerifiedLabel: "baseline check · ready for live probes" },
    usage: { cost7dLabel: "$18 est.", tasks7d: 42, runs7d: 67 },
  },
  {
    id: "max-quality",
    name: "Max Quality",
    description: "Bias toward strongest reasoning and manual approval gates for high-stakes architecture and review work.",
    preset: "max_quality",
    orchestrationMode: "hiverunner",
    optimizeFor: "quality",
    autonomy: "manual-review",
    runtimePriority: ["Claude Code", "Codex", "Gemini CLI", "Hermes"],
    routingPolicy: "Escalate quickly to deep routes; require approval on expensive or broad changes.",
    lanes: cloneLanes(balancedLanes).map((entry) => entry.id === "deep" ? { ...entry, verificationStatus: "verified", approvalPolicy: alwaysReview, verificationNote: "Deep route requires explicit operator approval before execution." } : entry),
    verification: { pass: 6, warn: 0, fail: 0, total: 6, lastVerifiedLabel: "baseline check · conservative" },
    usage: { cost7dLabel: "$44 est.", tasks7d: 18, runs7d: 29 },
  },
  {
    id: "cost-saver",
    name: "Cost Saver",
    description: "Background automation profile that tries mini/fast lanes first and only escalates when the task demands it.",
    preset: "cost_saver",
    orchestrationMode: "hiverunner",
    optimizeFor: "cost",
    autonomy: "autonomous",
    runtimePriority: ["Codex", "Gemini CLI", "Hermes", "Claude Code"],
    routingPolicy: "Prefer cheap lanes; escalate to default/deep only on explicit task risk or failed probes.",
    lanes: cloneLanes(balancedLanes).map((entry) => entry.id === "deep" ? { ...entry, approvalPolicy: alwaysReview, verificationStatus: "warning", verificationNote: "Deep lane is gated because this hive is cost-first." } : entry),
    verification: { pass: 4, warn: 2, fail: 0, total: 6, lastVerifiedLabel: "baseline check · cost gates pending" },
    usage: { cost7dLabel: "$6 est.", tasks7d: 58, runs7d: 91 },
  },
  {
    id: "local-private",
    name: "Local / Private",
    description: "Privacy-first hive that keeps sensitive work on local/self-hosted sources unless explicitly approved.",
    preset: "local_private",
    orchestrationMode: "manual",
    optimizeFor: "privacy",
    autonomy: "manual-review",
    runtimePriority: ["OpenClaw", "Hermes", "Local model host", "Manual / Operator Controlled"],
    routingPolicy: "Local/self-hosted first. Broker and first-party cloud fallbacks require approval.",
    lanes: cloneLanes(balancedLanes).map((entry) => ({
      ...entry,
      primary: entry.id === "local" ? entry.primary : target({ mode: "local", runtimeId: "openclaw", runtimeLabel: "OpenClaw", modelSourceId: "ollama", modelSourceLabel: "Ollama / LM Studio", modelLabel: "local capable model" }),
      approvalPolicy: entry.id === "mini" ? noApproval : alwaysReview,
      verificationStatus: entry.id === "local" ? "warning" : "untested",
      verificationNote: entry.id === "local" ? "Needs local model inventory check before activation." : "Route intentionally gated until local inventory is verified.",
    })),
    verification: { pass: 2, warn: 1, fail: 0, total: 6, lastVerifiedLabel: "baseline check · local inventory needed" },
    usage: { cost7dLabel: "$0 external", tasks7d: 7, runs7d: 9 },
  },
];

export const SEEDED_RUNTIME_INVENTORY: RuntimeInventoryItem[] = [
  { id: "claude-code", label: "Claude Code", kind: "runtime", status: "missing_cli", capabilities: ["repo read", "file write", "shell", "review"], note: "Optional runtime; appears ready after Claude Code is installed and authenticated." },
  { id: "codex", label: "Codex", kind: "runtime", status: "missing_cli", capabilities: ["repo edit", "tests", "structured output"], note: "Optional runtime; appears ready after Codex CLI is installed and authenticated." },
  { id: "gemini-cli", label: "Gemini CLI", kind: "runtime", status: "missing_cli", capabilities: ["large context", "multimodal", "research"], note: "Optional runtime; Gemini/Google keys can also enable direct model-source features." },
  { id: "hermes", label: "Hermes", kind: "runtime", status: "missing_cli", capabilities: ["orchestration", "tools", "long-running tasks"], note: "Optional local runner; appears ready after HERMES CLI is detected." },
  { id: "openclaw", label: "OpenClaw", kind: "runtime", status: "warning", capabilities: ["local agent", "workspace ops", "platform managed"], note: "Optional legacy/local runtime; gated and not required for the public local-first path." },
  { id: "manual", label: "Manual / Operator Controlled", kind: "manual", status: "disabled", capabilities: ["approval", "handoff"], note: "No autonomous runtime; operator does the work." },
];

export const SEEDED_MODEL_SOURCES: ModelSourceInventoryItem[] = [
  { id: "openai", label: "OpenAI", kind: "first-party", status: "needs_key", capabilities: ["text", "vision", "structured output", "tools"], note: "Direct OpenAI access needs an API key or a runtime that manages auth.", credentialSecretNames: ["OPENAI_API_KEY"], setupHint: "Add OPENAI_API_KEY for direct OpenAI model-source routing." },
  { id: "anthropic", label: "Anthropic", kind: "first-party", status: "needs_key", capabilities: ["deep reasoning", "coding", "review"], note: "Direct Anthropic access needs an API key. Claude Code runtime auth is separate.", credentialSecretNames: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"], setupHint: "Add ANTHROPIC_API_KEY for direct Anthropic model-source routing." },
  { id: "google", label: "Google AI", kind: "first-party", status: "needs_key", capabilities: ["large context", "vision", "multimodal"], note: "Direct Google model access needs a Gemini/Google AI key.", credentialSecretNames: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"], setupHint: "Add GEMINI_API_KEY or GOOGLE_API_KEY for direct Google model-source routing." },
  { id: "openrouter", label: "OpenRouter", kind: "broker", status: "needs_key", capabilities: ["broker routing", "model catalog", "fallbacks"], note: "Broker/access layer. It should only show connected when an OpenRouter key is configured.", credentialSecretNames: ["OPENROUTER_API_KEY"], setupHint: "Add OPENROUTER_API_KEY for OpenRouter broker routes." },
  { id: "ollama", label: "Ollama / LM Studio", kind: "local", status: "not_configured", capabilities: ["local", "private", "offline"], note: "Local model source; configure a local host before routing private lanes.", credentialSecretNames: ["OLLAMA_HOST"], setupHint: "Set OLLAMA_HOST when using a non-default local Ollama endpoint." },
  { id: "vllm", label: "vLLM", kind: "self-hosted", status: "not_configured", capabilities: ["self-hosted", "OpenAI-compatible", "GPU serving"], note: "Self-hosted OpenAI-compatible source.", credentialSecretNames: ["VLLM_BASE_URL", "VLLM_API_KEY"], setupHint: "Set VLLM_BASE_URL and VLLM_API_KEY if the endpoint requires auth." },
];

export const SEEDED_PROBES: VerificationProbeResult[] = [
  { id: "probe-mini", label: "Mini lane structured output", laneId: "mini", status: "pass", latencyLabel: "1.2s", costLabel: "low", verifies: ["model route", "JSON output", "fallback metadata"], note: "Baseline pass until a live lane probe replaces it." },
  { id: "probe-fast", label: "Fast lane repo touch", laneId: "fast", status: "pass", latencyLabel: "2.8s", costLabel: "subscription", verifies: ["runtime launch", "workspace access", "artifact return"] },
  { id: "probe-default", label: "Default lane code edit", laneId: "default", status: "pass", latencyLabel: "4.9s", costLabel: "subscription", verifies: ["file read", "file write", "test summary"] },
  { id: "probe-deep", label: "Deep lane cost guard", laneId: "deep", status: "warn", latencyLabel: "n/a", costLabel: "guarded", verifies: ["approval gate", "fallback chain"], note: "Live budget thresholds are not wired yet." },
  { id: "probe-vision", label: "Vision lane multimodal check", laneId: "vision", status: "pass", latencyLabel: "3.6s", costLabel: "medium", verifies: ["image input", "model-source route"] },
  { id: "probe-local", label: "Local/private inventory", laneId: "local", status: "idle", verifies: ["local source discovery", "offline fallback"], note: "Requires local model source detection." },
];

export function formatOrchestrationModeLabel(value: TaskExecutionEngine): string {
  switch (value) {
    case "hiverunner":
      return "HiveRunner Native";
    case "symphony":
      return "Symphony";
    case "manual":
      return "Manual / Operator Controlled";
    default:
      return value;
  }
}

export function formatRouteTarget(targetValue: RouteTarget): string {
  if (targetValue.mode === "runtime_managed") {
    return `${targetValue.runtimeLabel ?? targetValue.runtimeId ?? "Runtime"} · runtime managed`;
  }
  if (targetValue.mode === "broker") {
    return `${targetValue.modelSourceLabel ?? targetValue.modelSourceId ?? "Broker"} · broker route`;
  }
  if (targetValue.mode === "local") {
    return `${targetValue.modelSourceLabel ?? targetValue.modelSourceId ?? "Local"} · local/private`;
  }
  if (targetValue.mode === "direct_source") {
    return `${targetValue.modelSourceLabel ?? targetValue.modelSourceId ?? "Model source"} · direct`;
  }
  return `${targetValue.runtimeLabel ?? targetValue.modelSourceLabel ?? "Hive"} · Hive managed`;
}

function routeTargetProviderName(targetValue: RouteTarget): string {
  const runtime = targetValue.runtimeLabel ?? targetValue.runtimeId;
  if (runtime) {
    const normalized = runtime.toLowerCase();
    if (normalized.includes("claude") || normalized.includes("anthropic")) return "Claude Code";
    if (normalized.includes("gemini") || normalized.includes("google")) return "Gemini CLI";
    if (normalized.includes("hermes")) return "Hermes";
    if (normalized.includes("openclaw")) return "OpenClaw";
    if (normalized.includes("codex")) return "Codex";
    return runtime;
  }
  return targetValue.modelSourceLabel ?? targetValue.modelSourceId ?? "Runtime";
}

function routeTargetModelName(targetValue: RouteTarget): string {
  return targetValue.modelId ?? targetValue.modelLabel ?? targetValue.modelSourceLabel ?? "runtime managed";
}

export function formatRouteTargetFingerprint(targetValue: RouteTarget): string {
  return `${routeTargetProviderName(targetValue)} (${routeTargetModelName(targetValue)})`;
}

export function formatLaneFingerprint(lane: RoutingLane): { primary: string; fallbacks: string[]; full: string } {
  const primary = formatRouteTargetFingerprint(lane.primary);
  const fallbacks = lane.fallbacks.map(formatRouteTargetFingerprint);
  return {
    primary,
    fallbacks,
    full: `${lane.label} · ${[primary, ...fallbacks].join(" → ")}`,
  };
}
