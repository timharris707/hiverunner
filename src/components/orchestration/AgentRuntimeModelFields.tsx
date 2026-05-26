"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { ProviderLogo } from "@/components/orchestration/ProviderLogo";

type RuntimeStatus = "online" | "offline" | "unknown" | "error" | "disabled";

export type AgentRuntimeSelection = {
  key: string;
  provider: string;
  displayName: string;
  runtimeSlug?: string | null;
  command?: string | null;
  commandPath?: string | null;
  source: "registered" | "detected";
};

type RuntimeRecord = {
  id?: string;
  agentId?: string | null;
  provider?: string;
  displayName?: string;
  runtimeSlug?: string;
  runtimeKind?: string;
  scope?: string;
  command?: string | null;
  version?: string | null;
  status?: RuntimeStatus;
  metadata?: Record<string, unknown>;
  health?: {
    commandPath?: string | null;
    versionLatest?: boolean | null;
  } | null;
};

type DetectedRuntimeRecord = {
  provider?: string;
  displayName?: string;
  command?: string;
  commandPath?: string;
  version?: string;
  status?: RuntimeStatus;
  metadata?: Record<string, unknown>;
};

type RuntimeModelRecord = {
  id?: string;
  value?: string;
  label?: string;
  provider?: string;
  default?: boolean;
};

type RuntimeOption = AgentRuntimeSelection & {
  status: RuntimeStatus;
  version?: string | null;
  versionLatest?: boolean | null;
};

type ModelOption = {
  value: string;
  label: string;
  provider?: string;
  default?: boolean;
};

type ModelRow = {
  key: string;
  value: string;
  label: string;
  technicalId: string;
  provider: string;
  default?: boolean;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "claude") return "anthropic";
  if (normalized === "openai") return "openai-codex";
  return normalized;
}

function runtimeLabel(provider: string): string {
  switch (normalizeProvider(provider)) {
    case "anthropic":
      return "Claude";
    case "codex":
      return "Codex";
    case "gemini":
      return "Gemini";
    case "hermes":
      return "HERMES";
    case "symphony":
      return "External runner";
    case "multica":
      return "Multica";
    case "manual":
      return "HiveRunner manual";
    case "openclaw":
      return "OpenClaw";
    default:
      return provider || "Runtime";
  }
}

function isSelectableRuntimeProvider(provider: string): boolean {
  return Boolean(normalizeProvider(provider));
}

function runtimeSortValue(runtime: RuntimeOption): number {
  if (runtime.status === "online") return 0;
  if (runtime.status === "unknown") return 1;
  if (runtime.status === "offline") return 2;
  return 3;
}

function runtimeProviderSortValue(runtime: RuntimeOption): number {
  switch (normalizeProvider(runtime.provider)) {
    case "codex":
    case "openai-codex":
      return 0;
    case "manual":
      return 1;
    case "hermes":
      return 2;
    case "symphony":
      return 2.5;
    case "anthropic":
      return 3;
    case "gemini":
      return 4;
    case "openclaw":
      return 8;
    default:
      return 9;
  }
}

function modelSortValue(model: ModelOption): number {
  if (model.default) return -1;
  if (model.value.includes("gpt-5.5")) return 0;
  if (model.value.includes("gpt-5.4-mini")) return 2;
  if (model.value.includes("gpt-5.4")) return 1;
  if (model.value.includes("gpt-5.3-codex-spark")) return 4;
  if (model.value.includes("gpt-5.3-codex")) return 3;
  if (model.value.includes("gpt-5.2")) return 5;
  if (model.value.includes("claude-sonnet-4-6")) return 10;
  if (model.value.includes("claude-opus-4-7")) return 11;
  if (model.value.includes("claude-haiku-4-5")) return 12;
  if (model.value.includes("claude-opus-4-6")) return 13;
  if (model.value.includes("claude-sonnet-4-5")) return 14;
  if (model.value.includes("gemini-3.1-pro")) return 20;
  if (model.value.includes("gemini-3-pro")) return 21;
  if (model.value.includes("gemini-3-flash")) return 22;
  if (model.value.includes("gemini-2.5-pro")) return 23;
  if (model.value.includes("gemini-2.5-flash")) return 24;
  return 100;
}

