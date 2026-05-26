"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { DIVISIONS, getAgentByAnyId } from "@/config/agents";
import { listCompanies, listCompanyAgents } from "@/lib/orchestration/client";
import type { OrchestrationAgent, OrchestrationCompany } from "@/lib/orchestration/types";
import { P as tokens } from "@/lib/ui/tokens";

/* ─── Palette (from shared tokens) ─── */
const P = {
  bg: tokens.bg,
  surface: tokens.surface,
  card: tokens.surface,
  cardBorder: tokens.cardBorder,
  text: tokens.text,
  textSec: tokens.textSec,
  muted: tokens.muted,
  accent: tokens.accent,
};

/* ─── Types ─── */
type OrgNode = {
  id: string;
  name: string;
  role: string;
  emoji: string;
  avatar?: string;
  status: OrchestrationAgent["status"];
  managerId?: string;
  providerLabel: string;
  departmentColor: string;
};

/* ─── Page ─── */
export default function CompanyOrgPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const companies = await listCompanies();
        const slugKey = slug.toLowerCase();
        const current = companies.find(
          (c) => c.slug.toLowerCase() === slugKey || c.code.toLowerCase() === slugKey
        ) ?? null;
        const companyAgents = current ? await listCompanyAgents(current.slug) : [];
        if (cancelled) return;
        setCompany(current);
        setAgents(companyAgents);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [slug]);

  const org = useMemo(() => buildOrg(agents), [agents]);

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 200, borderRadius: 8, background: P.card, border: `0.5px solid ${P.cardBorder}`, animation: "pulse 1.5s infinite" }} />
      </div>
    );
  }

  if (!company) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ padding: 16, borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "0.5px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
          Company not found.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1400, color: P.text, fontSize: 13 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h1 style={{
          margin: 0, fontSize: 17, fontWeight: 600,
          letterSpacing: "-0.01em",
          color: P.text, fontFamily: "var(--font-heading)",
        }}>
          Org Chart
        </h1>
        <div style={{ display: "flex", gap: 6 }}>
          <HeaderButton icon={<Upload size={13} />} label="Import company" href={`/companies/${encodeURIComponent(slug)}/import`} />
          <HeaderButton icon={<Download size={13} />} label="Export company" href={`/companies/${encodeURIComponent(slug)}/export`} />
        </div>
      </div>

      {/* Canvas */}
      <OrgCanvas org={org} slug={slug} />
    </div>
  );
}

/* ─── Header button ─── */
function HeaderButton({ icon, label, href, disabled }: { icon: React.ReactNode; label: string; href?: string; disabled?: boolean }) {
  const router = useRouter();
  return (
    <button
      type="button"
      title={disabled ? `${label} — not yet available` : label}
      disabled={disabled}
      onClick={href && !disabled ? () => router.push(href) : undefined}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "6px 14px", borderRadius: 6,
        background: P.surface, border: `0.5px solid ${P.cardBorder}`,
        color: disabled ? P.muted : P.text, fontSize: 12, fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer", transition: "border-color 0.15s",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = P.cardBorder; }}
    >
      {icon}
      {label}
    </button>
  );
}

/* ─── Zoomable / Pannable Canvas ─── */
const CARD_W = 180;
const CARD_H = 100;
const GAP_X = 24;
const GAP_Y = 60;

type LayoutNode = OrgNode & { x: number; y: number };

function layoutTree(org: ReturnType<typeof buildOrg>): { nodes: LayoutNode[]; width: number; height: number } {
  if (org.levels.length === 0) return { nodes: [], width: 0, height: 0 };

  const laid: LayoutNode[] = [];
  let maxWidth = 0;

  for (let lvl = 0; lvl < org.levels.length; lvl++) {
    const level = org.levels[lvl];
    const totalW = level.length * CARD_W + (level.length - 1) * GAP_X;
    if (totalW > maxWidth) maxWidth = totalW;
    const startX = -(totalW / 2) + CARD_W / 2;
    const y = lvl * (CARD_H + GAP_Y);

    for (let i = 0; i < level.length; i++) {
      laid.push({ ...level[i], x: startX + i * (CARD_W + GAP_X), y });
    }
  }

  const height = org.levels.length * (CARD_H + GAP_Y) - GAP_Y;
  return { nodes: laid, width: maxWidth, height };
}

