"use client";

import { AgentAvatar } from "@/components/AgentAvatar";
import { getAgentByAnyId } from "@/config/agents";

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = "high" | "medium" | "low";
type PipelineStatus = "backlog" | "building" | "deployed" | "shipped";

interface Product {
  id: string;
  emoji: string;
  name: string;
  description: string;
  status: PipelineStatus;
  priority: Priority;
  tags: string[];
  agentId: string;
  color: string;
  github?: string;
  vercel?: boolean;
  isLive?: boolean;
  blocked?: string;
  timeInStage: string;
}

// ─── Product Data ─────────────────────────────────────────────────────────────

const PRODUCTS: Product[] = [
  {
    id: "mission-control",
    emoji: "⚡",
    name: "Mission Control",
    description: "Central dashboard and command center",
    status: "deployed",
    priority: "high",
    tags: ["Next.js", "React", "Tailwind"],
    agentId: "pixel",
    color: "#ef4444",
    github: "https://github.com",
    vercel: true,
    isLive: true,
    timeInStage: "14d in stage",
  },
  {
    id: "snapaudit",
    emoji: "🔍",
    name: "SnapAudit",
    description: "AI website audit SaaS — needs marketing push",
    status: "deployed",
    priority: "medium",
    tags: ["Next.js", "GPT-4o", "Stripe"],
    agentId: "pixel",
    color: "#8b5cf6",
    github: "https://github.com",
    vercel: true,
    isLive: true,
    timeInStage: "5d in stage",
  },
  {
    id: "crypto-trading",
    emoji: "₿",
    name: "Crypto Trading Bot",
    description: "Automated crypto trading with CCXT",
    status: "building",
    priority: "high",
    tags: ["Python", "CCXT", "FastAPI", "Docker"],
    agentId: "cipher",
    color: "#f59e0b",
    github: "https://github.com",
    vercel: false,
    timeInStage: "12h in stage",
  },
  {
    id: "weather-trading",
    emoji: "🌤️",
    name: "Weather Trading Bot",
    description: "Weather prediction on Kalshi",
    status: "building",
    priority: "high",
    tags: ["Python", "scikit-learn", "SQLite"],
    agentId: "nimbus",
    color: "#06b6d4",
    github: "https://github.com",
    timeInStage: "8h in stage",
  },
  {
    id: "stock-options",
    emoji: "📈",
    name: "Stock & Options Trading",
    description: "Options-first trading system",
    status: "backlog",
    priority: "high",
    tags: ["Python", "Polygon", "FastAPI"],
    agentId: "atlas",
    color: "#10b981",
    github: "https://github.com",
    blocked: "Blocked on API key",
    timeInStage: "3d in stage",
  },
  {
    id: "advisory-board",
    emoji: "🧠",
    name: "Advisory Board",
    description: "Multi-agent roundtable discussions",
    status: "building",
    priority: "high",
    tags: ["Next.js", "React", "WebSocket"],
    agentId: "pixel",
    color: "#6366f1",
    github: "https://github.com",
    timeInStage: "1d in stage",
  },
  {
    id: "idea-intake",
    emoji: "💡",
    name: "Idea Intake Pipeline",
    description: "Capture and track ideas from any source",
    status: "building",
    priority: "high",
    tags: ["Next.js", "TypeScript"],
    agentId: "scout",
    color: "#ec4899",
    github: "https://github.com",
    timeInStage: "2d in stage",
  },
];

// ─── Agent-to-Product mapping ────────────────────────────────────────────────

interface AgentSprite {
  agentId: string;
  agentName: string;
  productName: string;
  status: "building" | "deployed";
  model: string;
  animDelay: number;
}

