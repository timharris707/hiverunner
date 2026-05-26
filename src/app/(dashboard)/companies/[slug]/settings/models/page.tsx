"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { CSSProperties } from "react";
import { ArrowLeft, Plus, Settings } from "lucide-react";

import {
  createAvailableModel,
  deleteAvailableModel,
  listAvailableModelRefreshStatuses,
  listAvailableModels,
  listCompanies,
  listCompanyModelSources,
  refreshAvailableModelsFromRuntimes,
  updateAvailableModel,
} from "@/lib/orchestration/client";
import type {
  AvailableModel,
  AvailableModelCapability,
  AvailableModelRefreshStatus,
  AvailableModelProvider,
} from "@/lib/orchestration/available-models";
import {
  AVAILABLE_MODEL_CAPABILITIES,
  AVAILABLE_MODEL_PROVIDERS,
} from "@/lib/orchestration/available-models";
import type { ModelSourceInventoryItem, ModelSourceProbeResult } from "@/lib/orchestration/execution-hives";
import { SEEDED_MODEL_SOURCES } from "@/lib/orchestration/execution-hives";
import type { OrchestrationCompany } from "@/lib/orchestration/types";
import { buildCanonicalCompanyPath } from "@/lib/orchestration/route-paths";
import { color, font, pageStyle, radius, space, type as T } from "@/lib/ui/tokens";
import { ActionButton, Badge, PageHeader, Section } from "@/lib/ui/primitives";

type ModelSourceProbeMap = Partial<Record<ModelSourceInventoryItem["id"], ModelSourceProbeResult>>;

type AvailableModelFormState = {
  id: string;
  displayName: string;
  runtimeProvider: AvailableModelProvider;
  defaultRuntimeLabel: string;
  modelSourceId: string;
  capabilities: AvailableModelCapability[];
  contextWindow: string;
  description: string;
};

function fieldLabelStyle(): CSSProperties {
  return {
    color: color.textMuted,
    fontSize: T.caption.size,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  };
}

function inputStyle(): CSSProperties {
  return {
    minHeight: 38,
    borderRadius: radius.md,
    border: `0.5px solid ${color.border}`,
    background: color.surface,
    color: color.text,
    padding: `0 ${space.sm}px`,
    fontSize: T.bodySmall.size,
    outline: "none",
  };
}

function chipStyle(active = false): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
    borderRadius: radius.full,
    border: `0.5px solid ${active ? color.borderStrong : color.border}`,
    background: active ? color.accentSoft : color.surface,
    color: active ? color.accent : color.textSecondary,
    padding: `0 ${space.md}px`,
    fontSize: T.caption.size,
    fontWeight: 650,
    cursor: "pointer",
  };
}

function modelFormState(model: AvailableModel | null, modelSources: ModelSourceInventoryItem[]): AvailableModelFormState {
  return {
    id: model?.id ?? "",
    displayName: model?.displayName ?? "",
    runtimeProvider: model?.runtimeProvider ?? "openai",
    defaultRuntimeLabel: model?.defaultRuntimeLabel ?? "Codex",
    modelSourceId: model?.modelSourceId ?? modelSources[0]?.id ?? "openai",
    capabilities: model?.capabilities ?? ["text"],
    contextWindow: model?.contextWindow ? String(model.contextWindow) : "",
    description: model?.description ?? "",
  };
}

