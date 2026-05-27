"use client";

import { usePathname, useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState, useCallback } from "react";
import {
  Copy,
  MoreHorizontal,
  Sparkles,
  PlayCircle,
  PauseCircle,
  HeartPulse,
  Plus,
  Archive,
  Trash2,
} from "lucide-react";
import { AvatarWizard } from "@/components/orchestration/AvatarWizard";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { CreateTaskModal } from "@/components/orchestration/CreateTaskModal";
import { SubmenuTabs } from "@/components/navigation/SubmenuTabs";
import { archiveCompanyAgent, deleteCompanyAgent, getCompanyAgentProfile, listCompanies, triggerAgentHeartbeat, wakeupAgent } from "@/lib/orchestration/client";
import type { OrchestrationAgentProfile } from "@/lib/orchestration/types";
import { buildCanonicalAgentPath, buildCanonicalDashboardPath } from "@/lib/orchestration/route-paths";
import { P as tokens } from "@/lib/ui/tokens";
import { A, AgentProfileProvider } from "./agent-context";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "instructions", label: "Instructions" },
  { id: "skills", label: "Skills" },
  { id: "configuration", label: "Configuration" },
  { id: "runs", label: "Runs" },
  { id: "budget", label: "Budget" },
] as const;

export default function AgentDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string; agentId: string }>;
}) {
  const { slug, agentId } = use(params);
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<OrchestrationAgentProfile | null>(null);
  const [avatarWizardOpen, setAvatarWizardOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [pauseLoading, setPauseLoading] = useState(false);
  const [heartbeatLoading, setHeartbeatLoading] = useState(false);
  const [companyCode, setCompanyCode] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [result, companies] = await Promise.all([
      getCompanyAgentProfile(slug, agentId, {
        executionLimit: 24,
        activityLimit: 30,
      }),
      listCompanies(),
    ]);
    if (!result) {
      setError("Agent profile not found.");
      setProfile(null);
    } else {
      setProfile(result);
      const co = companies.find((c) => (
        c.slug === slug ||
        c.code === slug ||
        c.slug === result.company.slug ||
        c.id === result.company.id
      ));
      setCompanyCode(co?.code ?? "");
    }
    setLoading(false);
  }, [slug, agentId]);

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [load]);

  const statusIndicator = useMemo(() => {
    const fallback = {
      color: "var(--text-muted)",
      shadow: "0 0 0 3px var(--surface-hover)",
    };
    if (!profile) return fallback;

    const m: Record<string, { color: string; shadow: string }> = {
      working: {
        color: "var(--positive)",
        shadow: "0 0 0 3px var(--positive-soft), 0 0 8px var(--positive)",
      },
      idle: {
        color: "var(--info)",
        shadow: "0 0 0 3px var(--info-soft)",
      },
      paused: {
        color: "var(--warning)",
        shadow: "0 0 0 3px var(--warning-soft)",
      },
      offline: {
        color: "var(--text-muted)",
        shadow: "0 0 0 3px var(--surface-hover)",
      },
      error: {
        color: "var(--negative)",
        shadow: "0 0 0 3px var(--negative-soft), 0 0 8px var(--negative)",
      },
    };
    return m[profile.agent.status] ?? fallback;
  }, [profile]);

  const isLive = profile?.liveSession?.status === "running" || profile?.liveSession?.status === "pending";

  const activeTab = useMemo(() => {
    const segments = pathname.split("/");
    const last = segments[segments.length - 1];
    return TABS.find((t) => t.id === last)?.id ?? "dashboard";
  }, [pathname]);

  const agentSlugResolved = profile?.agent?.slug || agentId;
  const basePath = companyCode
    ? buildCanonicalAgentPath(companyCode, agentSlugResolved)
    : `/companies/${encodeURIComponent(slug)}/agents/${encodeURIComponent(agentSlugResolved)}`;

  /* ── action handlers ── */
  const handleHeartbeat = async () => {
    if (!profile || heartbeatLoading) return;
    setHeartbeatLoading(true);
    await wakeupAgent(profile.agent.id, { source: "explicit", reason: "ui_manual_wake" });
    await load();
    setHeartbeatLoading(false);
  };

  const handlePauseResume = async () => {
    if (!profile || pauseLoading) return;
    setPauseLoading(true);
    const isPaused = profile.agent.status === "paused";
    await triggerAgentHeartbeat(profile.agent.id, {
      status: isPaused ? "idle" : "paused",
      source: "manual",
    });
    await load();
    setPauseLoading(false);
  };

  const handleAssignTask = () => {
    setCreateTaskOpen(true);
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 200, borderRadius: 12, background: A.card, border: `0.5px solid ${A.cardBorder}`, animation: "pulse 1.5s infinite" }} />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: 16, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "0.5px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
          {error ?? "Agent not found."}
        </div>
      </div>
    );
  }

  const { agent } = profile;
  const isPaused = agent.status === "paused";

  return (
    <AgentProfileProvider value={{ profile, slug, companyCode, agentId, reload: load }}>
      <div style={{ padding: "0 20px 16px", maxWidth: 1200, color: A.text, fontSize: 13 }}>
        {/* ── agent header ── */}
        <style>{`
          .agent-profile-avatar-overlay {
            opacity: 0;
            transition: opacity 160ms ease;
          }
          .agent-profile-avatar:hover .agent-profile-avatar-overlay,
          .agent-profile-avatar:focus-visible .agent-profile-avatar-overlay {
            opacity: 1;
          }
          @media (max-width: 820px) {
            .agent-profile-hero {
              grid-template-columns: 1fr !important;
            }
            .agent-profile-avatar {
              width: 92px !important;
              height: 92px !important;
            }
            .agent-profile-actions {
              justify-content: flex-start !important;
              flex-wrap: wrap !important;
            }
            .agent-profile-tabs {
              margin-top: 14px !important;
            }
          }
        `}</style>
        <div
          className="agent-profile-hero"
          style={{
            display: "grid",
            gridTemplateColumns: "116px minmax(0, 1fr)",
            alignItems: "center",
            gap: 18,
            marginBottom: 14,
          }}
        >
          {/* avatar — click to edit */}
          <button
            className="agent-profile-avatar"
            type="button"
            onClick={() => setAvatarWizardOpen(true)}
            aria-label={`Edit avatar for ${agent.name}`}
            title="Edit avatar"
            style={{
              position: "relative",
              width: 116,
              height: 116,
              borderRadius: 24,
              overflow: "hidden",
              border: `0.5px solid ${A.cardBorder}`,
              background: A.card,
              display: "grid",
              placeItems: "center",
              fontSize: 42,
              flexShrink: 0,
              cursor: "pointer",
              padding: 0,
              boxShadow: "0 18px 42px color-mix(in srgb, var(--shadow, #000) 12%, transparent)",
            }}
          >
            {agent.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={agent.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <AvatarGlyph value={agent.emoji} size={48} />
            )}
            <span
              className="agent-profile-avatar-overlay"
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                background: "rgba(0,0,0,0.28)",
              }}
            />
            <span
              style={{
                position: "absolute",
                right: 8,
                bottom: 8,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                width: 26,
                height: 26,
                borderRadius: 999,
                background: "color-mix(in srgb, var(--surface-elevated) 92%, transparent)",
                border: `0.5px solid ${A.cardBorder}`,
                color: A.text,
                boxShadow: "0 6px 16px color-mix(in srgb, #000 16%, transparent)",
              }}
            >
              <Sparkles size={12} />
            </span>
          </button>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                  <h1 style={{ margin: 0, fontSize: 24, fontWeight: 680, letterSpacing: "-0.02em", color: A.text, lineHeight: 1.12 }}>{agent.name}</h1>
                  <span
                    title={agent.status}
                    style={{
                      width: 10, height: 10, borderRadius: "50%",
                      backgroundColor: statusIndicator.color,
                      boxShadow: statusIndicator.shadow,
                      flexShrink: 0,
                    }}
                  />
                  {isLive && (
                    <span style={{
                      fontSize: 10, fontWeight: 650, letterSpacing: "0.06em", textTransform: "uppercase",
                      color: "#22c55e", background: "rgba(34,197,94,0.12)", padding: "2px 7px", borderRadius: 4,
                    }}>
                      LIVE
                    </span>
                  )}
                </div>
                <p style={{ margin: "6px 0 0", color: A.textSec, fontSize: 15, lineHeight: 1.35 }}>
                  {agent.role}
                </p>
              </div>

              {/* action buttons */}
              <div className="agent-profile-actions" style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center", justifyContent: "flex-end" }}>
                <ActionBtn icon={<Plus size={13} />} label="Assign Task" onClick={handleAssignTask} />
                <ActionBtn icon={<HeartPulse size={13} />} label="Run Heartbeat" onClick={handleHeartbeat} loading={heartbeatLoading} />
                <ActionBtn
                  icon={isPaused ? <PlayCircle size={13} /> : <PauseCircle size={13} />}
                  label={isPaused ? "Resume" : "Pause"}
                  onClick={handlePauseResume}
                  loading={pauseLoading}
                />
                {isPaused && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                    color: "#f87171", background: "rgba(248,113,113,0.12)",
                    padding: "4px 10px", borderRadius: 9999,
                  }}>
                    paused
                  </span>
                )}
                <AgentOverflowMenu
                  agentId={agent.id}
                  agentName={agent.name}
                  companySlug={profile.company.slug}
                  openclawAgentId={agent.openclawAgentId}
                  returnPath={companyCode ? buildCanonicalDashboardPath(companyCode) : `/${encodeURIComponent(slug)}/dashboard`}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── tab bar ── */}
        <div className="agent-profile-tabs">
          <SubmenuTabs
            activeKey={activeTab}
            className="mb-4"
            tabs={TABS.map((tab) => ({
              key: tab.id,
              label: tab.label,
              href: `${basePath}/${tab.id}`,
            }))}
          />
        </div>

        {/* ── sub-page content ── */}
        {children}

        {/* ── Avatar Wizard modal ── */}
        {profile && (
          <AvatarWizard
            open={avatarWizardOpen}
            onClose={() => setAvatarWizardOpen(false)}
            agentName={agent.name}
            agentRole={agent.role}
            agentEmoji={agent.emoji}
            agentPersonality={agent.personality}
            currentAvatar={agent.avatar}
            companySlug={slug}
            agentId={agent.id || agentId}
            alternateAgentKey={agentId}
            initialStyleId={agent.avatarStyleId}
            initialGender={agent.avatarGender as "male" | "female" | "androgynous" | undefined}
            initialAge={agent.avatarAge}
            initialHairColor={agent.avatarHairColor}
            initialHairLength={agent.avatarHairLength}
            initialEyeColor={agent.avatarEyeColor}
            initialVibe={agent.avatarVibe}
            initialVoiceId={agent.voiceId}
            onSaved={() => { setAvatarWizardOpen(false); void load(); }}
          />
        )}

        {/* ── Create Task modal ── */}
        <CreateTaskModal
          key={`${slug}:${agent.id}:assign-task`}
          open={createTaskOpen}
          onClose={() => setCreateTaskOpen(false)}
          onCreated={() => { setCreateTaskOpen(false); void load(); }}
          companySlug={slug}
          companyCode={companyCode}
          companyName={profile.company.name}
          defaultAssignee={agent.name}
        />
      </div>
    </AgentProfileProvider>
  );
}