function getActiveAgentSprites(): AgentSprite[] {
  const activeProducts = PRODUCTS.filter(
    (p) => p.status === "building" || p.status === "deployed"
  );

  const sprites: AgentSprite[] = [];
  let delayIndex = 0;

  for (const product of activeProducts) {
    const agent = getAgentByAnyId(product.agentId);
    const name = agent?.name?.replace(/\s*[^\w\s].*$/, "") ?? product.agentId;
    // Assign models based on agent/task type
    const MODEL_MAP: Record<string, string> = {
      pixel: "Sonnet 4.6",
      cipher: "Sonnet 4.6",
      nimbus: "Sonnet 4.6",
      atlas: "Sonnet 4.6",
      scout: "Gemini Pro",
      henry: "Opus 4.6",
      forge: "Opus 4.6",
      quill: "Sonnet 4.6",
    };
    sprites.push({
      agentId: product.agentId,
      agentName: name,
      productName: product.name,
      status: product.status as "building" | "deployed",
      model: MODEL_MAP[product.agentId] || "Sonnet 4.6",
      animDelay: delayIndex * 0.4,
    });
    delayIndex++;
  }

  return sprites;
}

// ─── Pipeline Columns ─────────────────────────────────────────────────────────

const COLUMNS: {
  id: PipelineStatus;
  label: string;
  emoji: string;
  accent: string;
}[] = [
  { id: "backlog", label: "Backlog", emoji: "📋", accent: "#6366f1" },
  { id: "building", label: "Building", emoji: "🔨", accent: "#f59e0b" },
  { id: "deployed", label: "Deployed", emoji: "🚀", accent: "#06b6d4" },
  { id: "shipped", label: "Shipped ✅", emoji: "🟢", accent: "#10b981" },
];

const PRIORITY_BADGES: Record<Priority, { icon: string; color: string }> = {
  high: { icon: "🔴", color: "#ef4444" },
  medium: { icon: "🟡", color: "#f59e0b" },
  low: { icon: "🟢", color: "#22c55e" },
};

// ─── Conveyor Belt ────────────────────────────────────────────────────────────

function ConveyorBelt() {
  const boxes = [
    { color: "#8b5cf6", delay: 0 },
    { color: "#6366f1", delay: 2.5 },
    { color: "#f59e0b", delay: 5 },
    { color: "#06b6d4", delay: 7.5 },
    { color: "#10b981", delay: 10 },
    { color: "#ec4899", delay: 12.5 },
    { color: "#ef4444", delay: 15 },
    { color: "#8b5cf6", delay: 17.5 },
  ];

  return (
    <div className="relative w-full my-4 overflow-hidden" style={{ height: 36 }}>
      {/* Track */}
      <div
        className="absolute inset-x-0 rounded-full"
        style={{
          top: 14,
          height: 8,
          background:
            "linear-gradient(90deg, #1e1b4b 0%, #312e81 25%, #4338ca 50%, #312e81 75%, #1e1b4b 100%)",
          boxShadow: "0 0 12px rgba(99,102,241,0.15)",
        }}
      />
      {/* Animated dashes on the track */}
      <div
        className="absolute inset-x-0 rounded-full"
        style={{
          top: 14,
          height: 8,
          backgroundImage:
            "repeating-linear-gradient(90deg, transparent 0px, transparent 12px, rgba(99,102,241,0.25) 12px, rgba(99,102,241,0.25) 24px)",
          backgroundSize: "24px 8px",
          animation: "conveyor-dash 0.8s linear infinite",
        }}
      />
      {/* Sliding boxes */}
      {boxes.map((box, i) => (
        <div
          key={i}
          className="absolute rounded-sm"
          style={{
            width: 18,
            height: 18,
            top: 9,
            backgroundColor: box.color,
            boxShadow: `0 0 10px ${box.color}88, 0 0 4px ${box.color}44`,
            animation: `conveyor-slide 20s linear infinite`,
            animationDelay: `${box.delay}s`,
            transform: "translateX(-24px)",
            opacity: 0.85,
            borderRadius: 3,
          }}
        />
      ))}
    </div>
  );
}

// ─── Agent Sprite ─────────────────────────────────────────────────────────────