function ModelForm({
  model,
  modelSources,
  onClose,
  onSaved,
}: {
  model: AvailableModel | null;
  modelSources: ModelSourceInventoryItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<AvailableModelFormState>(() => modelFormState(model, modelSources));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const editing = Boolean(model);

  useEffect(() => {
    setForm(modelFormState(model, modelSources));
    setMessage(null);
  }, [model, modelSources]);

  function toggleCapability(capability: AvailableModelCapability) {
    setForm((current) => ({
      ...current,
      capabilities: current.capabilities.includes(capability)
        ? current.capabilities.filter((item) => item !== capability)
        : [...current.capabilities, capability],
    }));
  }

  async function save() {
    if (saving || !form.id.trim() || !form.displayName.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        displayName: form.displayName.trim(),
        defaultRuntimeLabel: form.defaultRuntimeLabel.trim(),
        modelSourceId: form.modelSourceId,
        capabilities: form.capabilities,
        contextWindow: form.contextWindow.trim() ? Number(form.contextWindow) : null,
        description: form.description.trim() || null,
      };
      const result = editing && model
        ? await updateAvailableModel(model.id, payload)
        : await createAvailableModel({
            id: form.id.trim(),
            runtimeProvider: form.runtimeProvider,
            ...payload,
          });
      if (!result) {
        setMessage("Model could not be saved.");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: space.lg, borderRadius: radius.lg, border: `0.5px solid ${color.border}`, background: color.surface, display: "grid", gap: space.md }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
        <div>
          <div style={{ color: color.text, fontWeight: 750 }}>{editing ? `Edit ${model?.displayName}` : "Add model"}</div>
          <div style={{ color: color.textMuted, fontSize: T.caption.size }}>Models added here become available in every Hives lane editor.</div>
        </div>
        <ActionButton label="Close" size="sm" variant="ghost" onClick={onClose} disabled={saving} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: space.md }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={fieldLabelStyle()}>Model ID</span>
          <input value={form.id} onChange={(event) => setForm((current) => ({ ...current, id: event.target.value }))} disabled={editing} style={inputStyle()} placeholder="claude-opus-4-8" />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={fieldLabelStyle()}>Display name</span>
          <input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} style={inputStyle()} placeholder="Claude Opus 4.8" />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={fieldLabelStyle()}>Provider</span>
          <select value={form.runtimeProvider} onChange={(event) => setForm((current) => ({ ...current, runtimeProvider: event.target.value as AvailableModelProvider }))} disabled={editing} style={inputStyle()}>
            {AVAILABLE_MODEL_PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={fieldLabelStyle()}>Runtime label</span>
          <input value={form.defaultRuntimeLabel} onChange={(event) => setForm((current) => ({ ...current, defaultRuntimeLabel: event.target.value }))} style={inputStyle()} placeholder="Claude Code" />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={fieldLabelStyle()}>Model source</span>
          <select value={form.modelSourceId} onChange={(event) => setForm((current) => ({ ...current, modelSourceId: event.target.value }))} style={inputStyle()}>
            {modelSources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={fieldLabelStyle()}>Context window</span>
          <input value={form.contextWindow} onChange={(event) => setForm((current) => ({ ...current, contextWindow: event.target.value.replace(/[^0-9]/g, "") }))} style={inputStyle()} placeholder="optional" />
        </label>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: space.xs }}>
        {AVAILABLE_MODEL_CAPABILITIES.map((capability) => {
          const active = form.capabilities.includes(capability);
          return (
            <button key={capability} type="button" onClick={() => toggleCapability(capability)} style={chipStyle(active)}>
              {capability}
            </button>
          );
        })}
      </div>
      <label style={{ display: "grid", gap: 6 }}>
        <span style={fieldLabelStyle()}>Description</span>
        <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} style={{ ...inputStyle(), minHeight: 86, paddingTop: space.sm, resize: "vertical" }} placeholder="Optional notes for operators" />
      </label>
      {message ? <div style={{ color: color.warning, fontSize: T.bodySmall.size }}>{message}</div> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: space.sm }}>
        <ActionButton label="Cancel" size="sm" variant="ghost" onClick={onClose} disabled={saving} />
        <ActionButton label={saving ? "Saving..." : editing ? "Save model" : "Add model"} size="sm" onClick={save} disabled={saving || !form.id.trim() || !form.displayName.trim()} />
      </div>
    </div>
  );
}

