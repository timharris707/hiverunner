"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  BookCopy,
  Link2,
  Plus,
  Save,
  Shield,
  Sparkles,
  Tag,
  Unlink,
  Wrench,
} from "lucide-react";

import { useAgentProfile, A } from "../layout";

type RuntimeEvidence = {
  status: "workspace_evidenced" | "not_proven" | "unavailable" | "provider_hidden";
  detail: string;
};

type DeclaredSkill = {
  rawValue: string;
  normalized: string;
  managed: boolean;
  matchKind: "id" | "name" | null;
  registryId: string | null;
  registryName: string | null;
  description: string | null;
  source: "workspace" | "system" | null;
  fileCount: number | null;
  location: string | null;
  workspaceOwners: string[];
  runtimeEvidence: RuntimeEvidence;
};

type LibrarySkill = {
  id: string;
  name: string;
  description: string;
  source: "workspace" | "system";
  location: string;
  fileCount: number;
  workspaceOwners: string[];
  declared: boolean;
  runtimeEvidence: RuntimeEvidence;
};

type SkillsPayload = {
  agent: {
    id: string;
    name: string;
    role: string;
    model: string | null;
    adapterType: string;
    openclawAgentId: string | null;
    paperclipAgentId: string | null;
    skills: string[];
    updatedAt: string;
  };
  providerModel: {
    providerId: string;
    providerName: string;
    summary: string;
    declarationNote: string;
    runtimeNote: string;
    evidenceNote: string;
  };
  stats: {
    declaredCount: number;
    libraryBackedCount: number;
    unmanagedCount: number;
    libraryAvailableCount: number;
  };
  declared: DeclaredSkill[];
  library: LibrarySkill[];
};

const UI = {
  sectionBg: "rgba(28,25,23,0.8)",
  sectionBorder: "rgba(255,255,255,0.08)",
  surface: "rgba(41,37,36,0.38)",
  surfaceStrong: "rgba(28,25,23,0.94)",
  surfaceBorder: "rgba(255,255,255,0.08)",
  divider: "rgba(255,255,255,0.07)",
  label: "#a8a29e",
  shadow: "0 18px 40px rgba(0,0,0,0.24)",
};