function OrgCanvas({ org, slug }: { org: ReturnType<typeof buildOrg>; slug: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const layout = useMemo(() => layoutTree(org), [org]);

  const fitToView = useCallback(() => {
    const el = containerRef.current;
    if (!el || layout.nodes.length === 0) return;
    const rect = el.getBoundingClientRect();
    const padX = 80;
    const padY = 80;
    const scaleX = (rect.width - padX * 2) / (layout.width || 1);
    const scaleY = (rect.height - padY * 2) / (layout.height || 1);
    const fit = Math.min(scaleX, scaleY, 1.2);
    setScale(Math.max(0.2, Math.min(fit, 2)));
    setTranslate({ x: 0, y: 0 });
  }, [layout]);

  useEffect(() => { fitToView(); }, [fitToView]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setScale((s) => Math.max(0.15, Math.min(s + delta, 3)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };
  }, [translate]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setTranslate({
      x: dragStart.current.tx + (e.clientX - dragStart.current.x) / scale,
      y: dragStart.current.ty + (e.clientY - dragStart.current.y) / scale,
    });
  }, [dragging, scale]);

  const handleMouseUp = useCallback(() => { setDragging(false); }, []);

  // Build edges
  const nodePos = useMemo(() => {
    const m = new Map<string, LayoutNode>();
    for (const n of layout.nodes) m.set(n.id, n);
    return m;
  }, [layout.nodes]);

  const edges = useMemo(() => {
    const result: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const node of layout.nodes) {
      if (!node.managerId) continue;
      const parent = nodePos.get(node.managerId);
      if (!parent) continue;
      result.push({
        x1: parent.x,
        y1: parent.y + CARD_H / 2,
        x2: node.x,
        y2: node.y - CARD_H / 2,
      });
    }
    return result;
  }, [layout.nodes, nodePos]);

  return (
    <div style={{ position: "relative" }}>
      {/* Canvas viewport */}
      <div
        ref={containerRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          width: "100%", height: "calc(100vh - 120px)", minHeight: 400,
          borderRadius: 8, background: P.bg,
          border: `0.5px solid ${P.cardBorder}`,
          overflow: "hidden", cursor: dragging ? "grabbing" : "grab",
          position: "relative",
        }}
      >
        <div style={{
          position: "absolute",
          left: "50%", top: "50%",
          transform: `translate(-50%, -50%) scale(${scale}) translate(${translate.x}px, ${translate.y}px)`,
          transformOrigin: "center center",
          transition: dragging ? "none" : "transform 0.15s ease",
        }}>
          {/* Edges */}
          <svg
            style={{
              position: "absolute",
              left: -(layout.width / 2 + 100),
              top: -50,
              width: layout.width + 200,
              height: layout.height + 100,
              pointerEvents: "none",
            }}
          >
            {edges.map((edge, i) => {
              const cx = layout.width / 2 + 100;
              const cy = 50;
              const x1 = edge.x1 + cx;
              const y1 = edge.y1 + cy;
              const x2 = edge.x2 + cx;
              const y2 = edge.y2 + cy;
              const midY = (y1 + y2) / 2;
              return (
                <path
                  key={i}
                  d={`M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`}
                  fill="none"
                  stroke="color-mix(in srgb, var(--text-secondary) 42%, transparent)"
                  strokeWidth={1.75}
                />
              );
            })}
          </svg>

          {/* Cards */}
          {layout.nodes.map((node) => (
            <OrgCard key={node.id} node={node} slug={slug} />
          ))}
        </div>
      </div>

      {/* Zoom controls */}
      <div style={{
        position: "absolute", top: 12, right: 12,
        display: "flex", flexDirection: "column", gap: 2,
      }}>
        <ZoomBtn label="+" onClick={() => setScale((s) => Math.min(s + 0.15, 3))} />
        <ZoomBtn label="-" onClick={() => setScale((s) => Math.max(s - 0.15, 0.15))} />
        <ZoomBtn label="Fit" onClick={fitToView} small />
      </div>
    </div>
  );
}

