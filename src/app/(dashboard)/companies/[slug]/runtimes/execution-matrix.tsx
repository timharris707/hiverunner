"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Box,
  Check,
  Code2,
  Folder,
  Hand,
  KeyRound,
  Lock,
  Network,
  Route,
  Sparkles,
  Workflow,
  Zap,
} from "lucide-react";

import {
  formatOrchestrationModeLabel,
  type ExecutionHive,
  type ExecutionHiveMatrixConfig,
  type ExecutionHiveModelRouting,
  type ExecutionHiveRuntimeProvider,
  type ModelSourceInventoryItem,
  type ModelSourceProbeResult,
  type RuntimeInventoryItem,
} from "@/lib/orchestration/execution-hives";
import type { TaskExecutionEngine } from "@/lib/orchestration/types";
import { color, font, radius, space, type as T } from "@/lib/ui/tokens";
import { ActionButton, Section } from "@/lib/ui/primitives";

type MatrixColumnId = "mode" | "runtime" | "routing";

type MatrixOption = {
  value: string;
  label: string;
  description: string;
  meta: string;
  recommended?: boolean;
  modelSourceId?: ModelSourceInventoryItem["id"];
  icon: ReactNode;
};

type MatrixSelection = Record<MatrixColumnId, string>;
type ModelSourceProbeMap = Partial<Record<ModelSourceInventoryItem["id"], ModelSourceProbeResult>>;
type RuntimeInventoryMap = Partial<Record<RuntimeInventoryItem["id"], RuntimeInventoryItem>>;
type RuntimeDurationMap = Record<string, { durationMs: number | null; sampleSize: number }>;
type CompatibilityState = {
  disabled: boolean;
  reason?: string;
};

type ConnectorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ConnectorGeometry = {
  width: number;
  height: number;
  mode: ConnectorRect;
  runtime: ConnectorRect;
  routing: ConnectorRect;
} | null;

const modeOptions: MatrixOption[] = [
  {
    value: "Symphony",
    label: "Symphony",
    description: "External runner orchestration",
    meta: "formal runner path",
    icon: <Workflow size={15} />,
  },
  {
    value: "HiveRunner Native",
    label: "HiveRunner Native",
    description: "Built-in orchestration engine",
    meta: "company default",
    recommended: true,
    icon: <Box size={15} />,
  },
  {
    value: "Manual / Operator Controlled",
    label: "Manual",
    description: "Operator controlled",
    meta: "no autonomous run",
    icon: <Hand size={15} />,
  },
];

const runtimeCatalog: MatrixOption[] = [
  {
    value: "Codex",
    label: "Codex",
    description: "OpenAI runner",
    meta: "runtime managed",
    icon: <Code2 size={15} />,
  },
  {
    value: "Claude Code",
    label: "Claude Code",
    description: "Anthropic runner",
    meta: "runtime managed",
    icon: <Zap size={15} />,
  },
  {
    value: "Gemini CLI",
    label: "Gemini CLI",
    description: "Google runner",
    meta: "runtime managed",
    icon: <Sparkles size={15} />,
  },
  {
    value: "Hermes",
    label: "Hermes",
    description: "In-house runner",
    meta: "profile managed",
    icon: <Network size={15} />,
  },
  {
    value: "OpenClaw",
    label: "OpenClaw",
    description: "Workspace runner",
    meta: "platform managed",
    icon: <Folder size={15} />,
  },
];

const routingOptions: MatrixOption[] = [
  {
    value: "Runtime managed",
    label: "Runtime managed",
    description: "Runtime selects model/profile",
    meta: "defer to runtime",
    icon: <Lock size={15} />,
  },
  {
    value: "Hive managed",
    label: "Hive managed",
    description: "HiveRunner selects lane/provider",
    meta: "policy + fallbacks",
    recommended: true,
    icon: <Route size={15} />,
  },
  {
    value: "OpenRouter",
    label: "OpenRouter",
    description: "Broker selects or routes models",
    meta: "broker managed",
    modelSourceId: "openrouter",
    icon: <Network size={15} />,
  },
  {
    value: "Anthropic Direct",
    label: "Anthropic Direct",
    description: "Pin to Anthropic source",
    meta: "direct provider",
    modelSourceId: "anthropic",
    icon: <Zap size={15} />,
  },
  {
    value: "OpenAI Direct",
    label: "OpenAI Direct",
    description: "Pin to OpenAI source",
    meta: "direct provider",
    modelSourceId: "openai",
    icon: <Code2 size={15} />,
  },
  {
    value: "Google Direct",
    label: "Google Direct",
    description: "Pin to Google source",
    meta: "direct provider",
    modelSourceId: "google",
    icon: <Sparkles size={15} />,
  },
];

