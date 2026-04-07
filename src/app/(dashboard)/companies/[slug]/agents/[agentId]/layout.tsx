"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { use, useEffect, useMemo, useState, createContext, useContext, useCallback } from "react";
import {
  Copy,
  MoreHorizontal,
  Sparkles,
  PlayCircle,
  PauseCircle,
  HeartPulse,
  Plus,
} from "lucide-react";
import { AvatarWizard } from "@/components/orchestration/AvatarWizard";
import { CreateTaskModal } from "@/components/orchestration/CreateTaskModal";
import { getCompanyAgentProfile, listCompanies, triggerAgentHeartbeat } from "@/lib/orchestration/client";
import type { OrchestrationAgentProfile } from "@/lib/orchestration/types";

import { P as tokens } from "@/lib/ui/tokens";

/* ── agent palette (sourced from shared tokens) ── */
export const A = {
  accent: tokens.accent,
  accentLight: "#f59e0b",
  accentDark: "#b45309",
  surface: tokens.bg,
  card: tokens.surface,
  cardBorder: tokens.cardBorder,
  cardBorderHover: tokens.cardBorderHover,
  muted: tokens.muted,
  text: tokens.text,
  textSec: tokens.textSec,
};

/* ── context so sub-pages can access profile without re-fetching ── */
interface AgentContextValue {
  profile: OrchestrationAgentProfile;
  slug: string;
  agentId: string;
  reload: () => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);
export function useAgentProfile() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgentProfile must be used within agent layout");
  return ctx;
}

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
      const co = companies.find((c) => c.slug === slug);
      if (co) setCompanyCode(co.code);
    }
    setLoading(false);
  }, [slug, agentId]);

  useEffect(() => {
    let cancelled = false;
    void load().then(() => { if (cancelled) return; });
    return () => { cancelled = true; };
  }, [load]);

  const statusColor = useMemo(() => {
    if (!profile) return A.muted;
    const m: Record<string, string> = {
      working: "#22c55e",
      idle: A.muted,
      paused: A.accentLight,
      offline: "#57534e",
      error: "#ef4444",
    };
    return m[profile.agent.status] ?? A.muted;
  }, [profile]);

  const isLive = profile?.liveSession?.status === "running" || profile?.liveSession?.status === "pending";

  const activeTab = useMemo(() => {
    const segments = pathname.split("/");
    const last = segments[segments.length - 1];
    return TABS.find((t) => t.id === last)?.id ?? "dashboard";
  }, [pathname]);

  const agentSlugResolved = profile?.agent?.slug || agentId;
  const basePath = `/companies/${encodeURIComponent(slug)}/agents/${encodeURIComponent(agentSlugResolved)}`;

  /* ── action handlers ── */
  const handleHeartbeat = async () => {
    if (!profile || heartbeatLoading) return;
    setHeartbeatLoading(true);
    await triggerAgentHeartbeat(profile.agent.id, { source: "manual" });
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

  const { agent, company } = profile;
  const isPaused = agent.status === "paused";

  return (
    <AgentContext.Provider value={{ profile, slug, agentId, reload: load }}>
      <div style={{ padding: "0 20px 16px", maxWidth: 1200, color: A.text, fontSize: 13 }}>
        {/* ── agent header row ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
          {/* avatar — click to edit */}
          <button
            type="button"
            onClick={() => setAvatarWizardOpen(true)}
            title="Edit avatar"
            style={{
              position: "relative",
              width: 40, height: 40, borderRadius: 10, overflow: "hidden",
              border: `0.5px solid ${A.cardBorder}`, background: A.card,
              display: "grid", placeItems: "center", fontSize: 18, flexShrink: 0,
              cursor: "pointer", padding: 0,
            }}
          >
            {agent.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={agent.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span>{agent.emoji}</span>
            )}
            {/* tiny edit overlay on hover */}
            <span style={{
              position: "absolute", inset: 0,
              display: "grid", placeItems: "center",
              background: "rgba(0,0,0,0.5)", opacity: 0,
              transition: "opacity 150ms",
            }} className="avatar-edit-overlay">
              <Sparkles size={14} color="#fff" />
            </span>
          </button>
          <style>{`.avatar-edit-overlay:hover, button:hover > .avatar-edit-overlay { opacity: 1 !important; }`}</style>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", color: A.text }}>{agent.name}</h1>
              <span
                title={agent.status}
                style={{
                  width: 8, height: 8, borderRadius: "50%",
                  backgroundColor: statusColor,
                  boxShadow: `0 0 6px ${statusColor}`,
                  flexShrink: 0,
                }}
              />
              {isLive && (
                <span style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                  color: "#22c55e", background: "rgba(34,197,94,0.12)", padding: "2px 7px", borderRadius: 4,
                }}>
                  LIVE
                </span>
              )}
            </div>
            <p style={{ margin: "2px 0 0", color: A.textSec, fontSize: 12 }}>
              {agent.role}
            </p>
          </div>

          {/* action buttons */}
          <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
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
            <AgentOverflowMenu agentId={agent.id} openclawAgentId={agent.openclawAgentId} />
          </div>
        </div>

        {/* ── tab bar ── */}
        <div style={{
          display: "flex", gap: 0,
          borderBottom: `0.5px solid ${A.cardBorder}`,
          marginBottom: 16,
        }}>
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <Link
                key={tab.id}
                href={`${basePath}/${tab.id}`}
                style={{
                  padding: "10px 16px",
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  color: active ? A.text : A.textSec,
                  textDecoration: "none",
                  borderBottom: active ? `2px solid ${A.accent}` : "2px solid transparent",
                  transition: "color 0.15s, border-color 0.15s",
                }}
              >
                {tab.label}
              </Link>
            );
          })}
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
            onSaved={() => { setAvatarWizardOpen(false); void load(); }}
          />
        )}

        {/* ── Create Task modal ── */}
        <CreateTaskModal
          open={createTaskOpen}
          onClose={() => setCreateTaskOpen(false)}
          onCreated={() => { setCreateTaskOpen(false); void load(); }}
          companySlug={slug}
          companyCode={companyCode}
          defaultAssignee={agent.name}
        />
      </div>
    </AgentContext.Provider>
  );
}

/* ── tiny components ── */

function AgentOverflowMenu({ agentId, openclawAgentId }: { agentId: string; openclawAgentId?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const displayId = openclawAgentId || agentId;

  const handleCopy = () => {
    navigator.clipboard.writeText(displayId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
    setOpen(false);
  };

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
