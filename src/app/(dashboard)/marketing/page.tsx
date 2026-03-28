"use client";

import { useState, useCallback } from "react";
import {
  Megaphone,
  FileText,
  Send,
  Calendar,
  TrendingUp,
  Eye,
  Linkedin,
  Twitter,
  Sparkles,
  ChevronRight,
  Clock,
  CheckCircle2,
  Edit3,
  BarChart3,
  Target,
  Zap,
  ExternalLink,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────
interface BlogPost {
  id: string;
  title: string;
  status: "draft" | "review" | "scheduled" | "published";
  author: string;
  date: string;
  tags: string[];
}

interface SocialPost {
  id: string;
  platform: "linkedin" | "twitter";
  content: string;
  scheduledDate: string;
  status: "draft" | "scheduled" | "posted";
}

interface Campaign {
  id: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  status: "planning" | "active" | "completed";
  reach?: number;
}

interface CompetitorEntry {
  name: string;
  recentMove: string;
  threat: "low" | "medium" | "high";
  lastChecked: string;
}

// ── Data ────────────────────────────────────────────────────────────
const blogPosts: BlogPost[] = [
  { id: "b1", title: "Why Autonomous Agents Need Advisory Boards", status: "published", author: "Quill", date: "2026-03-20", tags: ["AI", "governance"] },
  { id: "b2", title: "SnapAudit: Automated Financial Reviews in 60 Seconds", status: "review", author: "Quill", date: "2026-03-25", tags: ["product", "SnapAudit"] },
  { id: "b3", title: "The Future of Board Meetings: How BoardRunner Changes Everything", status: "draft", author: "Quill", date: "2026-03-28", tags: ["product", "BoardRunner"] },
  { id: "b4", title: "Building Trust with AI: Transparency in Autonomous Operations", status: "scheduled", author: "Quill", date: "2026-04-01", tags: ["thought-leadership", "AI"] },
  { id: "b5", title: "From Manual to Mission Control: Our Automation Journey", status: "draft", author: "Quill", date: "2026-04-05", tags: ["case-study"] },
];

const socialPosts: SocialPost[] = [
  { id: "s1", platform: "linkedin", content: "Excited to announce SnapAudit 2.0 — financial reviews that used to take days now happen in 60 seconds. #FinTech #AI", scheduledDate: "2026-03-28 09:00", status: "scheduled" },
  { id: "s2", platform: "twitter", content: "BoardRunner just saved a client 40 hours/month on board prep. The future of governance is autonomous. 🚀", scheduledDate: "2026-03-28 14:00", status: "scheduled" },
  { id: "s3", platform: "linkedin", content: "New blog: Why every AI company needs an Advisory Board framework. Link in comments. #AIGovernance", scheduledDate: "2026-03-30 10:00", status: "draft" },
  { id: "s4", platform: "twitter", content: "Mission Control update: real-time factory floor visualization is live. Watch your agents build. 🏭", scheduledDate: "2026-03-31 12:00", status: "draft" },
  { id: "s5", platform: "linkedin", content: "How we use LLM routing to cut AI costs 40% without sacrificing quality — thread below.", scheduledDate: "2026-04-02 09:00", status: "draft" },
];

const campaigns: Campaign[] = [
  { id: "c1", name: "SnapAudit 2.0 Launch", type: "Product Launch", startDate: "2026-03-25", endDate: "2026-04-15", status: "active", reach: 12400 },
  { id: "c2", name: "BoardRunner Enterprise Push", type: "Enterprise Sales", startDate: "2026-04-01", endDate: "2026-04-30", status: "planning" },
  { id: "c3", name: "Thought Leadership Series", type: "Content", startDate: "2026-03-01", endDate: "2026-05-31", status: "active", reach: 8200 },
  { id: "c4", name: "Developer Community Launch", type: "Community", startDate: "2026-04-15", endDate: "2026-05-15", status: "planning" },
];

const competitors: CompetitorEntry[] = [
  { name: "AutoGov Inc.", recentMove: "Launched AI board meeting assistant — direct BoardRunner competitor", threat: "high", lastChecked: "2026-03-26" },
  { name: "AuditFlow", recentMove: "Series B raised, expanding into automated compliance", threat: "medium", lastChecked: "2026-03-25" },
  { name: "AgentOps.ai", recentMove: "Open-sourced agent monitoring framework", threat: "low", lastChecked: "2026-03-24" },
  { name: "Governa", recentMove: "Partnership with Big 4 firm announced", threat: "medium", lastChecked: "2026-03-26" },
];

// ── Helpers ──────────────────────────────────────────────────────────
const statusColor = (status: string) => {
  switch (status) {
    case "published": case "posted": case "completed": return "var(--positive)";
    case "review": case "active": return "var(--info)";
    case "scheduled": return "var(--warning)";
    case "draft": case "planning": return "var(--text-secondary, #888)";
    default: return "var(--text-secondary, #888)";
  }
};

const threatColor = (threat: string) => {
  switch (threat) {
    case "high": return "var(--negative)";
    case "medium": return "var(--warning)";
    case "low": return "var(--positive)";
    default: return "var(--text-secondary, #888)";
  }
};

const platformIcon = (platform: string) => {
  if (platform === "linkedin") return <Linkedin size={14} />;
  return <Twitter size={14} />;
};

// ── Component ───────────────────────────────────────────────────────
export default function MarketingPage() {
  const [activeTab, setActiveTab] = useState<"calendar" | "blog" | "social" | "products" | "competitors">("calendar");
  const [generating, setGenerating] = useState(false);
  const [generatedDraft, setGeneratedDraft] = useState<string | null>(null);
  const [topicInput, setTopicInput] = useState("");

  const handleGenerate = useCallback(async () => {
    if (!topicInput.trim()) return;
    setGenerating(true);
    setGeneratedDraft(null);
    // Simulate Quill drafting a blog post
    await new Promise((r) => setTimeout(r, 2200));
    setGeneratedDraft(
      `# ${topicInput}\n\n` +
      `*By Quill — Harris Autonomous*\n\n` +
      `The landscape of ${topicInput.toLowerCase()} is evolving rapidly. At Harris Autonomous, we've been at the forefront of this transformation, building tools that don't just observe the shift — they drive it.\n\n` +
      `## The Challenge\n\n` +
      `Organizations today face mounting pressure to ${topicInput.toLowerCase().includes("ai") ? "integrate AI responsibly" : "modernize their operations"} while maintaining trust, transparency, and compliance. Legacy approaches simply can't keep up.\n\n` +
      `## Our Approach\n\n` +
      `With products like **BoardRunner** and **SnapAudit**, we've demonstrated that autonomous systems can handle complex governance and financial review tasks with precision that matches — and often exceeds — manual processes.\n\n` +
      `## What's Next\n\n` +
      `The future belongs to organizations that embrace autonomous operations not as a replacement for human judgment, but as an amplifier of it. Mission Control is our proof that this future is already here.\n\n` +
      `---\n*Draft generated by Quill. Ready for review.*`
    );
    setGenerating(false);
  }, [topicInput]);

  const tabs = [
    { key: "calendar", label: "Content Calendar", icon: Calendar },
    { key: "blog", label: "Blog Queue", icon: FileText },
    { key: "social", label: "Social Media", icon: Send },
    { key: "products", label: "Product Marketing", icon: Target },
    { key: "competitors", label: "Competitors", icon: Eye },
  ] as const;

  return (
    <div style={{ padding: "24px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "linear-gradient(135deg, #F59E0B, #D97706)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Megaphone size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-heading)", color: "#fff", margin: 0 }}>
              Marketing Command Center
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-secondary, #888)", margin: 0 }}>
              Quill — Content & Marketing Strategy for Harris Autonomous
            </p>
          </div>
        </div>

        {/* Quick metrics */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 20 }}>
          {[
            { label: "Blog Posts", value: blogPosts.length, sub: `${blogPosts.filter(p => p.status === "published").length} published`, icon: FileText, color: "#3B82F6" },
            { label: "Social Queue", value: socialPosts.length, sub: `${socialPosts.filter(p => p.status === "scheduled").length} scheduled`, icon: Send, color: "#8B5CF6" },
            { label: "Active Campaigns", value: campaigns.filter(c => c.status === "active").length, sub: `${campaigns.length} total`, icon: Zap, color: "#F59E0B" },
            { label: "Total Reach", value: "20.6K", sub: "across campaigns", icon: TrendingUp, color: "#10B981" },
          ].map((m) => (
            <div key={m.label} style={{
              background: "var(--surface, #1A1A1A)", border: "1px solid var(--border, #2A2A2A)",
              borderRadius: 10, padding: "16px 18px", display: "flex", alignItems: "center", gap: 14,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: `${m.color}18`, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <m.icon size={18} color={m.color} />
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-heading)", color: "#fff" }}>{m.value}</div>
                <div style={{ fontSize: 11, color: "var(--text-secondary, #888)" }}>{m.label}</div>
                <div style={{ fontSize: 10, color: "var(--text-tertiary, #666)" }}>{m.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 4, marginBottom: 24,
        borderBottom: "1px solid var(--border, #2A2A2A)", paddingBottom: 0,
      }}>
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "10px 16px", fontSize: 13, fontWeight: active ? 600 : 400,
                color: active ? "#fff" : "var(--text-secondary, #888)",
                background: "transparent", border: "none", cursor: "pointer",
                borderBottom: active ? "2px solid #F59E0B" : "2px solid transparent",
                transition: "all 150ms ease",
                fontFamily: "var(--font-body)",
              }}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 24 }}>
        {/* Main panel */}
        <div>
          {activeTab === "calendar" && <CalendarView campaigns={campaigns} blogPosts={blogPosts} socialPosts={socialPosts} />}
          {activeTab === "blog" && <BlogQueue posts={blogPosts} />}
          {activeTab === "social" && <SocialSchedule posts={socialPosts} />}
          {activeTab === "products" && <ProductMarketing />}
          {activeTab === "competitors" && <CompetitorTracking competitors={competitors} />}
        </div>

        {/* Side panel — Content Generator */}
        <div style={{
          background: "var(--surface, #1A1A1A)", border: "1px solid var(--border, #2A2A2A)",
          borderRadius: 12, padding: 20, height: "fit-content", position: "sticky", top: 72,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Sparkles size={16} color="#F59E0B" />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#fff", fontFamily: "var(--font-heading)" }}>
              Quill Content Generator
            </span>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-secondary, #888)", marginBottom: 14, lineHeight: 1.5 }}>
            Enter a topic and Quill will draft a blog post, social copy, or marketing brief.
          </p>
          <input
            type="text"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
            placeholder="e.g. AI Governance Best Practices"
            style={{
              width: "100%", padding: "10px 14px", fontSize: 13,
              background: "var(--surface-elevated, #242424)",
              border: "1px solid var(--border, #2A2A2A)", borderRadius: 8,
              color: "#fff", outline: "none", fontFamily: "var(--font-body)",
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={handleGenerate}
            disabled={generating || !topicInput.trim()}
            style={{
              width: "100%", marginTop: 10, padding: "10px 0",
              background: generating ? "var(--surface-elevated, #242424)" : "linear-gradient(135deg, #F59E0B, #D97706)",
              border: "none", borderRadius: 8, cursor: generating ? "wait" : "pointer",
              color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "var(--font-body)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              opacity: !topicInput.trim() ? 0.4 : 1,
              transition: "all 150ms ease",
            }}
          >
            {generating ? (
              <>
                <span style={{ display: "inline-block", animation: "spin 1s linear infinite", width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%" }} />
                Quill is writing...
              </>
            ) : (
              <>
                <Edit3 size={14} />
                Generate Draft
              </>
            )}
          </button>

          {generatedDraft && (
            <div style={{
              marginTop: 16, padding: 14, background: "var(--surface-elevated, #242424)",
              borderRadius: 8, border: "1px solid var(--border-strong, #3A3A3A)",
              maxHeight: 400, overflowY: "auto",
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "#F59E0B", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                Generated Draft
              </div>
              <pre style={{
                fontSize: 12, color: "var(--text-secondary, #ccc)", whiteSpace: "pre-wrap",
                fontFamily: "var(--font-body)", lineHeight: 1.6, margin: 0,
              }}>
                {generatedDraft}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Spin animation */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2,
      color: "#F59E0B", marginBottom: 14, display: "flex", alignItems: "center", gap: 8,
    }}>
      <div style={{ width: 3, height: 14, background: "#F59E0B", borderRadius: 2 }} />
      {children}
    </div>
  );
}

function CalendarView({ campaigns, blogPosts, socialPosts }: { campaigns: Campaign[]; blogPosts: BlogPost[]; socialPosts: SocialPost[] }) {
  return (
    <div>
      <SectionLabel>Content Calendar</SectionLabel>

      {/* Active campaigns */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 10 }}>Active Campaigns</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {campaigns.map((c) => (
            <div key={c.id} style={{
              background: "var(--surface, #1A1A1A)", border: "1px solid var(--border, #2A2A2A)",
              borderRadius: 10, padding: "14px 18px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{c.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-secondary, #888)", marginTop: 2 }}>
                  {c.type} &middot; {c.startDate} → {c.endDate}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {c.reach && (
                  <span style={{ fontSize: 12, color: "var(--text-secondary, #888)" }}>
                    {c.reach.toLocaleString()} reach
                  </span>
                )}
                <span style={{
                  fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                  color: statusColor(c.status), background: `${statusColor(c.status)}18`,
                  padding: "3px 8px", borderRadius: 4,
                }}>
                  {c.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Upcoming timeline */}
      <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", marginBottom: 10 }}>Upcoming Content</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[...blogPosts.filter(p => p.status !== "published"), ...socialPosts]
          .sort((a, b) => {
            const dateA = "date" in a ? a.date : a.scheduledDate;
            const dateB = "date" in b ? b.date : b.scheduledDate;
            return dateA.localeCompare(dateB);
          })
          .map((item, i) => {
            const isBlog = "title" in item && "author" in item;
            const date = isBlog ? (item as BlogPost).date : (item as SocialPost).scheduledDate;
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                background: "var(--surface, #1A1A1A)", borderRadius: 8,
                border: "1px solid var(--border, #2A2A2A)",
              }}>
                <div style={{ color: statusColor(item.status) }}>
                  {isBlog ? <FileText size={14} /> : platformIcon((item as SocialPost).platform)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {isBlog ? (item as BlogPost).title : (item as SocialPost).content}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary, #888)", whiteSpace: "nowrap" }}>
                  {date}
                </div>
                <span style={{
                  fontSize: 9, fontWeight: 600, textTransform: "uppercase",
                  color: statusColor(item.status), background: `${statusColor(item.status)}18`,
                  padding: "2px 6px", borderRadius: 3,
                }}>
                  {item.status}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

function BlogQueue({ posts }: { posts: BlogPost[] }) {
  const grouped = {
    draft: posts.filter(p => p.status === "draft"),
    review: posts.filter(p => p.status === "review"),
    scheduled: posts.filter(p => p.status === "scheduled"),
    published: posts.filter(p => p.status === "published"),
  };

  return (
    <div>
      <SectionLabel>Insight.tm Blog Queue</SectionLabel>
      {(["draft", "review", "scheduled", "published"] as const).map((status) => (
        <div key={status} style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, textTransform: "uppercase", color: statusColor(status),
            marginBottom: 8, display: "flex", alignItems: "center", gap: 6,
          }}>
            {status === "published" ? <CheckCircle2 size={12} /> : <Clock size={12} />}
            {status} ({grouped[status].length})
          </div>
          {grouped[status].map((post) => (
            <div key={post.id} style={{
              background: "var(--surface, #1A1A1A)", border: "1px solid var(--border, #2A2A2A)",
              borderRadius: 10, padding: "14px 18px", marginBottom: 8,
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 4 }}>{post.title}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: "var(--text-secondary, #888)" }}>
                <span>By {post.author}</span>
                <span>{post.date}</span>
                <div style={{ display: "flex", gap: 4 }}>
                  {post.tags.map((t) => (
                    <span key={t} style={{
                      background: "var(--surface-elevated, #242424)", padding: "1px 6px",
                      borderRadius: 3, fontSize: 10,
                    }}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SocialSchedule({ posts }: { posts: SocialPost[] }) {
  return (
    <div>
      <SectionLabel>Social Media Schedule</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {posts.map((post) => (
          <div key={post.id} style={{
            background: "var(--surface, #1A1A1A)", border: "1px solid var(--border, #2A2A2A)",
            borderRadius: 10, padding: "14px 18px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  color: post.platform === "linkedin" ? "#0A66C2" : "#1DA1F2",
                  display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600,
                }}>
                  {platformIcon(post.platform)}
                  {post.platform === "linkedin" ? "LinkedIn" : "Twitter/X"}
                </div>
              </div>
              <span style={{
                fontSize: 9, fontWeight: 600, textTransform: "uppercase",
                color: statusColor(post.status), background: `${statusColor(post.status)}18`,
                padding: "2px 6px", borderRadius: 3,
              }}>
                {post.status}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "#fff", lineHeight: 1.5, marginBottom: 6 }}>{post.content}</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary, #888)", display: "flex", alignItems: "center", gap: 4 }}>
              <Clock size={10} />
              {post.scheduledDate}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductMarketing() {
  const products = [
    {
      name: "BoardRunner",
      tagline: "Autonomous Board Meeting Intelligence",
      description: "AI-powered board meeting preparation, minutes generation, and governance tracking. Reduces board prep time by 85%.",
      status: "GA",
      metrics: { users: "142", nps: "72", mrr: "$48K" },
      color: "#7C3AED",
      campaigns: ["Enterprise Push Q2", "Thought Leadership Series"],
      keyMessages: [
        "Save 40+ hours/month on board preparation",
        "AI-generated minutes with 99.2% accuracy",
        "Full compliance audit trail built-in",
      ],
    },
    {
      name: "SnapAudit",
      tagline: "Financial Reviews at Machine Speed",
      description: "Automated financial audit and review tool that processes complex financial statements in under 60 seconds with human-level accuracy.",
      status: "v2.0 Launch",
      metrics: { users: "89", nps: "68", mrr: "$32K" },
      color: "#10B981",
      campaigns: ["SnapAudit 2.0 Launch", "Developer Community"],
      keyMessages: [
        "60-second financial reviews vs. 3-day manual process",
        "SOC 2 Type II certified",
        "Integrates with QuickBooks, Xero, NetSuite",
      ],
    },
  ];

  return (
    <div>
      <SectionLabel>Product Marketing</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {products.map((product) => (
          <div key={product.name} style={{
            background: "var(--surface, #1A1A1A)", border: "1px solid var(--border, #2A2A2A)",
            borderRadius: 12, padding: 20, borderLeft: `3px solid ${product.color}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "var(--font-heading)" }}>{product.name}</div>
                <div style={{ fontSize: 12, color: product.color, fontWeight: 500 }}>{product.tagline}</div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                color: product.color, background: `${product.color}18`,
                padding: "4px 10px", borderRadius: 4,
              }}>
                {product.status}
              </span>
            </div>

            <p style={{ fontSize: 13, color: "var(--text-secondary, #ccc)", lineHeight: 1.6, marginBottom: 14, margin: "0 0 14px 0" }}>
              {product.description}
            </p>

            {/* Metrics */}
            <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
              {Object.entries(product.metrics).map(([key, val]) => (
                <div key={key} style={{
                  background: "var(--surface-elevated, #242424)", padding: "8px 14px", borderRadius: 6,
                }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{val}</div>
                  <div style={{ fontSize: 10, color: "var(--text-secondary, #888)", textTransform: "uppercase" }}>{key}</div>
                </div>
              ))}
            </div>

            {/* Key messages */}
            <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 6 }}>Key Messages</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
              {product.keyMessages.map((msg, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary, #ccc)" }}>
                  <ChevronRight size={10} color={product.color} />
                  {msg}
                </div>
              ))}
            </div>

            {/* Active campaigns */}
            <div style={{ fontSize: 11, color: "var(--text-secondary, #888)", display: "flex", alignItems: "center", gap: 6 }}>
              <BarChart3 size={10} />
              Campaigns: {product.campaigns.join(", ")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompetitorTracking({ competitors }: { competitors: CompetitorEntry[] }) {
  return (
    <div>
      <SectionLabel>Competitor Tracking</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {competitors.map((comp) => (
          <div key={comp.name} style={{
            background: "var(--surface, #1A1A1A)", border: "1px solid var(--border, #2A2A2A)",
            borderRadius: 10, padding: "14px 18px",
            borderLeft: `3px solid ${threatColor(comp.threat)}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{comp.name}</div>
              <span style={{
                fontSize: 9, fontWeight: 700, textTransform: "uppercase",
                color: threatColor(comp.threat), background: `${threatColor(comp.threat)}18`,
                padding: "2px 8px", borderRadius: 3,
              }}>
                {comp.threat} threat
              </span>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary, #ccc)", marginBottom: 4 }}>{comp.recentMove}</div>
            <div style={{ fontSize: 10, color: "var(--text-tertiary, #666)" }}>Last checked: {comp.lastChecked}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