const compatibleRuntimesByRouting: Record<string, string[]> = {
  "Runtime managed": runtimeCatalog.map((option) => option.value),
  "Hive managed": runtimeCatalog.map((option) => option.value),
  OpenRouter: ["Codex"],
  "Anthropic Direct": ["Claude Code"],
  "OpenAI Direct": ["Codex"],
  "Google Direct": ["Gemini CLI"],
};

const compatibleRoutingsByRuntime: Record<string, string[]> = {
  Codex: ["Runtime managed", "Hive managed", "OpenRouter", "OpenAI Direct"],
  "Claude Code": ["Runtime managed", "Hive managed", "Anthropic Direct"],
  "Gemini CLI": ["Runtime managed", "Hive managed", "Google Direct"],
  Hermes: ["Runtime managed", "Hive managed"],
  OpenClaw: ["Runtime managed", "Hive managed"],
};

const requiredRuntimeByRouting: Record<string, string> = {
  OpenRouter: "Codex",
  "Anthropic Direct": "Claude Code",
  "OpenAI Direct": "Codex",
  "Google Direct": "Gemini CLI",
};

function normalizeRuntimeLabel(label: string): string {
  if (label.toLowerCase().includes("claude")) return "Claude Code";
  if (label.toLowerCase().includes("codex")) return "Codex";
  if (label.toLowerCase().includes("gemini")) return "Gemini CLI";
  if (label.toLowerCase().includes("hermes")) return "Hermes";
  if (label.toLowerCase().includes("openclaw")) return "OpenClaw";
  return label;
}

function runtimeInventoryIdForLabel(label: string): RuntimeInventoryItem["id"] {
  const normalized = normalizeRuntimeLabel(label).toLowerCase();
  if (normalized.includes("claude")) return "claude-code";
  if (normalized.includes("gemini")) return "gemini-cli";
  if (normalized.includes("hermes")) return "hermes";
  if (normalized.includes("openclaw")) return "openclaw";
  if (normalized.includes("manual")) return "manual";
  return "codex";
}

function runtimeDurationKeysForLabel(label: string): string[] {
  const id = runtimeInventoryIdForLabel(label);
  if (id === "claude-code") return ["claude-code", "anthropic"];
  if (id === "gemini-cli") return ["gemini-cli", "gemini"];
  return [id];
}

function defaultSelectionForHive(hive: ExecutionHive): MatrixSelection {
  const policy = hive.routingPolicy.toLowerCase();
  return {
    mode: formatOrchestrationModeLabel(hive.orchestrationMode),
    runtime: normalizeRuntimeLabel(hive.runtimePriority[0] ?? "Runtime managed"),
    routing: policy.includes("runtime-managed") || policy.includes("runtime managed")
      ? "Runtime managed"
      : policy.includes("openrouter")
        ? "OpenRouter"
        : policy.includes("anthropic")
          ? "Anthropic Direct"
          : policy.includes("openai")
            ? "OpenAI Direct"
            : policy.includes("google")
              ? "Google Direct"
              : "Hive managed",
  };
}

function runtimeOptionsForHive(hive: ExecutionHive): MatrixOption[] {
  const preferred = hive.runtimePriority.map(normalizeRuntimeLabel);
  const catalogByValue = new Map(runtimeCatalog.map((option) => [option.value, option]));
  const ordered: MatrixOption[] = [];
  preferred.forEach((value, index) => {
    const option = catalogByValue.get(value);
    if (option) ordered.push({ ...option, recommended: index === 0 });
  });
  const seen = new Set(ordered.map((option) => option.value));
  return [
    ...ordered,
    ...runtimeCatalog.filter((option) => !seen.has(option.value)),
  ];
}

function isSameSelection(left: MatrixSelection, right: MatrixSelection): boolean {
  return left.mode === right.mode && left.runtime === right.runtime && left.routing === right.routing;
}

