"use client";

import Link from "next/link";
import { Archive, Building2, Check, ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { CompanyErrorState, DeleteCompanyModal } from "@/components/company/company-ui";
import {
  archiveCompanyBySlug,
  hardDeleteCompanyBySlug,
  listCompanies,
  restoreCompanyBySlug,
} from "@/lib/orchestration/client";
import type { OrchestrationCompany } from "@/lib/orchestration/types";
import { Badge, EmptyState, PageHeader, Section } from "@/lib/ui/primitives";
import { color, pageStyle, radius, space, type as T } from "@/lib/ui/tokens";

const PROTECTED_COMPANY_IDS = new Set(["6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f"]);

type TabKey = "active" | "archived";
type BulkAction = "archive" | "restore" | "delete";

type BulkActionState =
  | {
      action: BulkAction;
      companies: OrchestrationCompany[];
    }
  | null;

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusTone(status: OrchestrationCompany["status"]): "default" | "positive" | "warning" | "negative" {
  switch (status) {
    case "active":
      return "positive";
    case "paused":
      return "warning";
    case "archived":
      return "negative";
    default:
      return "default";
  }
}

function actionLabel(action: BulkAction): string {
  switch (action) {
    case "archive":
      return "Archive";
    case "restore":
      return "Restore";
    case "delete":
      return "Delete";
    default:
      return "Update";
  }
}

function actionPastTense(action: BulkAction): string {
  switch (action) {
    case "archive":
      return "archived";
    case "restore":
      return "restored";
    case "delete":
      return "deleted";
    default:
      return "updated";
  }
}

export default function ManageCompaniesPage() {
  const [companies, setCompanies] = useState<OrchestrationCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("active");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrchestrationCompany | null>(null);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [bulkActionState, setBulkActionState] = useState<BulkActionState>(null);

  const loadCompanies = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listCompanies({ includeArchived: true, includeNonProduction: true });
      setCompanies(rows);
    } catch {
      setError("Could not load companies.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCompanies();
  }, []);

  useEffect(() => {
    setSelectedSlugs([]);
    setBulkActionState(null);
  }, [activeTab]);

  const activeCompanies = useMemo(
    () => companies.filter((company) => company.status !== "archived"),
    [companies]
  );
  const archivedCompanies = useMemo(
    () => companies.filter((company) => company.status === "archived"),
    [companies]
  );

  const visibleCompanies = activeTab === "active" ? activeCompanies : archivedCompanies;
  const selectableVisibleCompanies = useMemo(
    () => visibleCompanies.filter((company) => !PROTECTED_COMPANY_IDS.has(company.id)),
    [visibleCompanies]
  );
  const selectedSet = useMemo(() => new Set(selectedSlugs), [selectedSlugs]);
  const selectedCompanies = useMemo(
    () => visibleCompanies.filter((company) => selectedSet.has(company.slug)),
    [selectedSet, visibleCompanies]
  );
  const allVisibleSelected =
    selectableVisibleCompanies.length > 0 &&
    selectableVisibleCompanies.every((company) => selectedSet.has(company.slug));
  const hasProtectedVisible = visibleCompanies.some((company) => PROTECTED_COMPANY_IDS.has(company.id));

  const toggleCompanySelection = (companySlug: string) => {
    setSelectedSlugs((previous) =>
      previous.includes(companySlug) ? previous.filter((slug) => slug !== companySlug) : [...previous, companySlug]
    );
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedSlugs([]);
      return;
    }
    setSelectedSlugs(selectableVisibleCompanies.map((company) => company.slug));
  };

  const runAction = async (key: string, fn: () => Promise<boolean>, successMessage: string) => {
    setBusyKey(key);
    setError(null);
    setNotice(null);
    try {
      const ok = await fn();
      if (!ok) throw new Error("request_failed");
      setNotice(successMessage);
      await loadCompanies();
    } catch {
      setError("Could not update company lifecycle.");
    } finally {
      setBusyKey(null);
    }
  };

  const runBulkAction = async (action: BulkAction, targetCompanies: OrchestrationCompany[]) => {
    const actionKey = `bulk:${action}`;
    setBusyKey(actionKey);
    setError(null);
    setNotice(null);

    const failures: OrchestrationCompany[] = [];
    let successCount = 0;

    const actionRunner =
      action === "archive"
        ? archiveCompanyBySlug
        : action === "restore"
          ? restoreCompanyBySlug
          : hardDeleteCompanyBySlug;

    try {
      for (const company of targetCompanies) {
        try {
          const ok = await actionRunner(company.slug);
          if (ok) {
            successCount += 1;
          } else {
            failures.push(company);
          }
        } catch {
          failures.push(company);
        }
      }

      await loadCompanies();

      if (failures.length === 0) {
        setNotice(
          `${successCount} compan${successCount === 1 ? "y" : "ies"} ${actionPastTense(action)}.`
        );
        setSelectedSlugs([]);
      } else {
        if (successCount > 0) {
          setNotice(
            `${successCount} compan${successCount === 1 ? "y" : "ies"} ${actionPastTense(action)}.`
          );
        }
        setError(
          `Failed to ${action} ${failures.length} compan${failures.length === 1 ? "y" : "ies"}: ${failures
            .map((company) => company.name)
            .join(", ")}`
        );
        setSelectedSlugs(failures.map((company) => company.slug));
      }
    } finally {
      setBusyKey(null);
      setBulkActionState(null);
    }
  };

  if (!loading && !companies.length && error) {
    return <CompanyErrorState title="Companies unavailable" detail={error} href="/systems/companies" />;
  }

  return (
    <div style={pageStyle}>
      <PageHeader
        icon={<Building2 size={16} color={color.text} />}
        title="Manage Companies"
        description="Global company lifecycle controls for active and archived companies."
      />

      {error ? (
        <div
          style={{
            marginBottom: space.lg,
            borderRadius: radius.md,
            border: `0.5px solid rgba(239,68,68,0.25)`,
            background: "rgba(127,29,29,0.15)",
            color: "#fecaca",
            padding: `${space.sm}px ${space.md}px`,
            fontSize: T.bodySmall.size,
          }}
        >
          {error}
        </div>
      ) : null}

      {notice ? (
        <div
          style={{
            marginBottom: space.lg,
            borderRadius: radius.md,
            border: `0.5px solid rgba(34,197,94,0.25)`,
            background: "rgba(21,128,61,0.14)",
            color: "#bbf7d0",
            padding: `${space.sm}px ${space.md}px`,
            fontSize: T.bodySmall.size,
          }}
        >
          {notice}
        </div>
      ) : null}

      <Section title="Company Lifecycle">
        <LifecycleTabBar
          activeTab={activeTab}
          activeCount={activeCompanies.length}
          archivedCount={archivedCompanies.length}
          onTabChange={setActiveTab}
        />

        <div style={{ marginTop: space.lg }}>
          {loading ? (
            <p style={{ color: color.textMuted, fontSize: T.bodySmall.size }}>Loading companies...</p>
          ) : visibleCompanies.length === 0 ? (
            <EmptyState
              icon={<Building2 size={18} />}
              title={activeTab === "active" ? "No active companies" : "No archived companies"}
              description={activeTab === "active" ? "Active companies will appear here." : "Archived companies will appear here once archived."}
            />
          ) : (
            <>
              <SelectionToolbar
                activeTab={activeTab}
                selectedCount={selectedCompanies.length}
                allVisibleSelected={allVisibleSelected}
                selectableCount={selectableVisibleCompanies.length}
                hasProtectedVisible={hasProtectedVisible}
                busy={Boolean(busyKey?.startsWith("bulk:"))}
                onToggleSelectAll={toggleSelectAllVisible}
                onClearSelection={() => setSelectedSlugs([])}
                onArchiveSelected={() => setBulkActionState({ action: "archive", companies: selectedCompanies })}
                onRestoreSelected={() => setBulkActionState({ action: "restore", companies: selectedCompanies })}
                onDeleteSelected={() => setBulkActionState({ action: "delete", companies: selectedCompanies })}
              />

              <div style={{ display: "flex", flexDirection: "column", gap: space.md }}>
                {visibleCompanies.map((company) => {
                const isProtected = PROTECTED_COMPANY_IDS.has(company.id);
                const companyKey = `${activeTab}:${company.slug}`;
                const isBusy = busyKey === companyKey;
                const isSelected = selectedSet.has(company.slug);

                return (
                  <article
                    key={company.id}
                    style={{
                      borderRadius: radius.lg,
                      border: `0.5px solid ${isSelected ? color.borderStrong : color.border}`,
                      background: isSelected ? "var(--surface-hover)" : "var(--surface)",
                      padding: space.lg,
                      display: "flex",
                      gap: space.md,
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ paddingTop: 3 }}>
                      <MiniCheckbox
                        checked={isSelected}
                        disabled={isProtected || Boolean(busyKey)}
                        label={`Select ${company.name}`}
                        onChange={() => toggleCompanySelection(company.slug)}
                      />
                    </div>

                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.md }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: space.md, alignItems: "flex-start" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <h2 style={{ margin: 0, fontSize: T.cardTitle.size, fontWeight: T.cardTitle.weight, color: color.text }}>
                              {company.name}
                            </h2>
                            <Badge label={company.status} tone={statusTone(company.status)} />
                            {isProtected ? <Badge label="protected" tone="warning" /> : null}
                            <span style={{ color: color.textMuted, fontSize: T.bodySmall.size }}>
                              {company.code} · {company.slug}
                            </span>
                          </div>
                          <p style={{ margin: `${space.xs}px 0 0`, color: color.textSecondary, fontSize: T.bodySmall.size }}>
                            {company.description?.trim() || "No description"}
                          </p>
                        </div>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                          {company.status !== "archived" ? (
                            <Link href={`/companies/${encodeURIComponent(company.slug)}`} style={actionLinkStyle}>
                              <ExternalLink size={14} />
                              Open
                            </Link>
                          ) : null}

                          {company.status !== "archived" ? (
                            <button
                              type="button"
                              disabled={isBusy || isProtected || Boolean(busyKey?.startsWith("bulk:"))}
                              onClick={() =>
                                void runAction(companyKey, () => archiveCompanyBySlug(company.slug), `${company.name} archived.`)
                              }
                              style={secondaryButtonStyle(isBusy || isProtected || Boolean(busyKey?.startsWith("bulk:")))}
                            >
                              <Archive size={14} />
                              Archive
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy || Boolean(busyKey?.startsWith("bulk:"))}
                              onClick={() =>
                                void runAction(companyKey, () => restoreCompanyBySlug(company.slug), `${company.name} restored.`)
                              }
                              style={secondaryButtonStyle(isBusy || Boolean(busyKey?.startsWith("bulk:")))}
                            >
                              <RotateCcw size={14} />
                              Restore
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isBusy || isProtected || Boolean(busyKey?.startsWith("bulk:"))}
                            onClick={() => setDeleteTarget(company)}
                            style={dangerButtonStyle(isBusy || isProtected || Boolean(busyKey?.startsWith("bulk:")))}
                          >
                            <Trash2 size={14} />
                            {isProtected ? "Delete Disabled" : "Delete"}
                          </button>
                        </div>
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gap: space.md,
                          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                        }}
                      >
                        <MetaBlock label="Created" value={formatDate(company.created)} />
                        <MetaBlock label="Workspace" value={company.workspace.root || "—"} mono />
                        <MetaBlock label="Workspace Source" value={company.workspace.source || "—"} />
                        <MetaBlock label="Theme" value={company.theme.name || "—"} />
                        <MetaBlock label="Projects" value={String(company.stats.projects)} />
                        <MetaBlock label="Agents" value={String(company.stats.agents)} />
                        <MetaBlock label="Active Tasks" value={String(company.stats.activeTasks)} />
                      </div>
                    </div>
                  </article>
                );
                })}
              </div>
            </>
          )}
        </div>
      </Section>

      <DeleteCompanyModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          void runAction(
            `delete:${deleteTarget.slug}`,
            () => hardDeleteCompanyBySlug(deleteTarget.slug),
            `${deleteTarget.name} deleted.`
          ).finally(() => setDeleteTarget(null));
        }}
        companyName={deleteTarget?.name ?? ""}
        busy={Boolean(deleteTarget && busyKey === `delete:${deleteTarget.slug}`)}
      />

      {bulkActionState ? (
        <BulkCompanyActionModal
          state={bulkActionState}
          busy={busyKey === `bulk:${bulkActionState.action}`}
          onClose={() => setBulkActionState(null)}
          onConfirm={() => {
            void runBulkAction(bulkActionState.action, bulkActionState.companies);
          }}
        />
      ) : null}
    </div>
  );
}