function AgentSpriteComponent({ sprite }: { sprite: AgentSprite }) {
  const isBuilding = sprite.status === "building";
  const glowColor = isBuilding ? "#22c55e" : "#3b82f6";

  return (
    <div
      className="group relative flex flex-col items-center"
      style={{ minWidth: 72 }}
    >
      {/* Status label */}
      <div
        className="mb-1.5"
        style={{
          fontSize: 10,
          color: glowColor,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.03em",
          whiteSpace: "nowrap",
        }}
      >
        {isBuilding ? (
          <span className="inline-flex items-center gap-0.5">
            building
            <span style={{ animation: "ellipsis-anim 1.4s steps(4, end) infinite" }}>
              ...
            </span>
          </span>
        ) : (
          <span>✅ monitoring</span>
        )}
      </div>

      {/* Avatar with glow ring + bobbing */}
      <div
        className="relative"
        style={{
          animation: `agent-bob 3s ease-in-out infinite`,
          animationDelay: `${sprite.animDelay}s`,
        }}
      >
        {/* Glow ring */}
        <div
          className="absolute rounded-full"
          style={{
            inset: -4,
            border: `2px solid ${glowColor}66`,
            boxShadow: `0 0 10px ${glowColor}44, inset 0 0 6px ${glowColor}22`,
            animation: `glow-pulse 2.5s ease-in-out infinite`,
            animationDelay: `${sprite.animDelay * 0.7}s`,
            borderRadius: "50%",
          }}
        />
        <AgentAvatar agentId={sprite.agentId} size={38} borderWidth={2} />
      </div>

      {/* Agent name */}
      <div
        className="mt-1.5"
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#e2e8f0",
          fontFamily: "var(--font-heading, var(--font-body))",
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        {sprite.agentName}
      </div>

      {/* Product name */}
      <div
        style={{
          fontSize: 9,
          color: "rgba(148,163,184,0.7)",
          fontFamily: "var(--font-mono)",
          textAlign: "center",
          whiteSpace: "nowrap",
          marginTop: 1,
        }}
      >
        {sprite.productName}
      </div>

      {/* Model badge */}
      <div
        style={{
          fontSize: 8,
          fontWeight: 600,
          color: "rgba(167,139,250,0.9)",
          fontFamily: "var(--font-mono)",
          textAlign: "center",
          whiteSpace: "nowrap",
          marginTop: 3,
          padding: "1px 6px",
          borderRadius: 4,
          backgroundColor: "rgba(139,92,246,0.12)",
          border: "1px solid rgba(139,92,246,0.2)",
          letterSpacing: "0.5px",
        }}
      >
        {sprite.model}
      </div>

      {/* Hover tooltip */}
      <div
        className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50"
        style={{
          padding: "6px 10px",
          backgroundColor: "rgba(15,23,42,0.95)",
          border: "1px solid rgba(99,102,241,0.3)",
          borderRadius: 8,
          fontSize: 11,
          color: "#e2e8f0",
          fontFamily: "var(--font-mono)",
          whiteSpace: "nowrap",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}
      >
        {sprite.agentName} — working on {sprite.productName} ({sprite.model})
      </div>
    </div>
  );
}

// ─── Workshop Floor ───────────────────────────────────────────────────────────

function WorkshopFloor() {
  const sprites = getActiveAgentSprites();

  return (
    <div
      className="mx-6 mb-4 rounded-xl overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, rgba(30,27,75,0.5) 0%, rgba(15,23,42,0.6) 100%)",
        border: "1px solid rgba(99,102,241,0.15)",
        padding: "14px 20px 16px",
      }}
    >
      {/* Section label */}
      <div
        className="flex items-center gap-2 mb-3"
        style={{
          fontSize: 11,
          color: "rgba(199,210,254,0.5)",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        <span style={{ fontSize: 13 }}>🤖</span>
        Workshop Floor — Active Agents
      </div>

      {/* Agent sprites row */}
      <div className="flex items-start gap-6 overflow-x-auto pb-1">
        {sprites.map((sprite) => (
          <AgentSpriteComponent
            key={`${sprite.agentId}-${sprite.productName}`}
            sprite={sprite}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Product Card ─────────────────────────────────────────────────────────────

function ProductCard({ product }: { product: Product }) {
  const badge = PRIORITY_BADGES[product.priority];

  return (
    <div
      className="group rounded-xl transition-all duration-200 hover:-translate-y-0.5"
      style={{
        backgroundColor: "var(--surface-elevated, #1a1a2e)",
        border: "1px solid var(--border, #2a2a2a)",
        borderLeft: `4px solid ${product.color}`,
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        padding: "16px 16px 14px",
        cursor: "default",
        overflow: "hidden",
      }}
    >
      {/* Top: Emoji + Name + Priority */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl flex-shrink-0">{product.emoji}</span>
          <span
            className="font-bold truncate"
            style={{
              fontSize: 15,
              color: "var(--text-primary)",
              fontFamily: "var(--font-heading, var(--font-body))",
            }}
          >
            {product.name}
          </span>
        </div>
        <span
          className="flex-shrink-0 text-xs rounded-full px-1.5 py-0.5"
          style={{
            backgroundColor: `${badge.color}18`,
            border: `1px solid ${badge.color}44`,
          }}
          title={`${product.priority} priority`}
        >
          {badge.icon}
        </span>
      </div>

      {/* Description */}
      <p
        className="mb-2.5"
        style={{
          fontSize: 12,
          color: "var(--text-secondary)",
          margin: "0 0 10px",
          lineHeight: 1.4,
        }}
      >
        {product.description}
      </p>

      {/* Tech Tags */}
      <div className="flex flex-wrap gap-1 mb-3">
        {product.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full"
            style={{
              fontSize: 10,
              padding: "2px 8px",
              backgroundColor: "var(--surface, #1a1a1a)",
              border: "1px solid var(--border, #2a2a2a)",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              lineHeight: 1.5,
            }}
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Blocked badge */}
      {product.blocked && (
        <div
          className="flex items-center gap-1.5 rounded-md mb-2.5 text-xs"
          style={{
            padding: "4px 8px",
            backgroundColor: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
            color: "#ef4444",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
          }}
        >
          🚫 {product.blocked}
        </div>
      )}

      {/* Bottom row: Status icons + time + agent */}
      <div className="flex items-center gap-2 mt-auto">
        {/* Status icons */}
        <div className="flex items-center gap-1.5">
          {product.github && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="var(--text-muted)"
              title="GitHub"
              className="opacity-60"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          )}
          {product.vercel && (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="var(--text-muted)"
              title="Vercel"
              className="opacity-60"
            >
              <path d="M12 1L24 22H0L12 1z" />
            </svg>
          )}
          {product.isLive && (
            <span
              className="rounded-full inline-block"
              style={{
                width: 8,
                height: 8,
                backgroundColor: "#10b981",
                boxShadow: "0 0 6px #10b98188",
                animation: "pulse-glow 2s ease-in-out infinite",
              }}
              title="Live"
            />
          )}
        </div>

        {/* Time in stage */}
        <span
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            marginLeft: "auto",
          }}
        >
          {product.timeInStage}
        </span>

        {/* Agent avatar */}
        <AgentAvatar agentId={product.agentId} size={24} borderWidth={1.5} />
      </div>
    </div>
  );
}

// ─── Kanban Column ────────────────────────────────────────────────────────────

function KanbanColumn({
  column,
  products,
}: {
  column: (typeof COLUMNS)[number];
  products: Product[];
}) {
  return (
    <div className="flex flex-col min-w-[240px] flex-1">
      {/* Column header */}
      <div
        className="flex items-center gap-2 mb-3 px-1"
        style={{ borderBottom: `2px solid ${column.accent}44`, paddingBottom: 8 }}
      >
        <span className="text-base">{column.emoji}</span>
        <span
          className="font-bold uppercase tracking-wide"
          style={{
            fontSize: 12,
            color: column.accent,
            fontFamily: "var(--font-mono)",
          }}
        >
          {column.label}
        </span>
        <span
          className="rounded-full text-xs font-bold"
          style={{
            padding: "1px 8px",
            backgroundColor: `${column.accent}18`,
            color: column.accent,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            marginLeft: "auto",
          }}
        >
          {products.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-4">
        {products.length === 0 ? (
          <div
            className="text-center py-8 rounded-lg"
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              border: "1px dashed var(--border)",
              opacity: 0.5,
            }}
          >
            No products
          </div>
        ) : (
          products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SoftwareFactoryPage() {
  // Compute stats
  const statsByStatus: Record<PipelineStatus, Product[]> = {
    backlog: [],
    building: [],
    deployed: [],
    shipped: [],
  };
  for (const p of PRODUCTS) {
    statsByStatus[p.status].push(p);
  }

  const shipped = statsByStatus.shipped.length;
  const deployed = statsByStatus.deployed.length;
  const building = statsByStatus.building.length;
  const backlog = statsByStatus.backlog.length;
  const liveRevenue = PRODUCTS.filter((p) => p.isLive).length;

  const STATS = [
    { label: "Shipped", value: shipped, icon: "🚀", color: "#10b981" },
    { label: "Deployed", value: deployed, icon: "🌐", color: "#06b6d4" },
    { label: "Building", value: building, icon: "🔨", color: "#f59e0b" },
    { label: "Backlog", value: backlog, icon: "📋", color: "#6366f1" },
    { label: "Products Live", value: liveRevenue, icon: "💰", color: "#ec4899" },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      {/* CSS Animations */}
      <style>{`
        @keyframes conveyor-slide {
          0% { transform: translateX(-24px); opacity: 0; }
          3% { opacity: 0.85; }
          97% { opacity: 0.85; }
          100% { transform: translateX(calc(100vw + 24px)); opacity: 0; }
        }
        @keyframes conveyor-dash {
          0% { background-position: 0 0; }
          100% { background-position: 24px 0; }
        }
        @keyframes pulse-glow {
          0%, 100% { opacity: 1; box-shadow: 0 0 6px #10b98188; }
          50% { opacity: 0.6; box-shadow: 0 0 12px #10b981aa; }
        }
        @keyframes agent-bob {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2.5px); }
        }
        @keyframes glow-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
        @keyframes ellipsis-anim {
          0% { content: ''; width: 0; }
          25% { width: 0.3em; }
          50% { width: 0.6em; }
          75% { width: 0.9em; }
          100% { width: 0.9em; }
        }
      `}</style>

      {/* ── Stats Bar ──────────────────────────────────────────────────────── */}
      <div
        className="px-6 pt-6 pb-4"
        style={{
          background:
            "linear-gradient(135deg, #1e1b4b 0%, #312e81 30%, #3730a3 60%, #1e1b4b 100%)",
          borderBottom: "1px solid rgba(99,102,241,0.2)",
        }}
      >
        {/* Title */}
        <div className="mb-5">
          <h1
            className="m-0 flex items-center gap-2"
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: "#fff",
              fontFamily: "var(--font-heading, var(--font-body))",
              letterSpacing: "-0.02em",
            }}
          >
            🏭 Software Factory
          </h1>
          <p
            className="m-0 mt-1"
            style={{
              fontSize: 13,
              color: "rgba(199,210,254,0.7)",
              fontFamily: "var(--font-mono)",
            }}
          >
            From idea to shipped product
          </p>
        </div>

        {/* Stat Cards */}
        <div className="flex gap-3 flex-wrap">
          {STATS.map((stat) => (
            <div
              key={stat.label}
              className="flex items-center gap-3 rounded-xl flex-1 min-w-[150px]"
              style={{
                padding: "12px 16px",
                backgroundColor: "rgba(0,0,0,0.25)",
                border: "1px solid rgba(99,102,241,0.2)",
                backdropFilter: "blur(8px)",
              }}
            >
              <span className="text-xl">{stat.icon}</span>
              <div>
                <div
                  className="font-extrabold"
                  style={{
                    fontSize: 22,
                    color: stat.color,
                    fontFamily: "var(--font-mono)",
                    lineHeight: 1,
                  }}
                >
                  {stat.value}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "rgba(199,210,254,0.5)",
                    fontFamily: "var(--font-mono)",
                    marginTop: 2,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {stat.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Conveyor Belt ──────────────────────────────────────────────────── */}
      <div className="px-6">
        <ConveyorBelt />
      </div>

      {/* ── Workshop Floor — Animated Agent Sprites ────────────────────────── */}
      <WorkshopFloor />

      {/* ── Kanban Columns ─────────────────────────────────────────────────── */}
      <div className="px-6 pb-8">
        <div
          className="grid gap-6"
          style={{
            gridTemplateColumns: "repeat(4, 1fr)",
            minWidth: 0,
          }}
        >
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.id}
              column={col}
              products={statsByStatus[col.id]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