function ZoomBtn({ label, onClick, small }: { label: string; onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      style={{
        width: 32, height: small ? 28 : 32,
        borderRadius: 4, border: `0.5px solid ${P.cardBorder}`,
        background: P.surface, color: P.text,
        fontSize: small ? 10 : 14, fontWeight: 600,
        cursor: "pointer", display: "grid", placeItems: "center",
        transition: "border-color 0.15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = P.cardBorder; }}
    >
      {label}
    </button>
  );
}

/* ─── Agent Card ─── */
function OrgCard({ node, slug }: { node: LayoutNode; slug: string }) {
  const statusColor = statusDotColor(node.status);

  return (
    <Link
      href={`/companies/${encodeURIComponent(slug)}/agents/${encodeURIComponent(node.id)}`}
      style={{
        position: "absolute",
        left: node.x - CARD_W / 2,
        top: node.y - CARD_H / 2,
        width: CARD_W,
        height: CARD_H,
        borderRadius: 8,
        background: P.card,
        border: `0.5px solid ${P.cardBorder}`,
        padding: "12px 14px",
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        textDecoration: "none",
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
        e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.4)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = P.cardBorder;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {/* Icon */}
      <div style={{
        width: 28, height: 28, borderRadius: 6, flexShrink: 0,
        background: "rgba(255,255,255,0.06)", border: `0.5px solid ${P.cardBorder}`,
        display: "grid", placeItems: "center", fontSize: 14,
        overflow: "hidden",
      }}>
        {node.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={node.avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <AvatarGlyph value={node.emoji} size={14} fallback="" />
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: P.text,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          fontFamily: "var(--font-heading)",
        }}>
          {node.name}
        </div>
        <div style={{
          fontSize: 10, color: P.textSec, marginTop: 2,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden", lineHeight: 1.3,
        }}>
          {node.role}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            backgroundColor: statusColor,
            boxShadow: node.status === "working" ? `0 0 6px ${statusColor}` : "none",
            flexShrink: 0,
          }} />
          <span style={{
            fontSize: 9, color: P.muted, fontWeight: 500,
            fontFamily: "var(--font-body)",
          }}>
            {node.providerLabel}
          </span>
        </div>
      </div>
    </Link>
  );
}

/* ─── Org Builder ─── */
function buildOrg(agents: OrchestrationAgent[]) {
  const nodeById = new Map<string, OrgNode>();
  const keyToId = new Map<string, string>();

  for (const agent of agents) {
    const config = getAgentByAnyId(agent.id) ?? getAgentByAnyId(agent.name);
    const division = config?.division ?? "Leadership";
    const divisionMeta = DIVISIONS[division] ?? { label: "Operations", color: "#94a3b8", icon: "" };

    const providerLabel = providerLabelForAgent(agent);

    const node: OrgNode = {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      emoji: agent.emoji,
      avatar: agent.avatar,
      status: agent.status,
      providerLabel,
      departmentColor: divisionMeta.color,
    };

    nodeById.set(node.id, node);
    indexNodeKeys(agent, keyToId);
  }

  const ceoNodes = Array.from(nodeById.values()).filter(isCeo);
  const defaultLeadId = ceoNodes[0]?.id;

  for (const agent of agents) {
    const node = nodeById.get(agent.id);
    if (!node) continue;

    const config = getAgentByAnyId(agent.id) ?? getAgentByAnyId(agent.name);
    const configuredManager = config?.reportsTo;
    const managerId =
      resolveManagerId(agent.reportingTo, keyToId) ??
      resolveManagerId(configuredManager, keyToId);

    if (managerId && managerId !== node.id) {
      node.managerId = managerId;
      continue;
    }

    if (!isCeo(node) && defaultLeadId && defaultLeadId !== node.id) {
      node.managerId = defaultLeadId;
    }
  }

  const childrenById = new Map<string, OrgNode[]>();
  for (const node of nodeById.values()) {
    if (!node.managerId) continue;
    const existing = childrenById.get(node.managerId) ?? [];
    existing.push(node);
    childrenById.set(node.managerId, existing);
  }

  const roots = Array.from(nodeById.values()).filter(
    (node) => !node.managerId || !nodeById.has(node.managerId)
  );
  roots.sort(sortNodes);

  const levels: OrgNode[][] = [];
  const visited = new Set<string>();
  let frontier = roots;

  while (frontier.length > 0) {
    const nextLevel: OrgNode[] = [];
    const uniqueLevel = frontier.filter((node) => {
      if (visited.has(node.id)) return false;
      visited.add(node.id);
      return true;
    });

    if (uniqueLevel.length > 0) {
      uniqueLevel.sort(sortNodes);
      levels.push(uniqueLevel);
      for (const node of uniqueLevel) {
        const children = childrenById.get(node.id) ?? [];
        nextLevel.push(...children);
      }
    }

    frontier = nextLevel;
  }

  for (const node of nodeById.values()) {
    if (visited.has(node.id)) continue;
    levels.push([node]);
  }

  return {
    levels,
    childrenById,
    rootCount: roots.length,
    edgeCount: Array.from(nodeById.values()).filter((n) => Boolean(n.managerId)).length,
    totalAgents: nodeById.size,
  };
}

function sortNodes(a: OrgNode, b: OrgNode) {
  if (isCeo(a) && !isCeo(b)) return -1;
  if (!isCeo(a) && isCeo(b)) return 1;
  return a.name.localeCompare(b.name);
}

function isCeo(node: Pick<OrgNode, "role">) {
  return node.role.toLowerCase().includes("ceo") || node.role.toLowerCase().includes("co-founder");
}

function providerLabelForAgent(agent: OrchestrationAgent) {
  const provider = agent.adapterType?.trim().toLowerCase();
  switch (provider) {
    case "openclaw":
      return "OpenClaw";
    case "codex":
      return "OpenAI";
    case "anthropic":
      return "Anthropic";
    case "gemini":
      return "Gemini";
    case "hermes":
      return "Hermes";
    case "manual":
      return "Manual";
    default:
      return agent.model?.trim() || "Runtime";
  }
}

function indexNodeKeys(agent: OrchestrationAgent, keyToId: Map<string, string>) {
  const keys = [agent.id, agent.name, trimLabel(agent.name), agent.openclawAgentId]
    .filter(Boolean)
    .map((v) => normalizeKey(String(v)));
  for (const key of keys) keyToId.set(key, agent.id);
}

function resolveManagerId(candidate: string | undefined, keyToId: Map<string, string>) {
  if (!candidate) return undefined;
  return keyToId.get(normalizeKey(candidate)) ?? keyToId.get(normalizeKey(trimLabel(candidate)));
}

function trimLabel(value: string) {
  return value.replace(/\(.*?\)/g, "").replace(/[^\x00-\x7F]/g, "").trim();
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function statusDotColor(status: OrchestrationAgent["status"]): string {
  const map: Record<OrchestrationAgent["status"], string> = {
    working: "#22c55e",
    idle: "#d97706",
    paused: "#f59e0b",
    offline: "#57534e",
    error: "#ef4444",
  };
  return map[status] ?? "#57534e";
}