function SelectionToolbar({
  activeTab,
  selectedCount,
  allVisibleSelected,
  selectableCount,
  hasProtectedVisible,
  busy,
  onToggleSelectAll,
  onClearSelection,
  onArchiveSelected,
  onRestoreSelected,
  onDeleteSelected,
}: {
  activeTab: TabKey;
  selectedCount: number;
  allVisibleSelected: boolean;
  selectableCount: number;
  hasProtectedVisible: boolean;
  busy: boolean;
  onToggleSelectAll: () => void;
  onClearSelection: () => void;
  onArchiveSelected: () => void;
  onRestoreSelected: () => void;
  onDeleteSelected: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "space-between",
        alignItems: "center",
        gap: space.md,
        marginBottom: space.md,
        borderRadius: radius.md,
        border: `0.5px solid ${color.border}`,
        background: "var(--surface-hover)",
        padding: `${space.md}px ${space.lg}px`,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.md }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <MiniCheckbox
            checked={allVisibleSelected}
            disabled={selectableCount === 0 || busy}
            label="Select all visible companies"
            onChange={onToggleSelectAll}
          />
          <button
            type="button"
            onClick={onToggleSelectAll}
            disabled={selectableCount === 0 || busy}
            style={toolbarLinkButtonStyle(selectableCount === 0 || busy)}
          >
            {allVisibleSelected ? "Clear visible selection" : "Select all visible"}
          </button>
        </div>
        <span style={{ fontSize: T.bodySmall.size, color: color.textSecondary }}>
          {selectedCount} selected
        </span>
        {selectedCount > 0 ? (
          <button type="button" onClick={onClearSelection} disabled={busy} style={toolbarLinkButtonStyle(busy)}>
            Clear selection
          </button>
        ) : null}
        {hasProtectedVisible ? (
          <span style={{ fontSize: T.caption.size, color: color.textMuted }}>
            Protected companies are excluded from bulk actions.
          </span>
        ) : null}
      </div>

      {selectedCount > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {activeTab === "active" ? (
            <button type="button" onClick={onArchiveSelected} disabled={busy} style={secondaryButtonStyle(busy)}>
              <Archive size={14} />
              Archive selected
            </button>
          ) : (
            <>
              <button type="button" onClick={onRestoreSelected} disabled={busy} style={secondaryButtonStyle(busy)}>
                <RotateCcw size={14} />
                Restore selected
              </button>
              <button type="button" onClick={onDeleteSelected} disabled={busy} style={dangerButtonStyle(busy)}>
                <Trash2 size={14} />
                Delete selected
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function MiniCheckbox({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      style={{
        display: "inline-flex",
        width: 16,
        height: 16,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.sm,
        border: `1px solid ${checked ? color.accent : color.border}`,
        background: checked ? color.accentSoft : "transparent",
        color: color.accent,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {checked ? <Check size={11} /> : null}
    </button>
  );
}

function LifecycleTabBar({
  activeTab,
  activeCount,
  archivedCount,
  onTabChange,
}: {
  activeTab: TabKey;
  activeCount: number;
  archivedCount: number;
  onTabChange: (tab: TabKey) => void;
}) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: "active", label: `Active (${activeCount})` },
    { key: "archived", label: `Archived (${archivedCount})` },
  ];

  return (
    <div
      style={{
        margin: `-${space.lg}px -${space.xl}px 0`,
        borderBottom: "0.5px solid rgba(222,220,209,0.10)",
      }}
    >
      <nav style={{ display: "flex", gap: 0, padding: `0 ${space.xl}px` }}>
        {tabs.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className="relative px-3 py-2.5 text-sm font-medium transition-colors"
              style={{
                border: "none",
                background: "transparent",
                color: active ? color.text : color.textMuted,
                cursor: "pointer",
              }}
            >
              {tab.label}
              {active ? (
                <span
                  className="absolute inset-x-0 bottom-0 h-0.5"
                  style={{ background: color.accent }}
                />
              ) : null}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function MetaBlock({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        borderRadius: radius.md,
        border: `0.5px solid ${color.border}`,
        background: "var(--surface-hover)",
        padding: space.md,
      }}
    >
      <div style={{ fontSize: T.caption.size, color: color.textMuted, marginBottom: 6 }}>{label}</div>
      <div
        style={{
          fontSize: T.bodySmall.size,
          color: color.text,
          fontFamily: mono ? "var(--font-mono, monospace)" : undefined,
          wordBreak: "break-all",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function BulkCompanyActionModal({
  state,
  busy,
  onClose,
  onConfirm,
}: {
  state: Exclude<BulkActionState, null>;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmationValue, setConfirmationValue] = useState("");

  const isDelete = state.action === "delete";
  const count = state.companies.length;
  const confirmEnabled = isDelete ? confirmationValue.trim().toUpperCase() === "DELETE" && !busy : !busy;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-3 backdrop-blur-md md:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${actionLabel(state.action)} companies`}
        className="w-full max-w-xl rounded-3xl border border-white/10 bg-[linear-gradient(165deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] p-5 shadow-[0_24px_60px_rgba(2,6,23,0.8)] md:p-6"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: space.md }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#fff" }}>
              {actionLabel(state.action)} {count} compan{count === 1 ? "y" : "ies"}?
            </h2>
            <p style={{ marginTop: 8, marginBottom: 0, fontSize: 13, color: "#cbd5e1", lineHeight: 1.5 }}>
              {state.action === "archive"
                ? "Archive hides these companies from normal navigation. Their workspaces and runtime registrations stay intact."
                : state.action === "restore"
                  ? "Restore returns these archived companies to the active company list."
                  : "Delete permanently removes these companies from HiveRunner, deletes their workspaces, and removes associated runtime registrations."}
            </p>
          </div>

          <div
            style={{
              maxHeight: 220,
              overflowY: "auto",
              borderRadius: radius.md,
              border: "0.5px solid rgba(255,255,255,0.1)",
              background: "rgba(15,23,42,0.45)",
              padding: space.md,
            }}
          >
            <div style={{ fontSize: T.caption.size, color: "#94a3b8", marginBottom: 8 }}>Selected companies</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {state.companies.map((company) => (
                <div
                  key={company.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    fontSize: T.bodySmall.size,
                    color: "#e2e8f0",
                  }}
                >
                  <span>{company.name}</span>
                  <span style={{ color: "#94a3b8" }}>{company.slug}</span>
                </div>
              ))}
            </div>
          </div>

          {isDelete ? (
            <label className="block rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <span className="mb-2 block text-xs font-medium uppercase tracking-[0.08em] text-slate-400">
                Type DELETE to confirm
              </span>
              <input
                autoFocus
                type="text"
                value={confirmationValue}
                onChange={(event) => setConfirmationValue(event.target.value)}
                disabled={busy}
                placeholder="DELETE"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500"
              />
            </label>
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" onClick={onClose} disabled={busy} style={modalButtonStyle("secondary", busy)}>
              Cancel
            </button>
            <button type="button" onClick={onConfirm} disabled={!confirmEnabled} style={modalButtonStyle(isDelete ? "danger" : "primary", !confirmEnabled)}>
              {busy ? `${actionLabel(state.action)}ing...` : `${actionLabel(state.action)} selected`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const actionLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  textDecoration: "none",
  borderRadius: radius.md,
  border: `0.5px solid ${color.border}`,
  background: "transparent",
  color: color.text,
  padding: `8px ${space.md}px`,
  fontSize: T.bodySmall.size,
};

function toolbarLinkButtonStyle(disabled: boolean): CSSProperties {
  return {
    border: "none",
    background: "transparent",
    color: color.textSecondary,
    fontSize: T.bodySmall.size,
    cursor: disabled ? "not-allowed" : "pointer",
    padding: 0,
    opacity: disabled ? 0.45 : 1,
  };
}

function secondaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.md,
    border: `0.5px solid ${color.border}`,
    background: "transparent",
    color: color.text,
    padding: `8px ${space.md}px`,
    fontSize: T.bodySmall.size,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}

function dangerButtonStyle(disabled: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.md,
    border: "0.5px solid var(--negative)",
    background: "var(--surface-hover)",
    color: "var(--negative)",
    padding: `8px ${space.md}px`,
    fontSize: T.bodySmall.size,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}

function modalButtonStyle(tone: "secondary" | "primary" | "danger", disabled: boolean): CSSProperties {
  if (tone === "secondary") {
    return {
      borderRadius: radius.md,
      border: "0.5px solid rgba(255,255,255,0.15)",
      background: "rgba(255,255,255,0.05)",
      color: "#e2e8f0",
      padding: `8px ${space.md}px`,
      fontSize: T.bodySmall.size,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.45 : 1,
    };
  }

  if (tone === "danger") {
    return {
      borderRadius: radius.md,
      border: "0.5px solid rgba(239,68,68,0.35)",
      background: "rgba(127,29,29,0.18)",
      color: "#fecaca",
      padding: `8px ${space.md}px`,
      fontSize: T.bodySmall.size,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.45 : 1,
    };
  }

  return {
    borderRadius: radius.md,
    border: "0.5px solid rgba(245,158,11,0.28)",
    background: "rgba(245,158,11,0.14)",
    color: "#fde68a",
    padding: `8px ${space.md}px`,
    fontSize: T.bodySmall.size,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
  };
}