function isRuntimeCompatibleWithRouting(runtime: string, routing: string): boolean {
  return (compatibleRuntimesByRouting[routing] ?? runtimeCatalog.map((option) => option.value)).includes(runtime);
}

function isRoutingCompatibleWithRuntime(routing: string, runtime: string): boolean {
  return (compatibleRoutingsByRuntime[runtime] ?? ["Runtime managed", "Hive managed"]).includes(routing);
}

function runtimeCompatibilityState(option: string, selection: MatrixSelection): CompatibilityState {
  if (isRuntimeCompatibleWithRouting(option, selection.routing)) return { disabled: false };
  const required = requiredRuntimeByRouting[selection.routing];
  return {
    disabled: true,
    reason: required
      ? `${selection.routing} requires ${required} runtime.`
      : `${selection.routing} is not compatible with ${option}.`,
  };
}

function routingCompatibilityState(option: string, selection: MatrixSelection): CompatibilityState {
  if (isRoutingCompatibleWithRuntime(option, selection.runtime)) return { disabled: false };
  return {
    disabled: true,
    reason: `${option} is not compatible with ${selection.runtime}.`,
  };
}

function nextCompatibleSelection(current: MatrixSelection, column: MatrixColumnId, value: string): { selection: MatrixSelection; notice: string | null } {
  const next = { ...current, [column]: value };
  if (column === "routing" && !isRuntimeCompatibleWithRouting(next.runtime, value)) {
    const runtime = requiredRuntimeByRouting[value] ?? compatibleRuntimesByRouting[value]?.[0] ?? "Codex";
    return {
      selection: { ...next, runtime },
      notice: `Switched runtime to ${runtime} to match ${value}.`,
    };
  }
  if (column === "runtime" && !isRoutingCompatibleWithRuntime(next.routing, value)) {
    const routing = compatibleRoutingsByRuntime[value]?.[0] ?? "Runtime managed";
    return {
      selection: { ...next, routing },
      notice: `Switched model routing to ${routing} to match ${value}.`,
    };
  }
  return { selection: next, notice: null };
}

function connectorPath(from: ConnectorRect, to: ConnectorRect): string {
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  const controlX = (startX + endX) / 2;
  return `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`;
}

function engineFromSelection(value: string): TaskExecutionEngine {
  if (value === "Symphony") return "symphony";
  if (value === "Manual / Operator Controlled" || value === "Manual") return "manual";
  return "hiverunner";
}

function runtimeProviderFromSelection(value: string): ExecutionHiveRuntimeProvider {
  if (value === "Claude Code") return "anthropic";
  if (value === "Gemini CLI") return "gemini";
  if (value === "Hermes") return "hermes";
  if (value === "OpenClaw") return "openclaw";
  return "codex";
}

function modelRoutingFromSelection(value: string): ExecutionHiveModelRouting {
  if (value === "Runtime managed") return "runtime-managed";
  if (value === "OpenRouter") return "openrouter";
  if (value === "Anthropic Direct") return "anthropic";
  if (value === "OpenAI Direct") return "openai";
  if (value === "Google Direct") return "google";
  return "hive-managed";
}

function configFromSelection(selection: MatrixSelection): ExecutionHiveMatrixConfig {
  return {
    orchestrationMode: engineFromSelection(selection.mode),
    runtimeProvider: runtimeProviderFromSelection(selection.runtime),
    runtimeLabel: selection.runtime,
    modelRouting: modelRoutingFromSelection(selection.routing),
    modelRoutingLabel: selection.routing,
  };
}