/* ── tiny components ── */

function AgentOverflowMenu({
  agentId,
  agentName,
  companySlug,
  openclawAgentId,
  returnPath,
}: {
  agentId: string;
  agentName: string;
  companySlug: string;
  openclawAgentId?: string;
  returnPath: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmMode, setConfirmMode] = useState<"archive" | "delete" | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const displayId = openclawAgentId || agentId;

  const handleCopy = () => {
    navigator.clipboard.writeText(displayId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
    setOpen(false);
  };

  const handleArchiveRequest = () => {
    setOpen(false);
    setMutationError(null);
    setConfirmMode("archive");
  };

  const handleDeleteRequest = () => {
    setOpen(false);
    setMutationError(null);
    setConfirmMode("delete");
  };

  const handleConfirmedMutation = async () => {
    if (mutating || !confirmMode) return;
    setMutating(true);
    setMutationError(null);
    const ok = confirmMode === "archive"
      ? await archiveCompanyAgent(agentId, { replacementFallback: "the company" })
      : await deleteCompanyAgent(agentId, { replacementFallback: "the company" });
    if (!ok) {
      setMutationError(`Could not ${confirmMode} this agent. Try again from this page.`);
      setMutating(false);
      return;
    }
    window.dispatchEvent(new CustomEvent("orchestration-company-refresh", {
      detail: { companySlug },
    }));
    router.replace(returnPath);
    router.refresh();
  };

  const dialogTitle = confirmMode === "delete" ? `Delete ${agentName}?` : `Archive ${agentName}?`;
  const dialogBody = confirmMode === "delete"
    ? "This permanently deletes the agent identity and private runtime artifacts, removes its workspace files, and detaches shared company history."
    : "This archives the agent, turns off autonomous work, hides it from active rosters, and keeps its memory, files, run history, and comments available for restore.";
  const confirmLabel = confirmMode === "delete"
    ? (mutating ? "Deleting..." : "Delete agent")
    : (mutating ? "Archiving..." : "Archive agent");

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((p) => !p)}
        title="More actions"
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 32, height: 32, borderRadius: 8,
          background: "transparent",
          border: `0.5px solid ${A.cardBorder}`,
          color: A.textSec, cursor: "pointer",
          transition: "background 0.15s, border-color 0.15s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = A.cardBorderHover; }}
        onMouseLeave={(e) => { if (!open) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = A.cardBorder; } }}
      >
        <MoreHorizontal size={15} />
      </button>
      {copied && (
        <span style={{
          position: "absolute", top: -28, right: 0,
          background: A.card, border: `0.5px solid ${A.cardBorder}`,
          borderRadius: 4, padding: "2px 8px", fontSize: 10,
          color: "#6ee7b7", whiteSpace: "nowrap", zIndex: 100,
        }}>Copied!</span>
      )}
      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 98 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0,
            background: tokens.surfaceElevated, border: `1px solid ${A.cardBorder}`,
            borderRadius: 8, padding: "4px 0", minWidth: 180,
            boxShadow: "0 16px 36px rgba(0,0,0,0.35)", zIndex: 99,
          }}>
            <button
              onClick={handleCopy}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "8px 12px", border: "none",
                background: "transparent", color: A.text, fontSize: 12,
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <Copy size={13} style={{ color: A.textSec }} /> Copy Agent ID
            </button>
            <div style={{ height: 1, background: A.cardBorder, margin: "4px 0" }} />
            <button
              onClick={handleArchiveRequest}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "8px 12px", border: "none",
                background: "transparent", color: A.text, fontSize: 12,
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <Archive size={13} style={{ color: A.textSec }} /> Archive agent
            </button>
            <button
              onClick={handleDeleteRequest}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "8px 12px", border: "none",
                background: "transparent", color: "var(--negative)", fontSize: 12,
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--negative-soft)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <Trash2 size={13} /> Delete agent
            </button>
          </div>
        </>
      )}
      {confirmMode && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 108, background: "rgba(0,0,0,0.25)" }}
            onClick={() => {
              if (!mutating) setConfirmMode(null);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-agent-title"
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              zIndex: 109,
              width: 320,
              padding: 14,
              borderRadius: 10,
              border: `1px solid ${A.cardBorder}`,
              background: tokens.surfaceElevated,
              boxShadow: "0 20px 48px rgba(0,0,0,0.45)",
            }}
          >
            <div id="remove-agent-title" style={{ color: A.text, fontSize: 13, fontWeight: 600 }}>
              {dialogTitle}
            </div>
            <p style={{ margin: "8px 0 0", color: A.textSec, fontSize: 12, lineHeight: 1.45 }}>
              {dialogBody}
            </p>
            {mutationError && (
              <div style={{
                marginTop: 10,
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--negative-soft)",
                color: "var(--negative)",
                fontSize: 12,
              }}>
                {mutationError}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button
                type="button"
                disabled={mutating}
                onClick={() => setConfirmMode(null)}
                style={{
                  padding: "7px 11px",
                  borderRadius: 8,
                  border: `0.5px solid ${A.cardBorder}`,
                  background: "transparent",
                  color: A.text,
                  fontSize: 12,
                  cursor: mutating ? "wait" : "pointer",
                  opacity: mutating ? 0.6 : 1,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={mutating}
                onClick={handleConfirmedMutation}
                style={{
                  padding: "7px 11px",
                  borderRadius: 8,
                  border: confirmMode === "delete" ? "0.5px solid var(--negative)" : `0.5px solid ${A.cardBorder}`,
                  background: confirmMode === "delete" ? "var(--negative-soft)" : "var(--surface-hover)",
                  color: confirmMode === "delete" ? "var(--negative)" : A.text,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: mutating ? "wait" : "pointer",
                  opacity: mutating ? 0.7 : 1,
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ActionBtn({ icon, label, onClick, loading }: { icon: React.ReactNode; label: string; onClick: () => void; loading?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      disabled={loading}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "6px 12px", borderRadius: 8,
        background: "transparent",
        border: `0.5px solid ${A.cardBorder}`,
        color: A.text, fontSize: 12, fontWeight: 400,
        cursor: loading ? "wait" : "pointer",
        opacity: loading ? 0.6 : 1,
        transition: "background 0.15s, border-color 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!loading) {
          e.currentTarget.style.background = "rgba(255,255,255,0.04)";
          e.currentTarget.style.borderColor = A.cardBorderHover;
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = A.cardBorder;
      }}
    >
      {icon}
      {label}
    </button>
  );
}