function buildRuntimeOptions(
  runtimes: RuntimeRecord[],
  detected: DetectedRuntimeRecord[],
): RuntimeOption[] {
  const seen = new Set<string>();
  const options: RuntimeOption[] = [
    {
      key: "manual:hiverunner",
      provider: "manual",
      displayName: "HiveRunner manual",
      runtimeSlug: null,
      command: null,
      commandPath: null,
      source: "registered",
      status: "online",
      version: null,
      versionLatest: null,
    },
  ];

  for (const runtime of runtimes) {
    if (runtime.agentId || runtime.scope === "agent") continue;
    const provider = normalizeProvider(stringValue(runtime.provider));
    if (!provider || !isSelectableRuntimeProvider(provider)) continue;
    const key = `registered:${runtime.id || runtime.runtimeSlug || provider}`;
    seen.add(`registered:${provider}:${runtime.runtimeSlug || runtime.id || ""}`);
    options.push({
      key,
      provider,
      displayName: stringValue(runtime.displayName) || runtimeLabel(provider),
      runtimeSlug: stringValue(runtime.runtimeSlug) || null,
      command: stringValue(runtime.command) || null,
      commandPath: stringValue(runtime.health?.commandPath) || null,
      source: "registered",
      status: runtime.status ?? "unknown",
      version: runtime.version ?? null,
      versionLatest: runtime.health?.versionLatest ?? null,
    });
  }

  for (const runtime of detected) {
    const provider = normalizeProvider(stringValue(runtime.provider));
    const commandPath = stringValue(runtime.commandPath);
    if (!provider || !isSelectableRuntimeProvider(provider) || seen.has(`detected:${provider}:${commandPath}`)) continue;
    const hasRegisteredProvider = options.some((option) => option.provider === provider);
    if (hasRegisteredProvider) continue;
    options.push({
      key: `detected:${provider}:${commandPath || runtime.command || provider}`,
      provider,
      displayName: stringValue(runtime.displayName) || runtimeLabel(provider),
      command: stringValue(runtime.command) || provider,
      commandPath: commandPath || null,
      source: "detected",
      status: runtime.status ?? "online",
      version: runtime.version ?? null,
      versionLatest:
        typeof runtime.metadata?.versionLatest === "boolean"
          ? runtime.metadata.versionLatest
          : null,
    });
  }

  return options.sort((a, b) => {
    const status = runtimeSortValue(a) - runtimeSortValue(b);
    if (status !== 0) return status;
    const providerPriority = runtimeProviderSortValue(a) - runtimeProviderSortValue(b);
    if (providerPriority !== 0) return providerPriority;
    return a.displayName.localeCompare(b.displayName);
  });
}

function buildModelOptions(models: RuntimeModelRecord[]): ModelOption[] {
  const parsed: ModelOption[] = [];

  for (const model of models) {
    const value = stringValue(model.id) || stringValue(model.value);
    if (!value) continue;

    const provider = stringValue(model.provider);
    const option: ModelOption = {
      value,
      label: stringValue(model.label) || value,
      default: Boolean(model.default),
    };
    if (provider) {
      option.provider = provider;
    }

    parsed.push(option);
  }

  return parsed.sort((a, b) => {
    const priority = modelSortValue(a) - modelSortValue(b);
    if (priority !== 0) return priority;
    return a.label.localeCompare(b.label);
  });
}

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--text-secondary)",
  marginBottom: "6px",
  display: "flex",
  alignItems: "center",
  gap: "4px",
};

function providerSectionLabel(provider: string): string {
  const normalized = normalizeProvider(provider);
  switch (normalized) {
    case "anthropic":
      return "ANTHROPIC";
    case "codex":
    case "openai":
    case "openai-codex":
      return "OPENAI";
    case "gemini":
    case "google":
      return "GOOGLE";
    case "hermes":
      return "HERMES";
    case "symphony":
      return "SYMPHONY";
    case "multica":
      return "MULTICA";
    case "manual":
      return "HIVERUNNER";
    case "openclaw":
      return "OPENCLAW";
    default:
      return (provider || "PROVIDER").toUpperCase();
  }
}

function modelProviderFromValue(value: string, fallbackProvider?: string): string {
  if (value.includes("/")) return value.split("/")[0] || fallbackProvider || "";
  if (value.includes(":")) return value.split(":")[0] || fallbackProvider || "";
  return fallbackProvider || "";
}

function displayModelId(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized.includes("/")) return normalized.split("/").slice(1).join("/") || normalized;
  if (normalized.includes(":")) return normalized.split(":").slice(1).join(":") || normalized;
  return normalized;
}

