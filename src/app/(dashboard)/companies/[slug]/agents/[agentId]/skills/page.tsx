"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  BookCopy,
  Link2,
  Tag,
  Unlink,
} from "lucide-react";

import { useAgentProfile, A } from "../agent-context";

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
  source: "workspace" | "system" | "company" | null;
  fileCount: number | null;
  location: string | null;
  workspaceOwners: string[];
  runtimeEvidence: RuntimeEvidence;
};

type LibrarySkill = {
  id: string;
  name: string;
  description: string;
  source: "workspace" | "system" | "company";
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
  sectionBg: "var(--surface)",
  sectionBorder: "var(--border)",
  surface: "var(--surface-elevated)",
  surfaceStrong: "var(--surface)",
  surfaceBorder: "var(--border)",
  divider: "var(--border)",
  label: "var(--text-muted)",
  shadow: "var(--shadow-glass)",
};

function skillSourceLabel(source: "workspace" | "system" | "company" | null): string {
  if (source === "workspace") return "Workspace library";
  if (source === "company") return "Company skill";
  return "System library";
}

export default function AgentSkillsPage() {
  const { profile, companyCode, reload } = useAgentProfile();
  const { agent } = profile;

  const [data, setData] = useState<SkillsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [query, setQuery] = useState("");
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

  const declared = useMemo(() => data?.declared ?? [], [data?.declared]);
  const library = useMemo(() => data?.library ?? [], [data?.library]);

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
      <style jsx global>{`
        .agent-skills-scroll {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .agent-skills-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <Section
        icon={<BookCopy size={14} />}
        title={`${agent.name} Skills`}
        subtitle="Skills assigned to this agent and the company library skills available to attach."
      >
        {loading ? (
          <InlineStatus>Loading skills...</InlineStatus>
        ) : error ? (
          <InlineStatus tone="error">Could not load skills data ({error}).</InlineStatus>
        ) : data ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Pill>{data.stats.declaredCount} assigned</Pill>
            <Pill>{data.stats.libraryBackedCount} library skills</Pill>
            <Pill>{data.stats.unmanagedCount} custom</Pill>
            <Pill tone="muted">{data.stats.libraryAvailableCount} available to add</Pill>
          </div>
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
          title="Skills"
          subtitle="Search, view, attach, or remove skills for this agent."
        >
          <div style={{ position: "relative", marginBottom: 14 }}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter skills"
              style={inputStyle}
            />
          </div>

          <div
            className="agent-skills-scroll"
            style={{
              maxHeight: "min(68vh, 720px)",
              overflowY: "auto",
              paddingRight: 2,
            }}
          >
            <SourceGroup title="Assigned library skills">
              {declaredLibrary.length > 0 ? (
                declaredLibrary.map((entry) => (
                  <SkillButton
                    key={`declared:${entry.normalized}`}
                    title={entry.registryName || entry.rawValue}
                    subtitle={entry.description || "Matched to the configured company skill library."}
                    active={selectedKey === `declared:${entry.normalized}`}
                    onClick={() => setSelectedKey(`declared:${entry.normalized}`)}
                    badges={[
                      { label: "Assigned" },
                      { label: skillSourceLabel(entry.source) },
                    ]}
                  />
                ))
              ) : (
                <EmptyMiniState>No library skills are assigned yet.</EmptyMiniState>
              )}
            </SourceGroup>

            <SourceGroup title="Custom skills">
              {declaredUnmanaged.length > 0 ? (
                declaredUnmanaged.map((entry) => (
                  <SkillButton
                    key={`declared:${entry.normalized}`}
                    title={entry.rawValue}
                    subtitle="Custom skill stored on this agent."
                    active={selectedKey === `declared:${entry.normalized}`}
                    onClick={() => setSelectedKey(`declared:${entry.normalized}`)}
                    badges={[{ label: "Custom", tone: "muted" }]}
                  />
                ))
              ) : (
                <EmptyMiniState>No custom skills.</EmptyMiniState>
              )}
            </SourceGroup>

            <SourceGroup title="Available library skills">
              {availableLibrary.length > 0 ? (
                availableLibrary.map((entry) => (
                  <SkillButton
                    key={`library:${entry.id.toLowerCase()}`}
                    title={entry.name}
                    subtitle={entry.description}
                    active={selectedKey === `library:${entry.id.toLowerCase()}`}
                    onClick={() => setSelectedKey(`library:${entry.id.toLowerCase()}`)}
                    badges={[
                      { label: "Available", tone: "muted" },
                      { label: skillSourceLabel(entry.source) },
                    ]}
                  />
                ))
              ) : (
                <EmptyMiniState>No additional configured library skills match this filter.</EmptyMiniState>
              )}
            </SourceGroup>
          </div>
        </Section>

        <Section
          icon={selectedView?.kind === "library" ? <Link2 size={14} /> : <Tag size={14} />}
          title={
            selectedView?.kind === "library"
              ? selectedView.entry.name
              : selectedView?.entry.registryName || selectedView?.entry.rawValue || "Skill detail"
          }
          subtitle={
            selectedView?.kind === "library"
              ? "Company library skill"
              : selectedView?.kind === "declared"
                ? selectedView.entry.managed
                  ? "Assigned skill from the company library."
                  : "Custom skill assigned directly to this agent."
                : "Select a skill to inspect."
          }
        >
          {selectedView ? (
            selectedView.kind === "declared" ? (
              <DeclaredSkillDetail
                entry={selectedView.entry}
                companyCode={companyCode}
                mutating={mutating}
                onRemove={() => void detachDeclaredSkill(selectedView.entry.rawValue)}
              />
            ) : (
              <LibrarySkillDetail
                entry={selectedView.entry}
                companyCode={companyCode}
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
            <EmptySourceState>Select a skill to inspect.</EmptySourceState>
          )}

          {mutationError ? (
            <InlineStatus tone="error">Could not update agent skills ({mutationError}).</InlineStatus>
          ) : actionLabel ? (
            <InlineStatus>{actionLabel}</InlineStatus>
          ) : null}
        </Section>
      </div>

    </div>
  );
}

function DeclaredSkillDetail({
  entry,
  companyCode,
  mutating,
  onRemove,
}: {
  entry: DeclaredSkill;
  companyCode: string;
  mutating: boolean;
  onRemove: () => void;
}) {
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <Pill>{entry.managed ? "Assigned library skill" : "Custom skill"}</Pill>
        {entry.source ? (
          <Pill>{skillSourceLabel(entry.source)}</Pill>
        ) : null}
      </div>

      <div style={detailDescriptionStyle}>
        {entry.managed
          ? entry.description || "This skill is assigned from the configured company skill library."
          : "This custom skill is assigned directly to the agent because it does not currently map to a company library skill."}
      </div>

      <MetaGrid>
        <MetaRow label="Skill name" value={entry.registryName || entry.rawValue} />
        <MetaRow label="Source" value={entry.source ? skillSourceLabel(entry.source) : "Custom"} />
        <MetaRow label="Files" value={entry.fileCount != null ? String(entry.fileCount) : "-"} />
      </MetaGrid>

      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        {entry.registryId ? (
          <Link
            href={`/${encodeURIComponent(companyCode.toUpperCase())}/skills/${encodeURIComponent(entry.registryId)}`}
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
          {entry.managed ? "Detach skill" : "Remove custom skill"}
        </button>
      </div>

      <AdvancedSkillMetadata>
        <MetaGrid>
          <MetaRow label="Stored value" value={entry.rawValue} mono />
          <MetaRow label="Registry ID" value={entry.registryId || "-"} mono />
          <MetaRow label="Match type" value={entry.matchKind || "-"} />
          <MetaRow label="Runtime evidence" value={runtimeLabel(entry.runtimeEvidence.status)} />
        </MetaGrid>
        <div style={{ ...noteStyle, marginTop: 12 }}>{entry.runtimeEvidence.detail}</div>
        {entry.location ? (
          <div style={{ ...noteStyle, marginTop: 8 }}>
            Library location: <span style={{ fontFamily: "monospace", wordBreak: "break-word" }}>{entry.location}</span>
          </div>
        ) : null}
      </AdvancedSkillMetadata>
    </>
  );
}

function LibrarySkillDetail({
  entry,
  companyCode,
  mutating,
  declaredEntry,
  onAttach,
  onDetach,
}: {
  entry: LibrarySkill;
  companyCode: string;
  mutating: boolean;
  declaredEntry: DeclaredSkill | null;
  onAttach: () => void;
  onDetach?: () => void;
}) {
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <Pill>{skillSourceLabel(entry.source)}</Pill>
        <Pill>{entry.declared ? "Declared on agent" : "Not declared on agent"}</Pill>
      </div>

      <div style={detailDescriptionStyle}>{entry.description}</div>

      <MetaGrid>
        <MetaRow label="Skill name" value={entry.name} />
        <MetaRow label="Source" value={skillSourceLabel(entry.source)} />
        <MetaRow label="Files" value={String(entry.fileCount)} />
      </MetaGrid>

      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        <Link
          href={`/${encodeURIComponent(companyCode.toUpperCase())}/skills/${encodeURIComponent(entry.id)}`}
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
            Detach skill
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
            Attach skill
          </button>
        )}
      </div>

      <AdvancedSkillMetadata>
        <MetaGrid>
          <MetaRow label="Skill ID" value={entry.id} mono />
          <MetaRow label="Runtime evidence" value={runtimeLabel(entry.runtimeEvidence.status)} />
          <MetaRow label="Workspace evidence" value={entry.workspaceOwners.length > 0 ? entry.workspaceOwners.join(", ") : "-"} mono />
        </MetaGrid>
        <div style={{ ...noteStyle, marginTop: 12 }}>{entry.runtimeEvidence.detail}</div>
        <div style={{ ...noteStyle, marginTop: 8 }}>
          Library location: <span style={{ fontFamily: "monospace", wordBreak: "break-word" }}>{entry.location}</span>
        </div>
      </AdvancedSkillMetadata>
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
            color: A.textSec,
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
        border: `0.5px solid ${active ? A.cardBorder : UI.surfaceBorder}`,
        background: active ? "var(--surface-hover)" : UI.surface,
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
      ? { background: "var(--positive-soft)", border: "rgba(23, 122, 50, 0.22)", color: "var(--positive)" }
      : tone === "warn"
        ? { background: "var(--warning-soft)", border: "rgba(138, 90, 0, 0.24)", color: "var(--warning)" }
        : tone === "muted"
          ? { background: "var(--surface-hover)", border: "var(--border)", color: A.muted }
          : { background: "var(--surface-elevated)", border: UI.surfaceBorder, color: A.textSec };

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
        background: "var(--surface-elevated)",
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

function AdvancedSkillMetadata({ children }: { children: ReactNode }) {
  return (
    <details
      style={{
        marginTop: 16,
        padding: "12px 13px",
        borderRadius: 12,
        border: `0.5px solid ${UI.divider}`,
        background: "var(--surface-elevated)",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          color: A.textSec,
        }}
      >
        Advanced metadata
      </summary>
      <div style={{ marginTop: 12 }}>{children}</div>
    </details>
  );
}

function EmptyMiniState({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "12px 13px",
        borderRadius: 12,
        border: `1px dashed ${UI.surfaceBorder}`,
        background: "var(--surface-elevated)",
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
        background: "var(--surface-elevated)",
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
        color: tone === "error" ? "var(--negative)" : A.muted,
        lineHeight: 1.6,
        marginTop: 12,
      }}
    >
      {children}
    </div>
  );
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

const detailDescriptionStyle: CSSProperties = {
  fontSize: 13,
  color: A.textSec,
  lineHeight: 1.65,
  marginBottom: 14,
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
  border: `0.5px solid ${A.cardBorder}`,
  background: "transparent",
  color: A.text,
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