function ModelCatalog({
  models,
  modelSourceProbes,
  onEdit,
  onRemoved,
}: {
  models: AvailableModel[];
  modelSourceProbes: ModelSourceProbeMap;
  onEdit: (model: AvailableModel) => void;
  onRemoved: () => void;
}) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function remove(model: AvailableModel) {
    setRemovingId(model.id);
    setMessage(null);
    try {
      const result = await deleteAvailableModel(model.id);
      if (!result) {
        setMessage("Model could not be removed. It may be in use by an active lane.");
        return;
      }
      onRemoved();
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: space.sm }}>
      {message ? <div style={{ color: color.warning, fontSize: T.bodySmall.size }}>{message}</div> : null}
      <div style={{ overflow: "hidden", borderRadius: radius.lg, border: `0.5px solid ${color.border}`, background: color.surface }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1.25fr) 130px 150px minmax(180px, 1fr) auto", gap: space.md, padding: space.md, borderBottom: `0.5px solid ${color.border}`, color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          <span>Model</span>
          <span>Provider</span>
          <span>Source</span>
          <span>Capabilities</span>
          <span>Actions</span>
        </div>
        {models.map((model) => {
          const configured = modelSourceProbes[model.modelSourceId]?.status === "pass";
          return (
            <div key={model.id} style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1.25fr) 130px 150px minmax(180px, 1fr) auto", gap: space.md, alignItems: "center", padding: space.md, borderBottom: `0.5px solid ${color.border}` }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: color.text, fontWeight: 750 }}>{model.displayName}</div>
                <div style={{ color: color.textMuted, fontSize: T.caption.size, fontFamily: font.mono, overflow: "hidden", textOverflow: "ellipsis" }}>{model.id}</div>
              </div>
              <Badge label={model.runtimeProvider} tone="default" />
              <span style={{ color: configured ? color.positive : color.textMuted, fontSize: T.caption.size, fontFamily: font.mono }}>{model.modelSourceId}</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {model.capabilities.map((capability) => <Badge key={capability} label={capability} tone="default" />)}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: space.xs }}>
                <ActionButton label="Edit" size="sm" variant="ghost" onClick={() => onEdit(model)} />
                <ActionButton label={removingId === model.id ? "Removing..." : "Remove"} size="sm" variant="ghost" onClick={() => remove(model)} disabled={removingId === model.id} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CompanyModelSettingsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";
  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [modelSources, setModelSources] = useState<ModelSourceInventoryItem[]>(SEEDED_MODEL_SOURCES);
  const [editingModel, setEditingModel] = useState<AvailableModel | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatuses, setRefreshStatuses] = useState<AvailableModelRefreshStatus[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const companyCode = company?.code ?? slug;
  const hivesPath = buildCanonicalCompanyPath(companyCode, "/hives");
  const modelSourceProbes = useMemo<ModelSourceProbeMap>(() => ({}), []);

  const refreshModels = useCallback(async () => {
    const [loadedModels, statuses] = await Promise.all([
      listAvailableModels({ includeInactive: true }),
      listAvailableModelRefreshStatuses().catch(() => []),
    ]);
    setModels(loadedModels);
    setRefreshStatuses(statuses);
  }, []);

  const refreshFromRuntimes = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setNotice(null);
    try {
      const statuses = await refreshAvailableModelsFromRuntimes();
      setRefreshStatuses(statuses);
      setModels(await listAvailableModels({ includeInactive: true }));
      const refreshed = statuses.filter((status) => status.status === "refreshed").length;
      setNotice(refreshed > 0 ? `Runtime catalog refreshed from ${refreshed} provider(s).` : "Runtime catalog refresh completed with fallbacks or skipped providers.");
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [companies, sources, loadedModels, statuses] = await Promise.all([
          listCompanies(),
          listCompanyModelSources(slug).catch(() => SEEDED_MODEL_SOURCES),
          listAvailableModels({ includeInactive: true }),
          listAvailableModelRefreshStatuses().catch(() => []),
        ]);
        if (cancelled) return;
        const normalized = slug.toLowerCase();
        setCompany(companies.find((candidate) => candidate.slug.toLowerCase() === normalized || candidate.code.toLowerCase() === normalized) ?? null);
        setModelSources(sources.length ? sources : SEEDED_MODEL_SOURCES);
        setModels(loadedModels);
        setRefreshStatuses(statuses);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [slug]);

  return (
    <div style={{ ...pageStyle, maxWidth: 1220 }}>
      <PageHeader
        icon={<Settings size={18} />}
        title="Model Catalog"
        description={`${company?.name ?? (slug || "Company")} · models available for Execution Hive lanes.`}
        actions={(
          <div style={{ display: "flex", gap: space.sm }}>
            <a href={hivesPath} style={{ ...chipStyle(false), textDecoration: "none" }}>
              <ArrowLeft size={13} />
              Hives
            </a>
            <ActionButton
              label={refreshing ? "Refreshing..." : "Refresh from runtimes"}
              size="sm"
              variant="ghost"
              onClick={refreshFromRuntimes}
              disabled={refreshing}
            />
            <ActionButton
              label="Add Model"
              icon={<Plus size={14} />}
              size="sm"
              onClick={() => {
                setEditingModel(null);
                setFormOpen(true);
              }}
            />
          </div>
        )}
      />

      {notice ? (
        <div style={{ marginBottom: space.lg, padding: space.md, borderRadius: radius.md, border: `0.5px solid ${color.border}`, background: color.surface, color: color.textSecondary, fontSize: T.bodySmall.size }}>
          {notice}
        </div>
      ) : null}

      <Section title="Available Models" trailing={<span>{loading ? "Loading" : `${models.length} models`}</span>}>
        {refreshStatuses.length ? (
          <div style={{ marginBottom: space.lg, display: "flex", flexWrap: "wrap", gap: space.xs }}>
            {refreshStatuses.map((status) => (
              <span key={status.provider} style={{ ...chipStyle(false), cursor: "default" }} title={status.message ?? undefined}>
                {status.provider}: {status.status} · {status.modelCount} · {new Date(status.refreshedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </span>
            ))}
          </div>
        ) : null}
        {formOpen ? (
          <div style={{ marginBottom: space.lg }}>
            <ModelForm
              model={editingModel}
              modelSources={modelSources}
              onClose={() => {
                setFormOpen(false);
                setEditingModel(null);
              }}
              onSaved={() => {
                setFormOpen(false);
                setEditingModel(null);
                setNotice("Model catalog updated.");
                void refreshModels();
              }}
            />
          </div>
        ) : null}
        <ModelCatalog
          models={models}
          modelSourceProbes={modelSourceProbes}
          onEdit={(model) => {
            setEditingModel(model);
            setFormOpen(true);
          }}
          onRemoved={() => {
            setNotice("Model removed from active catalog.");
            void refreshModels();
          }}
        />
      </Section>
    </div>
  );
}
