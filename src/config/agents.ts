/**
 * agents.ts — Single source of truth for all Harris Autonomous agent configs.
 * Maps agent IDs to avatar paths, names, emojis, roles, divisions, colors, and descriptions.
 * Used throughout Mission Control: /agents, /advisory, /, /office, activity feed, etc.
 */

export interface AgentConfig {
  /** Canonical kebab-case ID */
  id: string;
  /** Display name */
  name: string;
  /** Emoji identifier */
  emoji: string;
  /** Full role title */
  role: string;
  /** Division name */
  division: "Leadership" | "Trading" | "Engineering" | "Research" | "Creative" | "Legal";
  /** Division accent color (hex) */
  divisionColor: string;
  /** Path to avatar image (relative to /public) */
  avatar: string;
  /** Short description / mission */
  description: string;
  /** Model (TBD for undeployed agents) */
  model: string;
  /** Who this agent reports to */
  reportsTo: string;
}

export const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: "henry",
    name: "Henry",
    emoji: "⚡",
    role: "Chief of Staff / Orchestrator",
    division: "Leadership",
    divisionColor: "#f59e0b",
    avatar: "/avatars/henry.jpg",
    description:
      "Orchestrates all agents, assigns work, tracks progress. Delivers morning briefs, status reports, and proactive alerts. The nerve center of Harris Autonomous.",
    model: "claude-opus-4-6",
    reportsTo: "Tim Harris (CEO)",
  },
  {
    id: "t1",
    name: "Atlas 📈",
    emoji: "📈",
    role: "Stocks & Options Trader",
    division: "Trading",
    divisionColor: "#10b981",
    avatar: "/avatars/t1.jpg",
    description:
      "Stock screening and analysis, options strategy development, trade signal generation, and portfolio monitoring. Will manage equities and derivatives positions.",
    model: "TBD",
    reportsTo: "Henry ⚡",
  },
  {
    id: "t2",
    name: "Nimbus 🌤️",
    emoji: "🌤️",
    role: "Weather Prediction Trader",
    division: "Trading",
    divisionColor: "#10b981",
    avatar: "/avatars/t2.jpg",
    description:
      "Weather data ingestion and analysis, correlation of weather patterns to market movements. Polymarket + Kalshi event contracts. Seasonal and event-driven strategy development.",
    model: "TBD",
    reportsTo: "Henry ⚡",
  },
  {
    id: "t3",
    name: "Cipher ₿",
    emoji: "₿",
    role: "Crypto Trader",
    division: "Trading",
    divisionColor: "#10b981",
    avatar: "/avatars/t3.jpg",
    description:
      "Crypto market data pipeline (CCXT), momentum and mean-reversion strategies, paper trading → live execution. Risk management and position sizing via Binance/Coinbase APIs.",
    model: "TBD",
    reportsTo: "Henry ⚡",
  },
  {
    id: "backend",
    name: "Forge 🔧",
    emoji: "🔧",
    role: "Backend Engineer",
    division: "Engineering",
    divisionColor: "#3b82f6",
    avatar: "/avatars/backend.jpg",
    description:
      "Infrastructure, databases, APIs. System reliability and monitoring. CI/CD pipelines, cost management and optimization. Circuit breakers and error recovery systems.",
    model: "TBD",
    reportsTo: "Henry ⚡",
  },
  {
    id: "fullstack",
    name: "Pixel 💻",
    emoji: "💻",
    role: "Senior Full-Stack Engineer",
    division: "Engineering",
    divisionColor: "#3b82f6",
    avatar: "/avatars/fullstack.jpg",
    description:
      "Web application development (frontend + backend). Dashboard and UI builds like Mission Control. API integrations. Rapid prototyping and shipping. Stack: Next.js, React, TypeScript, Tailwind.",
    model: "TBD",
    reportsTo: "Henry ⚡",
  },
  {
    id: "scout",
    name: "Scout",
    emoji: "🔭",
    role: "Research & Intelligence Agent",
    division: "Research",
    divisionColor: "#8b5cf6",
    avatar: "/avatars/scout.jpg",
    description:
      "Market research and opportunity identification. Tech trend monitoring, competitive intelligence. Data gathering for trading strategies. New project ideation and feasibility analysis.",
    model: "TBD",
    reportsTo: "Henry ⚡",
  },
  {
    id: "quill",
    name: "Quill",
    emoji: "✍️",
    role: "Creative Writer & Marketing Strategist",
    division: "Creative",
    divisionColor: "#ec4899",
    avatar: "/avatars/quill.jpg",
    description:
      "Marketing copy, campaigns, and strategy for Insight (Tim's company). Content writing: blogs, newsletters, social media. Brand voice development. Ad copy, landing pages, email sequences.",
    model: "TBD",
    reportsTo: "Henry ⚡",
  },
  {
    id: "counsel",
    name: "Counsel",
    emoji: "⚖️",
    role: "Legal Expert Agent",
    division: "Legal",
    divisionColor: "#64748b",
    avatar: "/avatars/counsel.jpg",
    description:
      "Federal and state law research and analysis. Contract review and drafting assistance. Regulatory compliance guidance (trading, apps, data privacy). Terms of service, privacy policies. IP guidance.",
    model: "TBD",
    reportsTo: "Henry ⚡",
  },
];

/** Map from canonical ID → config */
export const AGENT_MAP: Record<string, AgentConfig> = Object.fromEntries(
  AGENT_CONFIGS.map((a) => [a.id, a])
);

/**
 * Look up an agent by any of the ID variants used throughout the app.
 * Handles: "henry", "Henry", "t1", "T1", "backend-eng", "Backend", "Full-Stack", etc.
 */
export function getAgentByAnyId(id: string): AgentConfig | undefined {
  if (!id) return undefined;

  // Direct lookup first
  const direct = AGENT_MAP[id.toLowerCase()];
  if (direct) return direct;

  // Normalize and try aliases
  const normalized = id.toLowerCase().replace(/[-_\s]/g, "");

  const aliases: Record<string, string> = {
    backendeng: "backend",
    "backend-eng": "backend",
    fullstackeng: "fullstack",
    "fullstack-eng": "fullstack",
    "full-stack": "fullstack",
    fullstackengineer: "fullstack",
    backendengineer: "backend",
    "senior full-stack engineer": "fullstack",
    seniorfullstackengineer: "fullstack",
    "research & intelligence": "scout",
    researchintelligence: "scout",
    "creative writer & marketing": "quill",
    creativewritermarketing: "quill",
    "legal expert": "counsel",
    legalexpert: "counsel",
    chiefofstaff: "henry",
  };

  const aliasId = aliases[normalized] || aliases[id.toLowerCase()];
  if (aliasId) return AGENT_MAP[aliasId];

  // Fuzzy: check if any agent name starts with the query
  const lower = id.toLowerCase();
  return AGENT_CONFIGS.find(
    (a) =>
      a.name.toLowerCase() === lower ||
      a.id.toLowerCase() === lower ||
      lower.startsWith(a.id.toLowerCase()) ||
      a.id.toLowerCase().startsWith(lower)
  );
}

/** Avatar component helper — returns the avatar URL or undefined */
export function getAvatarUrl(agentId: string): string | undefined {
  return getAgentByAnyId(agentId)?.avatar;
}