function buildModelRows(models: ModelOption[], defaultModel: ModelOption | null): ModelRow[] {
  const rows: ModelRow[] = [];
  const seen = new Set<string>();

  if (defaultModel) {
    const provider = defaultModel.provider || modelProviderFromValue(defaultModel.value);
    rows.push({
      key: "runtime-default",
      value: "",
      label: defaultModel.label,
      technicalId: displayModelId(defaultModel.value),
      provider,
      default: true,
    });
    seen.add(defaultModel.value);
  }

  for (const model of models) {
    if (seen.has(model.value)) continue;
    const provider = model.provider || modelProviderFromValue(model.value);
    rows.push({
      key: model.value,
      value: model.value,
      label: model.label,
      technicalId: displayModelId(model.value),
      provider,
      default: model.default,
    });
    seen.add(model.value);
  }

  return rows;
}

function RuntimeGlyph({ provider }: { provider: string }) {
  const normalized = normalizeProvider(provider);
  const baseStyle: React.CSSProperties = {
    width: "30px",
    height: "30px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-secondary)",
    flex: "0 0 30px",
  };

  return (
    <span style={baseStyle}>
      <ProviderLogo provider={normalized} size={19} />
    </span>
  );
}

export function AgentRuntimeModelFields({
  companySlug,
  model,
  onModelChange,
  runtime,
  onRuntimeChange,
}: {
  companySlug: string;
  model: string;
  onModelChange: (model: string) => void;
  runtime: AgentRuntimeSelection | null;
  onRuntimeChange: (runtime: AgentRuntimeSelection | null) => void;
}) {
  const [runtimeOptions, setRuntimeOptions] = useState<RuntimeOption[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loadingRuntimes, setLoadingRuntimes] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [runtimeMenuOpen, setRuntimeMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelMenuPlacement, setModelMenuPlacement] = useState<"up" | "down">("down");
  const [modelMenuListMaxHeight, setModelMenuListMaxHeight] = useState(326);
  const [modelQuery, setModelQuery] = useState("");
  const modelPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!companySlug) return;
    let cancelled = false;

    function applyRuntimePayload(runtimeJson: {
      runtimes?: RuntimeRecord[];
      detectedLocalRuntimes?: DetectedRuntimeRecord[];
    }) {
      setRuntimeOptions(buildRuntimeOptions(runtimeJson.runtimes ?? [], runtimeJson.detectedLocalRuntimes ?? []));
    }

    async function fetchRuntimePayload(fast: boolean) {
      const url = `/api/orchestration/companies/${encodeURIComponent(companySlug)}/runtimes${fast ? "?fast=1" : ""}`;
      const runtimeResponse = await fetch(url, { cache: "no-store" });
      if (!runtimeResponse.ok) throw new Error(`runtime:${runtimeResponse.status}`);
      return (await runtimeResponse.json()) as {
        runtimes?: RuntimeRecord[];
        detectedLocalRuntimes?: DetectedRuntimeRecord[];
      };
    }

    async function load() {
      setLoadingRuntimes(true);
      setError(null);
      try {
        const fastRuntimeJson = await fetchRuntimePayload(true);
        if (cancelled) return;
        applyRuntimePayload(fastRuntimeJson);
        setLoadingRuntimes(false);

        // Keep the picker fast and predictable. Full runtime probing can invoke
        // local CLIs and should happen on the Runtimes page, not while a user is
        // trying to create an agent or preview a voice.
      } catch (err) {
        if (!cancelled) {
          setRuntimeOptions([]);
          setError(err instanceof Error ? err.message : "unknown_error");
        }
      } finally {
        if (!cancelled) setLoadingRuntimes(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [companySlug]);

  const selectedRuntime = runtime
    ? runtimeOptions.find((option) => option.key === runtime.key) ?? null
    : null;
  const selectedRuntimeKey = selectedRuntime?.key ?? "";
  const selectedRuntimeProvider = selectedRuntime?.provider ?? "";
  const selectedRuntimeCommand = selectedRuntime?.command ?? "";
  const selectedRuntimeCommandPath = selectedRuntime?.commandPath ?? "";

  useEffect(() => {
    setModelQuery("");
    setModelMenuOpen(false);
  }, [selectedRuntimeKey]);

  useEffect(() => {
    if (loadingRuntimes || runtimeOptions.length === 0) return;
    if (selectedRuntime) return;
    onRuntimeChange(runtimeOptions[0]);
    onModelChange("");
  }, [loadingRuntimes, onModelChange, onRuntimeChange, runtimeOptions, selectedRuntime]);

  useEffect(() => {
    if (!selectedRuntimeKey) {
      setModels([]);
      setModelError(null);
      onModelChange("");
      return;
    }

    let cancelled = false;
    async function loadModels() {
      setLoadingModels(true);
      setModelError(null);
      setModels([]);
      try {
        const params = new URLSearchParams({ provider: selectedRuntimeProvider });
        if (selectedRuntimeCommand) params.set("command", selectedRuntimeCommand);
        if (selectedRuntimeCommandPath) params.set("commandPath", selectedRuntimeCommandPath);
        const response = await fetch(`/api/orchestration/runtime-models?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`models:${response.status}`);
        const json = (await response.json()) as { models?: RuntimeModelRecord[]; supported?: boolean };
        if (cancelled) return;
        setModels(buildModelOptions(json.models ?? []));
      } catch (err) {
        if (!cancelled) {
          setModels([]);
          setModelError(err instanceof Error ? err.message : "model_discovery_failed");
        }
      } finally {
        if (!cancelled) setLoadingModels(false);
      }
    }

    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [
    onModelChange,
    selectedRuntimeCommand,
    selectedRuntimeCommandPath,
    selectedRuntimeKey,
    selectedRuntimeProvider,
  ]);

  const selectedModel = models.find((option) => option.value === model);
  const defaultModel = models.find((option) => option.default) ?? models[0] ?? null;
  const modelRows = buildModelRows(models, defaultModel);
  const normalizedModelQuery = modelQuery.trim().toLowerCase();
  const filteredModelRows = normalizedModelQuery
    ? modelRows.filter((row) =>
        row.label.toLowerCase().includes(normalizedModelQuery) ||
        row.technicalId.toLowerCase().includes(normalizedModelQuery) ||
        row.provider.toLowerCase().includes(normalizedModelQuery)
      )
    : modelRows;
  const customModelValue =
    modelQuery.trim() && filteredModelRows.length === 0 ? modelQuery.trim() : "";
  const selectedModelLabel = selectedModel?.label
    ?? (model ? displayModelId(model) : defaultModel?.label ?? "Provider default");
  const selectedModelText = model ? selectedModelLabel : `Default — ${selectedModelLabel}`;
  const unavailableRuntimes = runtimeOptions.filter((option) => option.status !== "online");
  const availableRuntimes = runtimeOptions.filter((option) => option.status === "online");
  const visibleRuntimeGroups = unavailableRuntimes.length > 0
    ? [
        { label: "", options: availableRuntimes },
        { label: "Unavailable", options: unavailableRuntimes },
      ]
    : [{ label: "", options: runtimeOptions }];

  function selectRuntime(next: RuntimeOption | null) {
    onRuntimeChange(next);
    onModelChange("");
    setRuntimeMenuOpen(false);
  }

  function selectModel(next: string) {
    onModelChange(next);
    setModelQuery("");
    setModelMenuOpen(false);
  }

  function openModelMenu() {
    const rect = modelPickerRef.current?.getBoundingClientRect();
    if (rect) {
      const gap = 6;
      const chromeHeight = 58;
      const minListHeight = 180;
      const preferredListHeight = 326;
      const spaceBelow = window.innerHeight - rect.bottom - gap - 16;
      const spaceAbove = rect.top - gap - 16;
      const placement = spaceBelow >= minListHeight || spaceBelow >= spaceAbove ? "down" : "up";
      const available = placement === "down" ? spaceBelow : spaceAbove;
      setModelMenuPlacement(placement);
      setModelMenuListMaxHeight(Math.max(minListHeight, Math.min(preferredListHeight, available - chromeHeight)));
    }
    setRuntimeMenuOpen(false);
    setModelMenuOpen(true);
  }

  function groupedModelRows(rows: ModelRow[]): Array<{ provider: string; rows: ModelRow[] }> {
    const groups: Array<{ provider: string; rows: ModelRow[] }> = [];
    for (const row of rows) {
      const provider = providerSectionLabel(row.provider || selectedRuntime?.provider || "");
      const current = groups[groups.length - 1];
      if (current?.provider === provider) {
        current.rows.push(row);
      } else {
        groups.push({ provider, rows: [row] });
      }
    }
    return groups;
  }

  return (
    <div style={{ display: "grid", gap: "14px" }}>
      <div>
        <label style={labelStyle}>Runtime</label>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            data-testid="agent-runtime-picker"
            onClick={() => {
              setModelMenuOpen(false);
              setRuntimeMenuOpen((open) => !open);
            }}
            disabled={loadingRuntimes || runtimeOptions.length === 0}
            style={{
              width: "100%",
              minHeight: "46px",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              background: loadingRuntimes || runtimeOptions.length === 0
                ? "var(--surface-hover)"
                : "var(--surface)",
              padding: "9px 12px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              color: loadingRuntimes || runtimeOptions.length === 0 ? "var(--text-muted)" : "var(--text-primary)",
              fontSize: "13px",
              textAlign: "left",
              cursor: loadingRuntimes || runtimeOptions.length === 0 ? "not-allowed" : "pointer",
              outline: "none",
            }}
          >
            {selectedRuntime ? <RuntimeGlyph provider={selectedRuntime.provider} /> : null}
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {loadingRuntimes
                ? "Loading runtimes..."
                : selectedRuntime
                  ? selectedRuntime.displayName
                  : runtimeOptions.length === 0
                    ? "No runtimes available"
                    : runtimeOptions[0]?.displayName ?? "Runtime"}
            </span>
            <ChevronDown
              size={17}
              color="var(--text-muted)"
              style={{
                transform: runtimeMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                transformOrigin: "center",
                transition: "transform 120ms ease",
              }}
            />
          </button>

          {runtimeMenuOpen ? (
            <div
              data-testid="agent-runtime-menu"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "calc(100% + 6px)",
                zIndex: 50,
                borderRadius: "12px",
                border: "1px solid var(--border)",
                background: "var(--surface-elevated)",
                boxShadow: "var(--shadow-glass)",
                padding: "6px",
                maxHeight: "286px",
                overflowY: "auto",
              }}
            >
              {runtimeOptions.length === 0 ? (
                <div style={{ padding: "10px 12px", color: "var(--text-secondary)", fontSize: "13px" }}>
                  No runtimes available
                </div>
              ) : visibleRuntimeGroups.map((group) => (
                <div key={group.label || "available"}>
                  {group.label ? (
                    <div style={{ padding: "9px 10px 5px", color: "var(--text-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {group.label}
                    </div>
                  ) : null}
                  {group.options.map((option) => {
                    const selected = option.key === selectedRuntime?.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        data-testid="agent-runtime-option"
                        onClick={() => selectRuntime(option)}
                        style={{
                          width: "100%",
                          minHeight: "42px",
                          border: 0,
                          borderTop: "none",
                          borderBottom: "none",
                          borderRadius: "8px",
                          boxShadow: "none",
                          background: selected ? "var(--surface-hover)" : "transparent",
                          color: "var(--text-primary)",
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "8px 9px",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <RuntimeGlyph provider={option.provider} />
                        <span style={{ flex: 1, minWidth: 0, display: "grid", gap: "2px" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "13px", fontWeight: 600 }}>
                            {option.displayName}
                          </span>
                          {option.status !== "online" ? (
                            <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>{option.status}</span>
                          ) : null}
                        </span>
                        {selected ? <Check size={16} color="var(--accent)" strokeWidth={2.4} /> : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {error || (!loadingRuntimes && runtimeOptions.length === 0) || (selectedRuntime && selectedRuntime.status !== "online") ? (
          <div style={{ marginTop: "6px", fontSize: "11px", color: error ? "var(--negative)" : "var(--text-muted)" }}>
            {error
              ? `Runtime inventory unavailable (${error}).`
              : runtimeOptions.length === 0
                ? "No runtimes detected."
                : `${selectedRuntime?.displayName ?? "Runtime"} is ${selectedRuntime?.status ?? "unavailable"}.`}
          </div>
        ) : null}
      </div>

      {selectedRuntime ? (
        <div>
          <label style={labelStyle}>Model</label>
          <div ref={modelPickerRef} style={{ position: "relative" }}>
            <button
              type="button"
              data-testid="agent-model-picker"
              onClick={() => {
                if (modelMenuOpen) {
                  setModelMenuOpen(false);
                } else {
                  openModelMenu();
                }
              }}
              style={{
                width: "100%",
                minHeight: "46px",
                borderRadius: "10px",
                border: "1px solid var(--border)",
                background: "var(--surface)",
                padding: "9px 12px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                color: "var(--text-primary)",
                fontSize: "13px",
                textAlign: "left",
                cursor: "pointer",
                outline: "none",
              }}
            >
              <RuntimeGlyph provider={selectedModel?.provider ?? defaultModel?.provider ?? selectedRuntime.provider} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {loadingModels ? "Discovering models..." : selectedModelText}
              </span>
              <ChevronDown
                size={17}
                color="var(--text-muted)"
                style={{
                  transform: modelMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transformOrigin: "center",
                  transition: "transform 120ms ease",
                }}
              />
            </button>

            {modelMenuOpen ? (
              <div
                data-testid="agent-model-menu"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  ...(modelMenuPlacement === "up"
                    ? { bottom: "calc(100% + 6px)" }
                    : { top: "calc(100% + 6px)" }),
                  zIndex: 55,
                  borderRadius: "12px",
                  border: "1px solid var(--border)",
                  background: "var(--surface-elevated)",
                  boxShadow: "var(--shadow-glass)",
                  overflow: "hidden",
                }}
              >
                <div style={{ padding: "8px" }}>
                  <input
                    data-testid="agent-model-search"
                    value={modelQuery}
                    onChange={(event) => setModelQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && customModelValue) {
                        event.preventDefault();
                        selectModel(customModelValue);
                      }
                    }}
                    placeholder="Search or type a model ID"
                    style={{
                      width: "100%",
                      borderRadius: "10px",
                      border: "1px solid var(--border)",
                      background: "var(--surface)",
                      color: "var(--text-primary)",
                      outline: "none",
                      padding: "10px 12px",
                      fontSize: "13px",
                    }}
                    autoFocus
                  />
                </div>
                <div style={{ maxHeight: `${modelMenuListMaxHeight}px`, overflowY: "auto", padding: loadingModels ? "18px 16px" : "10px 6px 12px" }}>
                  {loadingModels ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--text-secondary)", fontSize: "13px" }}>
                      <span
                        style={{
                          width: "16px",
                          height: "16px",
                          borderRadius: "999px",
                          border: "2px solid var(--border)",
                          borderTopColor: "var(--text-secondary)",
                          display: "inline-block",
                        }}
                      />
                      Discovering models...
                    </div>
                  ) : customModelValue ? (
                    <button
                      type="button"
                      onClick={() => selectModel(customModelValue)}
                      style={{
                        width: "100%",
                        border: 0,
                        borderTop: "none",
                        borderBottom: "none",
                        borderRadius: "8px",
                        boxShadow: "none",
                        background: "transparent",
                        color: "var(--text-primary)",
                        display: "grid",
                        gap: "3px",
                        padding: "9px 12px",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ fontSize: "14px", fontWeight: 600 }}>{customModelValue}</span>
                      <span style={{ color: "var(--text-secondary)", fontSize: "12px" }}>Use custom model ID</span>
                    </button>
                  ) : filteredModelRows.length === 0 ? (
                    <div style={{ padding: "10px 12px", color: "var(--text-secondary)", fontSize: "13px" }}>
                      No matching models
                    </div>
                  ) : groupedModelRows(filteredModelRows).map((group) => (
                    <div key={group.provider}>
                      <div
                        style={{
                          padding: "8px 12px 7px",
                          color: "var(--text-secondary)",
                          fontSize: "11px",
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                        }}
                      >
                        {group.provider}
                      </div>
                      {group.rows.map((row) => {
                        const selected = row.value === model || (!model && row.value === "");
                        return (
                          <button
                            key={row.key}
                            type="button"
                            data-testid="agent-model-option"
                            onClick={() => selectModel(row.value)}
                            style={{
                              width: "100%",
                              border: 0,
                              borderTop: "none",
                              borderBottom: "none",
                              borderRadius: "8px",
                              boxShadow: "none",
                              background: "transparent",
                              color: "var(--text-primary)",
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              padding: "9px 10px 10px 12px",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <span style={{ flex: 1, minWidth: 0, display: "grid", gap: "3px" }}>
                              <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "14px", fontWeight: 650 }}>
                                  {row.label}
                                </span>
                                {row.default ? (
                                  <span
                                    style={{
                                      borderRadius: "5px",
                                      background: "var(--surface-hover)",
                                      color: "var(--text-secondary)",
                                      padding: "2px 6px",
                                      fontSize: "11px",
                                      lineHeight: 1.25,
                                      flex: "0 0 auto",
                                    }}
                                  >
                                    default
                                  </span>
                                ) : null}
                              </span>
                              {row.technicalId ? (
                                <span style={{ color: "var(--text-secondary)", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {row.technicalId}
                                </span>
                              ) : null}
                            </span>
                            {selected ? <span style={{ width: "16px", height: "16px" }} /> : null}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          {modelError ? (
            <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--negative)" }}>
              Model discovery failed ({modelError}); runtime default will be used.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
