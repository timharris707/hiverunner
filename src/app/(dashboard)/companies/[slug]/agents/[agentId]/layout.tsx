"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { use, useEffect, useMemo, useState, createContext, useContext, useCallback } from "react";
import {
  ArrowLeft,
  Bot,
  Clock3,
  Copy,
  Cpu,
  ListChecks,
  MoreHorizontal,
  RotateCcw,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
  Zap,
  PlayCircle,
  PauseCircle,
  HeartPulse,
  Plus,
} from "lucide-react";
import { formatAge } from "@/components/orchestration/ui";
import { AvatarWizard } from "@/components/orchestration/AvatarWizard";
import { getCompanyAgentProfile, triggerAgentHeartbeat } from "@/lib/orchestration/client";
import type { OrchestrationAgentProfile } from "@/lib/orchestration/types";

/* ── amber palette ── */
export const A = {
  accent: "#d97706",
  accentLight: "#f59e0b",
  accentDark: "#b45309",
  surface: "#141210",
  card: "#1a1814",
  cardBorder: "rgba(217,119,6,0.18)",
  cardBorderHover: "rgba(217,119,6,0.32)",
  muted: "#78716c",
  text: "#fafaf9",
  textSec: "#a8a29e",
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getCompanyAgentProfile(slug, agentId, {
      executionLimit: 24,
      activityLimit: 30,
    });
    if (!result) {
      setError("Agent profile not found.");
      setProfile(null);
    } else {
      setProfile(result);
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

  // Use the loaded agent slug for canonical links; fall back to URL param
  const agentSlugResolved = profile?.agent?.slug || agentId;
  const basePath = `/companies/${encodeURIComponent(slug)}/agents/${encodeURIComponent(agentSlugResolved)}`;

  const handleHeartbeat = async () => {
    if (!profile) return;
    await triggerAgentHeartbeat(profile.agent.id, { source: "manual" });
    void load();
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 200, borderRadius: 12, background: A.card, border: `1px solid ${A.cardBorder}`, animation: "pulse 1.5s infinite" }} />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: 16, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
          {error ?? "Agent not found."}
        </div>
      </div>
    );
  }

  const { agent, company, currentTasks, executionHistory } = profile;

  return (
    <AgentContext.Provider value={{ profile, slug, agentId, reload: load }}>
      <div style={{ padding: "16px 20px", maxWidth: 1200, color: A.text, fontSize: 13 }}>
        {/* ── breadcrumb ── */}
        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <Link
            href={`/companies/${encodeURIComponent(slug)}/team`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: A.textSec, fontSize: 12, textDecoration: "none" }}
          >
            <ArrowLeft size={13} />
            {company.name}
          </Link>
          <span style={{ color: A.muted, fontSize: 11 }}>/</span>
          <Link href={`/companies/${encodeURIComponent(slug)}/agents`} style={{ color: A.textSec, fontSize: 12, textDecoration: "none" }}>Agents</Link>
          <span style={{ color: A.muted, fontSize: 11 }}>/</span>
          <span style={{ color: A.accentLight, fontSize: 12, fontWeight: 600 }}>{agent.name}</span>
        </div>

        {/* ── agent header row ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, overflow: "hidden",
            border: `1px solid ${A.cardBorder}`, background: A.card,
            display: "grid", placeItems: "center", fontSize: 18, flexShrink: 0,
          }}>
            {agent.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={agent.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : agent.emoji}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", color: A.text }}>{agent.name}</h1>
              <button
                type="button"
                onClick={() => setAvatarWizardOpen(true)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 500,
                  border: "1px solid rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.08)",
                  color: "#a78bfa", cursor: "pointer",
                }}
              >
                <Sparkles size={12} /> Edit Avatar
              </button>
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
            <p style={{ margin: "2px 0 0", color: A.textSec, fontSize: 12 }}>{agent.role}</p>
          </div>

          {/* quick stats */}
          <div style={{ display: "flex", gap: 16, fontSize: 11, color: A.textSec, flexShrink: 0, flexWrap: "wrap" }}>
            <StatInline icon={<ListChecks size={12} />} label="Tasks" value={String(currentTasks.length)} />
            <StatInline icon={<Zap size={12} />} label="Runs" value={String(executionHistory.length)} />
            <StatInline icon={<Clock3 size={12} />} label="Runtime" value={`${agent.totalRuntimeMinutes ?? 0}m`} />
            <StatInline
              icon={agent.lastHeartbeat ? <Wifi size={12} /> : <WifiOff size={12} />}
              label="Heartbeat"
              value={agent.lastHeartbeat ? formatAge(agent.lastHeartbeat) : "\u2014"}
            />
          </div>

          {/* action buttons */}
          <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
            <ActionBtn icon={<Plus size={13} />} label="Assign Task" onClick={() => {}} />
            <ActionBtn icon={<HeartPulse size={13} />} label="Heartbeat" onClick={handleHeartbeat} />
            <ActionBtn
              icon={agent.status === "paused" ? <PlayCircle size={13} /> : <PauseCircle size={13} />}
              label={agent.status === "paused" ? "Resume" : "Pause"}
              onClick={() => {}}
            />
            <AgentOverflowMenu agentId={agent.id} openclawAgentId={agent.openclawAgentId} />
          </div>
        </div>

        {/* ── config row ── */}
        <div style={{
          display: "flex", gap: 12, marginBottom: 0, flexWrap: "wrap",
          padding: "8px 12px", borderRadius: "8px 8px 0 0",
          background: A.card, border: `1px solid ${A.cardBorder}`,
          borderBottom: "none",
          fontSize: 11, color: A.textSec,
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Bot size={12} style={{ color: A.accent }} /> {agent.model ?? "\u2014"}
          </span>
          <span style={{ color: A.muted }}>|</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Cpu size={12} style={{ color: A.accent }} /> {agent.status}
          </span>
          {agent.personality && (
            <>
              <span style={{ color: A.muted }}>|</span>
              <span style={{ maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {agent.personality}
              </span>
            </>
          )}
        </div>

        {/* ── tab bar ── */}
        <div style={{
          display: "flex", gap: 0,
          borderBottom: `1px solid ${A.cardBorder}`,
          background: A.card,
          borderLeft: `1px solid ${A.cardBorder}`,
          borderRight: `1px solid ${A.cardBorder}`,
          borderRadius: "0 0 0 0",
          marginBottom: 16,
        }}>
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <Link
                key={tab.id}
                href={`${basePath}/${tab.id}`}
                style={{
                  padding: "10px 18px",
                  fontSize: 12,
                  fontWeight: active ? 600 : 400,
                  color: active ? A.accentLight : A.textSec,
                  textDecoration: "none",
                  borderBottom: active ? `2px solid ${A.accentLight}` : "2px solid transparent",
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
            agentId={agentId}
            onSaved={() => { setAvatarWizardOpen(false); void load(); }}
          />
        )}
      </div>
    </AgentContext.Provider>
  );
}

/* ── tiny components ── */
function StatInline({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {icon}
      <span style={{ color: A.muted }}>{label}</span>
      <span style={{ color: A.text, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

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
          width: 32, height: 32, borderRadius: 6,
          background: open ? "rgba(217,119,6,0.20)" : "rgba(217,119,6,0.10)",
          border: `1px solid ${open ? A.cardBorderHover : A.cardBorder}`,
          color: A.accentLight, cursor: "pointer",
          transition: "background 0.15s, border-color 0.15s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(217,119,6,0.20)"; e.currentTarget.style.borderColor = A.cardBorderHover; }}
        onMouseLeave={(e) => { if (!open) { e.currentTarget.style.background = "rgba(217,119,6,0.10)"; e.currentTarget.style.borderColor = A.cardBorder; } }}
      >
        <MoreHorizontal size={15} />
      </button>
      {copied && (
        <span style={{
          position: "absolute", top: -28, right: 0,
          background: A.card, border: `1px solid ${A.cardBorder}`,
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
            background: A.card, border: `1px solid ${A.cardBorder}`,
            borderRadius: 8, padding: "4px 0", minWidth: 180,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)", zIndex: 99,
          }}>
            <button
              onClick={handleCopy}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "8px 12px", border: "none",
                background: "transparent", color: A.text, fontSize: 12,
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(217,119,6,0.12)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <Copy size={13} style={{ color: A.textSec }} /> Copy Agent ID
            </button>
            <button
              onClick={() => { setOpen(false); /* TODO: reset sessions */ }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "8px 12px", border: "none",
                background: "transparent", color: A.text, fontSize: 12,
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(217,119,6,0.12)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <RotateCcw size={13} style={{ color: A.textSec }} /> Reset Sessions
            </button>
            <div style={{ height: 1, margin: "4px 8px", background: "rgba(120,113,108,0.25)" }} />
            <button
              onClick={() => { setOpen(false); /* TODO: terminate */ }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "8px 12px", border: "none",
                background: "transparent", color: "#ef4444", fontSize: 12,
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.10)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <Trash2 size={13} style={{ color: "#ef4444" }} /> Terminate
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ActionBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "6px 12px", borderRadius: 6,
        background: "rgba(217,119,6,0.10)", border: `1px solid ${A.cardBorder}`,
        color: A.accentLight, fontSize: 11, fontWeight: 500,
        cursor: "pointer", transition: "background 0.15s, border-color 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(217,119,6,0.20)";
        e.currentTarget.style.borderColor = A.cardBorderHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(217,119,6,0.10)";
        e.currentTarget.style.borderColor = A.cardBorder;
      }}
    >
      {icon}
      {label}
    </button>
  );
}