export function ExecutionMatrix({
  selectedHive,
  onApply,
  runtimeItems = [],
  runtimeTaskDurationP50 = {},
  modelSources = [],
  modelSourceProbes = {},
  onSelectModelSource,
}: {
  selectedHive: ExecutionHive;
  onApply?: (hiveId: string, config: ExecutionHiveMatrixConfig) => Promise<boolean>;
  runtimeItems?: RuntimeInventoryItem[];
  runtimeTaskDurationP50?: RuntimeDurationMap;
  modelSources?: ModelSourceInventoryItem[];
  modelSourceProbes?: ModelSourceProbeMap;
  onSelectModelSource?: (item: ModelSourceInventoryItem) => void;
}) {
  const hiveDefaultSelection = useMemo(() => defaultSelectionForHive(selectedHive), [selectedHive]);
  const runtimeOptions = useMemo(() => runtimeOptionsForHive(selectedHive), [selectedHive]);
  const [selection, setSelection] = useState<MatrixSelection>(hiveDefaultSelection);
  const [appliedSelection, setAppliedSelection] = useState<MatrixSelection>(hiveDefaultSelection);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [connectorGeometry, setConnectorGeometry] = useState<ConnectorGeometry>(null);
  const matrixDeckRef = useRef<HTMLDivElement | null>(null);
  const modelSourceById = useMemo(() => new Map(modelSources.map((source) => [source.id, source])), [modelSources]);
  const runtimeById = useMemo<RuntimeInventoryMap>(
    () => Object.fromEntries(runtimeItems.map((runtime) => [runtime.id, runtime])),
    [runtimeItems],
  );

  useEffect(() => {
    setSelection(hiveDefaultSelection);
    setAppliedSelection(hiveDefaultSelection);
  }, [hiveDefaultSelection]);

  const columns = useMemo(() => [
    {
      id: "mode" as const,
      step: "01 / 03",
      title: "Orchestration Mode",
      options: modeOptions,
    },
    {
      id: "runtime" as const,
      step: "02 / 03",
      title: "Runtime",
      options: runtimeOptions,
    },
    {
      id: "routing" as const,
      step: "03 / 03",
      title: "Model Routing",
      options: routingOptions,
    },
  ], [runtimeOptions]);

  const hasPendingChanges = !isSameSelection(selection, appliedSelection);

  useEffect(() => {
    const deck = matrixDeckRef.current;
    if (!deck) return undefined;

    const findActive = (column: MatrixColumnId): ConnectorRect | null => {
      const element = deck.querySelector<HTMLElement>(`[data-matrix-column="${column}"] [data-active="1"]`);
      if (!element) return null;
      const deckRect = deck.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left - deckRect.left,
        y: rect.top - deckRect.top,
        width: rect.width,
        height: rect.height,
      };
    };

    const updateGeometry = () => {
      const mode = findActive("mode");
      const runtime = findActive("runtime");
      const routing = findActive("routing");
      const deckRect = deck.getBoundingClientRect();
      setConnectorGeometry(mode && runtime && routing
        ? { width: deckRect.width, height: deckRect.height, mode, runtime, routing }
        : null);
    };

    updateGeometry();
    const observer = new ResizeObserver(updateGeometry);
    observer.observe(deck);
    deck.addEventListener("scroll", updateGeometry, true);
    window.addEventListener("resize", updateGeometry);
    return () => {
      observer.disconnect();
      deck.removeEventListener("scroll", updateGeometry, true);
      window.removeEventListener("resize", updateGeometry);
    };
  }, [selection, columns]);

  function selectOption(column: MatrixColumnId, value: string) {
    setSaveError(null);
    setSelection((current) => {
      const next = nextCompatibleSelection(current, column, value);
      setSelectionNotice(next.notice);
      return next.selection;
    });
    if (column === "routing" && onSelectModelSource) {
      const modelSourceId = routingOptions.find((option) => option.value === value)?.modelSourceId;
      const modelSource = modelSourceId ? modelSourceById.get(modelSourceId) : null;
      if (modelSource) onSelectModelSource(modelSource);
    }
  }

  async function applySelection() {
    if (!hasPendingChanges || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const ok = onApply ? await onApply(selectedHive.id, configFromSelection(selection)) : true;
      if (!ok) {
        setSaveError("The matrix selection could not be saved.");
        return;
      }
      setAppliedSelection(selection);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Execution Matrix">
      <style>{`
        @keyframes executionMatrixFlow {
          to { stroke-dashoffset: -16; }
        }
        .execution-matrix-scroll {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .execution-matrix-scroll::-webkit-scrollbar {
          display: none;
        }
        @media (prefers-reduced-motion: reduce) {
          [data-execution-matrix-path="animated"] .execution-matrix-connector {
            animation: none !important;
          }
        }
      `}</style>
      <div
        data-execution-matrix-path="animated"
        style={{
          position: "relative",
          overflow: "hidden",
          borderRadius: radius.lg,
          border: `0.5px solid ${color.border}`,
          background: color.surface,
          padding: space.xl,
        }}
      >
        <div style={{ marginBottom: space.xl, display: "flex", alignItems: "center", gap: space.sm, color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono, textTransform: "uppercase", letterSpacing: T.sectionLabel.letterSpacing }}>
          <span style={{ width: 32, height: 2, borderRadius: radius.full, background: color.accent }} />
          Configure execution matrix
          <span style={{ color: color.textMuted }}>·</span>
          {selectedHive.name}
        </div>

        <div style={{
          display: "flex",
          alignItems: "center",
          gap: space.sm,
          marginBottom: space.xl,
          padding: space.md,
          borderRadius: radius.md,
          border: `0.5px solid ${color.border}`,
          background: color.surfaceElevated,
          color: color.textSecondary,
          fontSize: T.bodySmall.size,
          fontFamily: font.mono,
          minHeight: 42,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: radius.full, background: color.positive, flex: "0 0 auto" }} />
          <span style={{ color: color.textMuted, textTransform: "uppercase", letterSpacing: T.sectionLabel.letterSpacing }}>Execution path</span>
          <span style={{ color: color.borderStrong }}>|</span>
          <strong style={{ color: color.text, fontWeight: 650 }}>{selection.mode}</strong>
          <span style={{ color: color.textMuted }}>›</span>
          <strong style={{ color: color.text, fontWeight: 650 }}>{selection.runtime}</strong>
          <span style={{ color: color.textMuted }}>›</span>
          <strong style={{ color: color.text, fontWeight: 650 }}>{selection.routing}</strong>
        </div>

        <div ref={matrixDeckRef} style={{ position: "relative" }}>
          {connectorGeometry ? (
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${connectorGeometry.width} ${connectorGeometry.height}`}
              preserveAspectRatio="none"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0 }}
            >
              <path
                className="execution-matrix-connector"
                d={connectorPath(connectorGeometry.mode, connectorGeometry.runtime)}
                fill="none"
                stroke={color.accent}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="4 4"
                opacity="0.7"
                style={{ animation: "executionMatrixFlow 1.6s linear infinite" }}
              />
              <path
                className="execution-matrix-connector"
                d={connectorPath(connectorGeometry.runtime, connectorGeometry.routing)}
                fill="none"
                stroke={color.accent}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeDasharray="4 4"
                opacity="0.7"
                style={{ animation: "executionMatrixFlow 1.6s linear infinite" }}
              />
            </svg>
          ) : null}

          <div style={{ position: "relative", zIndex: 1, display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: space.xl }}>
            {columns.map((column) => (
              <MatrixColumn
                key={column.id}
                column={column.id}
                step={column.step}
                title={column.title}
                options={column.options}
                selectedValue={selection[column.id]}
                runtimeById={runtimeById}
                runtimeTaskDurationP50={runtimeTaskDurationP50}
                compatibilityForOption={(option) => {
                  if (column.id === "runtime") return runtimeCompatibilityState(option.value, selection);
                  if (column.id === "routing") return routingCompatibilityState(option.value, selection);
                  return { disabled: false };
                }}
                modelSourceById={modelSourceById}
                modelSourceProbes={modelSourceProbes}
                onSelect={selectOption}
              />
            ))}
          </div>
        </div>

        <div style={{ marginTop: space.xl, paddingTop: space.sm, display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
          <span style={{ color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono }}>
            {saveError ?? selectionNotice ?? (saving ? "saving selection..." : hasPendingChanges ? "selection pending" : "selection applied")}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: space.sm }}>
            <ActionButton label="Reset" variant="ghost" size="sm" onClick={() => setSelection(appliedSelection)} disabled={!hasPendingChanges || saving} />
            <ActionButton label={saving ? "Applying" : "Apply"} variant="secondary" size="sm" onClick={applySelection} disabled={!hasPendingChanges || saving} />
          </div>
        </div>
      </div>
    </Section>
  );
}

function MatrixColumn({
  column,
  step,
  title,
  options,
  selectedValue,
  runtimeById,
  runtimeTaskDurationP50,
  compatibilityForOption,
  modelSourceById,
  modelSourceProbes,
  onSelect,
}: {
  column: MatrixColumnId;
  step: string;
  title: string;
  options: MatrixOption[];
  selectedValue: string;
  runtimeById: RuntimeInventoryMap;
  runtimeTaskDurationP50: RuntimeDurationMap;
  compatibilityForOption: (option: MatrixOption) => CompatibilityState;
  modelSourceById: Map<string, ModelSourceInventoryItem>;
  modelSourceProbes: ModelSourceProbeMap;
  onSelect: (column: MatrixColumnId, value: string) => void;
}) {
  return (
    <div
      data-matrix-column={column}
      style={{
        height: 560,
        minHeight: 560,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        overflow: "hidden",
        borderRadius: radius.lg,
        border: `0.5px solid ${color.border}`,
        background: color.surfaceElevated,
        padding: space.md,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.sm, marginBottom: space.md }}>
        <span style={{ color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono, textTransform: "uppercase", letterSpacing: T.sectionLabel.letterSpacing }}>{title}</span>
        <span style={{ color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono }}>{step}</span>
      </div>
      <div
        className="execution-matrix-scroll"
        style={{
          minHeight: 0,
          display: "grid",
          alignContent: "start",
          gap: space.sm,
          overflowX: "hidden",
          overflowY: "auto",
        }}
      >
        {options.map((option) => {
          const compatibility = compatibilityForOption(option);
          return (
            <MatrixOptionButton
              key={option.value}
              column={column}
              option={option}
              selected={option.value === selectedValue}
              disabled={compatibility.disabled}
              disabledReason={compatibility.reason}
              runtime={column === "runtime" ? runtimeById[runtimeInventoryIdForLabel(option.value)] : undefined}
              runtimeTaskDuration={column === "runtime" ? runtimeDurationForLabel(option.value, runtimeTaskDurationP50) : undefined}
              modelSource={option.modelSourceId ? modelSourceById.get(option.modelSourceId) : undefined}
              modelSourceProbe={option.modelSourceId ? modelSourceProbes[option.modelSourceId] : undefined}
              onClick={() => onSelect(column, option.value)}
            />
          );
        })}
      </div>
    </div>
  );
}

function sourceStatusLabel(source: ModelSourceInventoryItem, probe?: ModelSourceProbeResult): string {
  if (probe?.status === "pass") return probe.latencyMs ? `probe passed · ${probe.latencyMs}ms` : "probe passed";
  if (probe?.status === "fail") return "probe failed";
  if (probe?.status === "warn") return "probe needs review";
  if (source.status === "connected") return source.authSurface ? `credential configured · ${source.authSurface}` : "credential configured";
  if (source.status === "needs_key") return "needs credential";
  if (source.status === "warning") return "needs review";
  if (source.status === "available") return "available";
  return "not configured";
}

function sourceStatusColor(source: ModelSourceInventoryItem, probe?: ModelSourceProbeResult): string {
  if (probe?.status === "pass") return color.positive;
  if (probe?.status === "fail") return color.negative;
  if (probe?.status === "warn") return color.warning;
  if (source.status === "connected" || source.status === "available") return color.positive;
  if (source.status === "needs_key" || source.status === "warning") return color.warning;
  return color.textMuted;
}

function sourceStatusBackground(source: ModelSourceInventoryItem, probe?: ModelSourceProbeResult): string {
  const statusColor = sourceStatusColor(source, probe);
  if (statusColor === color.positive) return color.positiveSoft;
  if (statusColor === color.negative) return color.negativeSoft;
  if (statusColor === color.warning) return color.warningSoft;
  return color.surfaceElevated;
}

function runtimeStatusLabel(runtime?: RuntimeInventoryItem): string {
  if (!runtime) return "not detected";
  if (runtime.status === "ready") return "ready";
  if (runtime.status === "needs_login") return "needs login";
  if (runtime.status === "missing_cli") return "missing CLI";
  if (runtime.status === "warning") return "needs review";
  return "disabled";
}

function runtimeStatusColor(runtime?: RuntimeInventoryItem): string {
  if (!runtime) return color.textMuted;
  if (runtime.status === "ready") return color.positive;
  if (runtime.status === "warning" || runtime.status === "needs_login") return color.warning;
  return color.negative;
}

function runtimeDurationForLabel(label: string, durations: RuntimeDurationMap): { durationMs: number | null; sampleSize: number } | undefined {
  for (const key of runtimeDurationKeysForLabel(label)) {
    const duration = durations[key];
    if (duration) return duration;
  }
  return undefined;
}

function formatRuntimeDuration(metric?: { durationMs: number | null; sampleSize: number }): string {
  if (!metric || typeof metric.durationMs !== "number") return "P50 task: -";
  if (metric.durationMs < 1000) return `P50 task: ${metric.durationMs}ms`;
  const seconds = Math.round(metric.durationMs / 1000);
  if (seconds < 60) return `P50 task: ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `P50 task: ${minutes}m${remainder ? ` ${remainder}s` : ""}`;
}

function MatrixOptionButton({
  column,
  option,
  selected,
  disabled,
  disabledReason,
  runtime,
  runtimeTaskDuration,
  modelSource,
  modelSourceProbe,
  onClick,
}: {
  column: MatrixColumnId;
  option: MatrixOption;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string;
  runtime?: RuntimeInventoryItem;
  runtimeTaskDuration?: { durationMs: number | null; sampleSize: number };
  modelSource?: ModelSourceInventoryItem;
  modelSourceProbe?: ModelSourceProbeResult;
  onClick: () => void;
}) {
  const optionId = `${column}:${option.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
  const optionStyle: CSSProperties = {
    width: "100%",
    minHeight: modelSource ? 104 : 86,
    display: "grid",
    gridTemplateColumns: "34px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    border: `0.5px solid ${selected ? color.accent : color.border}`,
    background: selected ? color.accentSoft : color.surface,
    color: disabled ? color.textMuted : color.text,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    textAlign: "left",
    transition: "border-color 0.15s, background 0.15s",
    position: "relative",
    zIndex: selected ? 3 : 1,
  };

  return (
    <button
      type="button"
      aria-label={`Select ${column}: ${option.label}`}
      aria-pressed={selected}
      aria-disabled={disabled ? "true" : undefined}
      disabled={disabled}
      data-matrix-column={column}
      data-matrix-option={optionId}
      data-active={selected ? "1" : "0"}
      title={disabledReason}
      onClick={disabled ? undefined : onClick}
      style={optionStyle}
    >
      <span style={{
        width: 34,
        height: 34,
        borderRadius: radius.md,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: `0.5px solid ${selected ? color.accent : color.border}`,
        color: selected ? color.accent : color.textMuted,
        background: color.surfaceElevated,
      }}>
        {option.icon}
      </span>
      <span style={{ minWidth: 0, display: "grid", alignContent: "center", gap: 4 }}>
        <span style={{ display: "flex", alignItems: "center", gap: space.sm, minWidth: 0 }}>
          <strong style={{ color: color.text, fontSize: T.body.size, fontWeight: 650, lineHeight: 1.25, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.label}</strong>
          {option.recommended ? <span style={{ color: color.accent, fontSize: T.caption.size, fontFamily: font.mono, whiteSpace: "nowrap" }}>recommended</span> : null}
        </span>
        <span style={{ display: "block", color: color.textSecondary, fontSize: T.bodySmall.size, lineHeight: T.bodySmall.lineHeight, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.description}</span>
        <span style={{ display: "block", color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.meta}</span>
        {column === "runtime" ? (
          <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
              maxWidth: "100%",
              color: runtimeStatusColor(runtime),
              fontSize: T.caption.size,
              fontFamily: font.mono,
              lineHeight: 1.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: radius.full, background: runtimeStatusColor(runtime), flex: "0 0 auto" }} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{runtimeStatusLabel(runtime)}</span>
            </span>
            <span title="Median real task duration for this runtime over the last 7 days." style={{ color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono, lineHeight: 1.25 }}>
              {formatRuntimeDuration(runtimeTaskDuration)}
            </span>
          </span>
        ) : null}
        {modelSource ? (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            maxWidth: "100%",
            width: "fit-content",
            padding: "4px 8px",
            borderRadius: radius.full,
            border: `0.5px solid ${sourceStatusColor(modelSource, modelSourceProbe)}`,
            background: sourceStatusBackground(modelSource, modelSourceProbe),
            color: sourceStatusColor(modelSource, modelSourceProbe),
            fontSize: T.caption.size,
            fontFamily: font.mono,
            lineHeight: 1.25,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            <KeyRound size={12} style={{ flex: "0 0 auto" }} />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{sourceStatusLabel(modelSource, modelSourceProbe)}</span>
          </span>
        ) : null}
      </span>
      {selected ? <Check size={15} color={color.accent} /> : null}
    </button>
  );
}