export default function AgentSkillsPage() {
  const { profile, slug, reload } = useAgentProfile();
  const { agent } = profile;

  const [data, setData] = useState<SkillsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [query, setQuery] = useState("");
  const [customSkill, setCustomSkill] = useState("");
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [actionLabel, setActionLabel] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agent.id)}/skills`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`${response.status}`);
      }
      const payload = (await response.json()) as SkillsPayload;
      setData(payload);
      setError(null);
    } catch (loadError) {
      setData(null);
      setError(loadError instanceof Error ? loadError.message : "unknown_error");
    } finally {
      setLoading(false);
    }
  }, [agent.id]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const declared = data?.declared ?? [];
  const library = data?.library ?? [];

  const matchesQuery = useCallback(
    (text: string) => !query.trim() || text.toLowerCase().includes(query.trim().toLowerCase()),
    [query],
  );

  const declaredLibrary = useMemo(
    () =>
      declared.filter(
        (entry) =>
          entry.managed &&
          matchesQuery(
            `${entry.rawValue} ${entry.registryId ?? ""} ${entry.registryName ?? ""} ${entry.description ?? ""}`,
          ),
      ),
    [declared, matchesQuery],
  );

  const declaredUnmanaged = useMemo(
    () =>
      declared.filter(
        (entry) =>
          !entry.managed &&
          matchesQuery(`${entry.rawValue} ${entry.description ?? ""}`),
      ),
    [declared, matchesQuery],
  );

  const availableLibrary = useMemo(
    () =>
      library.filter(
        (entry) =>
          !entry.declared &&
          matchesQuery(`${entry.id} ${entry.name} ${entry.description}`),
      ),
    [library, matchesQuery],
  );

  const selectedDeclared = useMemo(
    () => declared.find((entry) => `declared:${entry.normalized}` === selectedKey) ?? null,
    [declared, selectedKey],
  );

  const selectedLibrary = useMemo(
    () => library.find((entry) => `library:${entry.id.toLowerCase()}` === selectedKey) ?? null,
    [library, selectedKey],
  );

  useEffect(() => {
    const firstDeclared = declaredLibrary[0] ?? declaredUnmanaged[0] ?? null;
    const firstLibrary = availableLibrary[0] ?? library.find((entry) => entry.declared) ?? null;
    const nextKey =
      firstDeclared ? `declared:${firstDeclared.normalized}` :
      firstLibrary ? `library:${firstLibrary.id.toLowerCase()}` :
      "";
    if (!selectedKey || (!selectedDeclared && !selectedLibrary)) {
      setSelectedKey(nextKey);
    }
  }, [
    availableLibrary,
    declaredLibrary,
    declaredUnmanaged,
    library,
    selectedDeclared,
    selectedKey,
    selectedLibrary,
  ]);

  const linkedDeclaredForSelectedLibrary = useMemo(() => {
    if (!selectedLibrary) return null;
    return (
      declared.find(
        (entry) =>
          entry.registryId?.toLowerCase() === selectedLibrary.id.toLowerCase(),
      ) ?? null
    );
  }, [declared, selectedLibrary]);

  const persistSkills = useCallback(
    async (nextSkills: string[], successLabel: string) => {
      setMutating(true);
      setMutationError(null);
      setActionLabel(null);
      try {
        const response = await fetch(`/api/orchestration/agents/${encodeURIComponent(agent.id)}/skills`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skills: nextSkills }),
        });
        if (!response.ok) {
          throw new Error(`${response.status}`);
        }
        setActionLabel(successLabel);
        await loadSkills();
        reload();
      } catch (saveError) {
        setMutationError(saveError instanceof Error ? saveError.message : "unknown_error");
      } finally {
        setMutating(false);
      }
    },
    [agent.id, loadSkills, reload],
  );

  const attachLibrarySkill = useCallback(
    async (skillId: string) => {
      if (!data) return;
      await persistSkills([...data.agent.skills, skillId], `Attached ${skillId}`);
      setSelectedKey(`library:${skillId.toLowerCase()}`);
    },
    [data, persistSkills],
  );

  const detachDeclaredSkill = useCallback(
    async (rawValue: string) => {
      if (!data) return;
      await persistSkills(
        data.agent.skills.filter((value) => value.toLowerCase() !== rawValue.toLowerCase()),
        `Removed ${rawValue}`,
      );
    },
    [data, persistSkills],
  );

  const addCustomSkill = useCallback(async () => {
    if (!data) return;
    const trimmed = customSkill.trim();
    if (!trimmed) return;
    if (data.agent.skills.some((value) => value.toLowerCase() === trimmed.toLowerCase())) {
      setMutationError(`"${trimmed}" is already declared on this agent.`);
      return;
    }
    await persistSkills([...data.agent.skills, trimmed], `Added ${trimmed}`);
    setCustomSkill("");
    setSelectedKey(`declared:${trimmed.toLowerCase()}`);
  }, [customSkill, data, persistSkills]);

  const selectedView = useMemo(() => {
    if (selectedDeclared) {
      return { kind: "declared" as const, entry: selectedDeclared };
    }
    if (selectedLibrary) {
      return { kind: "library" as const, entry: selectedLibrary };
    }
    return null;
  }, [selectedDeclared, selectedLibrary]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1080, paddingBottom: 24 }}>
      <Section
        icon={<Wrench size={14} />}
        title="Skills Model"
        subtitle="Mission Control now separates declared skills, configured library skills, and runtime evidence instead of treating everything like raw tags."
      >
        {loading ? (
          <InlineStatus>Loading declared skills and library matches...</InlineStatus>
        ) : error ? (
          <InlineStatus tone="error">Could not load skills data ({error}).</InlineStatus>
        ) : data ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 14,
              }}
            >
              <SummaryCard
                eyebrow="Current provider"
                title={data.providerModel.providerName}
                subtitle={data.providerModel.summary}
                accent
              >
                <SummaryRow label="Provider ID" value={data.providerModel.providerId} mono />
                <SummaryRow label="Adapter" value={data.agent.adapterType} mono />
                <SummaryRow label="Model" value={data.agent.model || "-"} mono />
                <SummaryRow label="OpenClaw ID" value={data.agent.openclawAgentId || "-"} mono />
              </SummaryCard>

              <SummaryCard
                eyebrow="Declared today"
                title={`${data.stats.declaredCount} stored declaration${data.stats.declaredCount === 1 ? "" : "s"}`}
                subtitle="Mission Control can edit the stored declaration list for this agent, but it does not treat that alone as a runtime mount."
              >
                <SummaryRow label="Library-backed" value={String(data.stats.libraryBackedCount)} />
                <SummaryRow label="Unmanaged" value={String(data.stats.unmanagedCount)} />
                <SummaryRow label="Library available" value={String(data.stats.libraryAvailableCount)} />
              </SummaryCard>

              <SummaryCard
                eyebrow="Runtime truth"
                title="What Mission Control can prove"
                subtitle="Provider-aware framing for stored declarations versus runtime evidence."
              >
                <PathNote title="Stored declaration">
                  {data.providerModel.declarationNote}
                </PathNote>
                <PathNote title="Runtime handling">
                  {data.providerModel.runtimeNote}
                </PathNote>
                <PathNote title="Evidence limits">
                  {data.providerModel.evidenceNote}
                </PathNote>
              </SummaryCard>
            </div>

            <div style={{ ...noteStyle, marginTop: 14 }}>
              Library-backed entries are the ones Mission Control can map to the configured skills registry. Unmanaged entries stay visible because agents already use freeform capability tags today, and hiding that would be dishonest.
            </div>
          </>
        ) : null}
      </Section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "300px minmax(0, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <Section
          icon={<BookCopy size={14} />}
          title="Skill Sets"
          subtitle="Declared, unmanaged, and library-available skills for this agent."
        >
          <div style={{ position: "relative", marginBottom: 14 }}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter skills"
              style={inputStyle}
            />
          </div>

          <SourceGroup title="Declared and library-backed">
            {declaredLibrary.length > 0 ? (
              declaredLibrary.map((entry) => (
                <SkillButton
                  key={`declared:${entry.normalized}`}
                  title={entry.registryName || entry.rawValue}
                  subtitle={entry.description || "Matched to the configured company skill library."}
                  active={selectedKey === `declared:${entry.normalized}`}
                  onClick={() => setSelectedKey(`declared:${entry.normalized}`)}
                  badges={[
                    { label: "Library-backed" },
                    { label: entry.source === "workspace" ? "Workspace library" : "System library" },
                    { label: runtimeLabel(entry.runtimeEvidence.status), tone: runtimeTone(entry.runtimeEvidence.status) },
                  ]}
                />
              ))
            ) : (
              <EmptyMiniState>No declared skills currently map to the configured library.</EmptyMiniState>
            )}
          </SourceGroup>

          <SourceGroup title="Declared but unmanaged">
            {declaredUnmanaged.length > 0 ? (
              declaredUnmanaged.map((entry) => (
                <SkillButton
                  key={`declared:${entry.normalized}`}
                  title={entry.rawValue}
                  subtitle="Stored on the agent profile only. No library entry matched this declaration."
                  active={selectedKey === `declared:${entry.normalized}`}
                  onClick={() => setSelectedKey(`declared:${entry.normalized}`)}
                  badges={[
                    { label: "Unmanaged" },
                    { label: runtimeLabel(entry.runtimeEvidence.status), tone: runtimeTone(entry.runtimeEvidence.status) },
                  ]}
                />
              ))
            ) : (
              <EmptyMiniState>No unmanaged declarations.</EmptyMiniState>
            )}
          </SourceGroup>

          <SourceGroup title="Available from library">
            {availableLibrary.length > 0 ? (
              availableLibrary.map((entry) => (
                <SkillButton
                  key={`library:${entry.id.toLowerCase()}`}
                  title={entry.name}
                  subtitle={entry.description}
                  active={selectedKey === `library:${entry.id.toLowerCase()}`}
                  onClick={() => setSelectedKey(`library:${entry.id.toLowerCase()}`)}
                  badges={[
                    { label: entry.source === "workspace" ? "Workspace library" : "System library" },
                    { label: runtimeLabel(entry.runtimeEvidence.status), tone: runtimeTone(entry.runtimeEvidence.status) },
                  ]}
                />
              ))
            ) : (
              <EmptyMiniState>No additional configured library skills match this filter.</EmptyMiniState>
            )}
          </SourceGroup>
        </Section>

        <Section
          icon={selectedView?.kind === "library" ? <Link2 size={14} /> : <Tag size={14} />}
          title={
            selectedView?.kind === "library"
              ? selectedView.entry.name
              : selectedView?.entry.rawValue || "Skill detail"
          }
          subtitle={
            selectedView?.kind === "library"
              ? "Configured company library entry"
              : selectedView?.kind === "declared"
                ? selectedView.entry.managed
                  ? "Declared skill that maps to the configured company library."
                  : "Stored agent declaration with no current library match."
                : "Select a skill or declaration to inspect."
          }
        >
          {selectedView ? (
            selectedView.kind === "declared" ? (
              <DeclaredSkillDetail
                entry={selectedView.entry}
                slug={slug}
                mutating={mutating}
                onRemove={() => void detachDeclaredSkill(selectedView.entry.rawValue)}
              />
            ) : (
              <LibrarySkillDetail
                entry={selectedView.entry}
                slug={slug}
                mutating={mutating}
                declaredEntry={linkedDeclaredForSelectedLibrary}
                onAttach={() => void attachLibrarySkill(selectedView.entry.id)}
                onDetach={
                  linkedDeclaredForSelectedLibrary
                    ? () => void detachDeclaredSkill(linkedDeclaredForSelectedLibrary.rawValue)
                    : undefined
                }
              />
            )
          ) : (
            <EmptySourceState>Select a declaration or library entry to inspect.</EmptySourceState>
          )}

          {mutationError ? (
            <InlineStatus tone="error">Could not update agent skills ({mutationError}).</InlineStatus>
          ) : actionLabel ? (
            <InlineStatus>{actionLabel}</InlineStatus>
          ) : null}
        </Section>
      </div>

      <Section
        icon={<Sparkles size={14} />}
        title="Add Custom Declaration"
        subtitle="Use this when no configured library skill exists yet. These values stay explicit as unmanaged until a real library entry matches them."
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            value={customSkill}
            onChange={(event) => setCustomSkill(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addCustomSkill();
              }
            }}
            placeholder="Add custom capability or routing tag"
            style={inputStyle}
          />
          <button
            type="button"
            onClick={() => void addCustomSkill()}
            disabled={mutating || !customSkill.trim()}
            style={{
              ...primaryButtonStyle,
              opacity: mutating || !customSkill.trim() ? 0.6 : 1,
              cursor: mutating || !customSkill.trim() ? "not-allowed" : "pointer",
            }}
          >
            <Plus size={12} />
            {mutating ? "Saving..." : "Add declaration"}
          </button>
        </div>
        <div style={{ ...noteStyle, marginTop: 12 }}>
          Prefer attaching a library-backed skill when one exists. Custom declarations remain useful for staffing and routing, but Mission Control does not present them as managed runtime mounts.
        </div>
      </Section>
    </div>
  );
}

function DeclaredSkillDetail({
  entry,
  slug,
  mutating,
  onRemove,
}: {
  entry: DeclaredSkill;
  slug: string;
  mutating: boolean;
  onRemove: () => void;
}) {
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <Pill>{entry.managed ? "Library-backed" : "Unmanaged"}</Pill>
        {entry.source ? (
          <Pill>{entry.source === "workspace" ? "Workspace library" : "System library"}</Pill>
        ) : null}
        <RuntimePill evidence={entry.runtimeEvidence} />
      </div>

      <MetaGrid>
        <MetaRow label="Stored value" value={entry.rawValue} mono />
        <MetaRow label="Registry ID" value={entry.registryId || "-"} mono />
        <MetaRow label="Match type" value={entry.matchKind || "-"} />
        <MetaRow label="Files" value={entry.fileCount != null ? String(entry.fileCount) : "-"} />
      </MetaGrid>

      <div style={{ ...noteStyle, marginTop: 12 }}>
        {entry.managed
          ? entry.description || "This declaration maps cleanly to a configured company library skill."
          : "Mission Control stores this value on the agent profile, but it does not currently map to a configured skill library entry."}
      </div>

      <PathNote title="Runtime evidence" style={{ marginTop: 12 }}>
        {entry.runtimeEvidence.detail}
      </PathNote>

      {entry.location ? (
        <PathNote title="Library location" style={{ marginTop: 12 }}>
          <span style={{ fontFamily: "monospace", wordBreak: "break-word" }}>{entry.location}</span>
        </PathNote>
      ) : null}

      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        {entry.registryId ? (
          <Link
            href={`/companies/${encodeURIComponent(slug)}/skills/${encodeURIComponent(entry.registryId)}`}
            style={linkButtonStyle}
          >
            <BookCopy size={12} />
            View library skill
          </Link>
        ) : null}
        <button
          type="button"
          onClick={onRemove}
          disabled={mutating}
          style={{
            ...secondaryButtonStyle,
            opacity: mutating ? 0.6 : 1,
            cursor: mutating ? "wait" : "pointer",
          }}
        >
          <Unlink size={12} />
          {entry.managed ? "Detach declaration" : "Remove declaration"}
        </button>
      </div>
    </>
  );
}

function LibrarySkillDetail({
  entry,
  slug,
  mutating,
  declaredEntry,
  onAttach,
  onDetach,
}: {
  entry: LibrarySkill;
  slug: string;
  mutating: boolean;
  declaredEntry: DeclaredSkill | null;
  onAttach: () => void;
  onDetach?: () => void;
}) {
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <Pill>{entry.source === "workspace" ? "Workspace library" : "System library"}</Pill>
        <Pill>{entry.declared ? "Declared on agent" : "Not declared on agent"}</Pill>
        <RuntimePill evidence={entry.runtimeEvidence} />
      </div>

      <MetaGrid>
        <MetaRow label="Skill ID" value={entry.id} mono />
        <MetaRow label="Files" value={String(entry.fileCount)} />
        <MetaRow label="Workspace evidence" value={entry.workspaceOwners.length > 0 ? entry.workspaceOwners.join(", ") : "-"} mono />
        <MetaRow label="Source" value={entry.source} />
      </MetaGrid>

      <div style={{ ...noteStyle, marginTop: 12 }}>{entry.description}</div>

      <PathNote title="Runtime evidence" style={{ marginTop: 12 }}>
        {entry.runtimeEvidence.detail}
      </PathNote>

      <PathNote title="Library location" style={{ marginTop: 12 }}>
        <span style={{ fontFamily: "monospace", wordBreak: "break-word" }}>{entry.location}</span>
      </PathNote>

      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        <Link
          href={`/companies/${encodeURIComponent(slug)}/skills/${encodeURIComponent(entry.id)}`}
          style={linkButtonStyle}
        >
          <BookCopy size={12} />
          View library skill
        </Link>
        {entry.declared && declaredEntry && onDetach ? (
          <button
            type="button"
            onClick={onDetach}
            disabled={mutating}
            style={{
              ...secondaryButtonStyle,
              opacity: mutating ? 0.6 : 1,
              cursor: mutating ? "wait" : "pointer",
            }}
          >
            <Unlink size={12} />
            Detach declaration
          </button>
        ) : (
          <button
            type="button"
            onClick={onAttach}
            disabled={mutating}
            style={{
              ...primaryButtonStyle,
              opacity: mutating ? 0.6 : 1,
              cursor: mutating ? "wait" : "pointer",
            }}
          >
            <Link2 size={12} />
            Attach declaration
          </button>
        )}
      </div>
    </>
  );
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        padding: "20px 22px",
        borderRadius: 18,
        background: UI.sectionBg,
        border: `0.5px solid ${UI.sectionBorder}`,
        boxShadow: UI.shadow,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            display: "grid",
            placeItems: "center",
            color: A.accentLight,
            background: "rgba(255,255,255,0.04)",
            border: `0.5px solid ${UI.surfaceBorder}`,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600, color: A.text }}>{title}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: A.muted, lineHeight: 1.6 }}>{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function SummaryCard({
  eyebrow,
  title,
  subtitle,
  accent,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        padding: "18px 18px 16px",
        borderRadius: 16,
        background: accent ? "rgba(28,25,23,0.94)" : UI.surface,
        border: `0.5px solid ${accent ? "rgba(245,158,11,0.18)" : UI.surfaceBorder}`,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: UI.label }}>
        {eyebrow}
      </div>
      <div style={{ marginTop: 6, fontSize: 18, fontWeight: 600, color: A.text }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: A.textSec, lineHeight: 1.6 }}>{subtitle}</div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "112px minmax(0, 1fr)",
        gap: 10,
        alignItems: "start",
      }}
    >
      <span style={{ fontSize: 11, color: UI.label, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          color: A.text,
          lineHeight: 1.55,
          fontFamily: mono ? "monospace" : "inherit",
          wordBreak: "break-word",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SourceGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
      <div style={{ fontSize: 11, color: UI.label, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function SkillButton({
  title,
  subtitle,
  badges,
  active,
  onClick,
}: {
  title: string;
  subtitle: string;
  badges: Array<{ label: string; tone?: "default" | "good" | "muted" | "warn" }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "12px 13px",
        borderRadius: 14,
        border: `0.5px solid ${active ? "rgba(245,158,11,0.22)" : UI.surfaceBorder}`,
        background: active ? "rgba(245,158,11,0.08)" : UI.surface,
        cursor: "pointer",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: A.text }}>{title}</div>
      <div style={{ fontSize: 11, color: A.muted, lineHeight: 1.55, marginTop: 5 }}>
        {truncateText(subtitle, 150)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {badges.map((badge) => (
          <Pill key={badge.label} tone={badge.tone}>{badge.label}</Pill>
        ))}
      </div>
    </button>
  );
}

function Pill({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "good" | "muted" | "warn";
}) {
  const styles =
    tone === "good"
      ? { background: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.24)", color: "#86efac" }
      : tone === "warn"
        ? { background: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.24)", color: "#fdba74" }
        : tone === "muted"
          ? { background: "rgba(120,113,108,0.12)", border: "rgba(120,113,108,0.18)", color: A.muted }
          : { background: "rgba(255,255,255,0.04)", border: UI.surfaceBorder, color: A.textSec };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 8px",
        borderRadius: 999,
        background: styles.background,
        border: `0.5px solid ${styles.border}`,
        color: styles.color,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

function RuntimePill({ evidence }: { evidence: RuntimeEvidence }) {
  return <Pill tone={runtimeTone(evidence.status)}>{runtimeLabel(evidence.status)}</Pill>;
}

function MetaGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 10,
      }}
    >
      {children}
    </div>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        padding: "12px 13px",
        borderRadius: 12,
        border: `0.5px solid ${UI.divider}`,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ fontSize: 11, color: UI.label, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          color: A.text,
          lineHeight: 1.55,
          fontFamily: mono ? "monospace" : "inherit",
          wordBreak: "break-word",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function PathNote({
  title,
  children,
  style,
}: {
  title: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        padding: "12px 13px",
        borderRadius: 12,
        border: `0.5px solid ${UI.divider}`,
        background: "rgba(255,255,255,0.02)",
        ...style,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: A.text, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: A.textSec, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

function EmptyMiniState({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "12px 13px",
        borderRadius: 12,
        border: `1px dashed ${UI.surfaceBorder}`,
        background: "rgba(255,255,255,0.02)",
        fontSize: 12,
        color: A.muted,
      }}
    >
      {children}
    </div>
  );
}

function EmptySourceState({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "24px 18px",
        borderRadius: 14,
        border: `1px dashed ${UI.surfaceBorder}`,
        background: "rgba(255,255,255,0.02)",
        fontSize: 13,
        color: A.muted,
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

function InlineStatus({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      style={{
        fontSize: 12,
        color: tone === "error" ? "#fca5a5" : A.muted,
        lineHeight: 1.6,
        marginTop: 12,
      }}
    >
      {children}
    </div>
  );
}

function runtimeTone(status: RuntimeEvidence["status"]): "good" | "warn" | "muted" | "default" {
  if (status === "workspace_evidenced") return "good";
  if (status === "not_proven") return "warn";
  if (status === "unavailable") return "muted";
  return "default";
}

function runtimeLabel(status: RuntimeEvidence["status"]): string {
  if (status === "workspace_evidenced") return "Workspace evidenced";
  if (status === "not_proven") return "Not proven";
  if (status === "unavailable") return "Unavailable";
  return "Provider hidden";
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

const noteStyle: CSSProperties = {
  fontSize: 12,
  color: A.muted,
  lineHeight: 1.65,
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: 40,
  padding: "0 12px",
  borderRadius: 10,
  background: UI.surfaceStrong,
  border: `0.5px solid ${UI.surfaceBorder}`,
  color: A.text,
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
};

const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 38,
  padding: "0 13px",
  borderRadius: 10,
  border: "0.5px solid rgba(245,158,11,0.22)",
  background: "rgba(245,158,11,0.12)",
  color: A.accentLight,
  fontSize: 12,
  fontWeight: 600,
};

const secondaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 38,
  padding: "0 13px",
  borderRadius: 10,
  border: `0.5px solid ${UI.surfaceBorder}`,
  background: UI.surface,
  color: A.textSec,
  fontSize: 12,
  fontWeight: 600,
};

const linkButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  minHeight: 38,
  padding: "0 13px",
  borderRadius: 10,
  border: `0.5px solid ${UI.surfaceBorder}`,
  background: UI.surface,
  color: A.text,
  fontSize: 12,
  fontWeight: 600,
  textDecoration: "none",
};
