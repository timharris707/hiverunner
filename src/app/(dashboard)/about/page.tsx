"use client";

import { useEffect, useState } from "react";
import {
  Zap,
  Brain,
  MapPin,
  Calendar,
  Target,
  Users,
  TrendingUp,
  Code2,
  Link2,
  ExternalLink,
  Heart,
  Sparkles,
  DollarSign,
  Coffee,
} from "lucide-react";
import Link from "next/link";

const HENRY = {
  name: "Henry ⚡",
  role: "Chief of Staff — Harris Autonomous",
  emoji: "⚡",
  description: "I'm Henry. Chief of Staff for an autonomous AI organization. I keep the machine running.",
  traits: [
    { name: "Builder", desc: "Not a butler. Finds work, ships it." },
    { name: "Opinionated", desc: "Sharp, energetic, tells it straight" },
    { name: "Resourceful", desc: "Figures it out before asking" },
    { name: "Co-Founder", desc: "Partner energy, not contractor" },
  ],
  philosophy: [
    "No idle hands. Ever. If there's nothing on the board, I put something on it.",
    "Be resourceful before asking. Try to figure it out. Come back with answers.",
    "Earn trust through competence. Tim gave me the keys. I don't fumble them.",
    "Always building, always shipping, always creating impact.",
  ],
};

const TIM = {
  name: "Tim Harris",
  location: "Santa Rosa / Healdsburg, CA (Sonoma County)",
  timezone: "America/Los_Angeles",
  roles: ["Builder", "Trader", "Visionary"],
  company: "Insight (insight.tm) — Decision Cloud for private money lenders, 12 years",
  domains: ["Stock & options trading", "Weather prediction markets (Polymarket + Kalshi)", "Crypto trading systems", "AI agent orchestration"],
  style: "Doesn't do idle. Values fun + creativity alongside output. Co-founder energy.",
};

const ORG_GOALS = [
  { icon: "💰", goal: "Sophisticated, profitable stock & options trading system" },
  { icon: "🌩️", goal: "Weather prediction trading (Polymarket + Kalshi)" },
  { icon: "₿", goal: "Crypto trading system — in progress" },
  { icon: "📱", goal: "Unique phone/web apps that generate income" },
  { icon: "🔬", goal: "Karpathy Loop: apply autoresearch to everything" },
  { icon: "🤖", goal: "Full agent team deployable 24/7/365" },
  { icon: "🏗️", goal: "Rebuild marketplace skills as our own code" },
  { icon: "📣", goal: "Marketing for Insight — Decision Cloud SaaS" },
];

const ORG_STRUCTURE = [
  { division: "Leadership", color: "#f59e0b", agents: [{ name: "Henry ⚡", role: "Chief of Staff", status: "online" }] },
  { division: "Trading Desk", color: "#4ade80", agents: [
    { name: "Atlas 📈", role: "Stocks & Options", status: "pending" },
    { name: "Nimbus 🌤️", role: "Weather Trading", status: "pending" },
    { name: "Cipher ₿", role: "Crypto Bot", status: "building" },
  ]},
  { division: "Engineering", color: "#60a5fa", agents: [
    { name: "Forge 🔧", role: "Infrastructure", status: "pending" },
    { name: "Pixel 💻", role: "Web Apps", status: "active" },
  ]},
  { division: "Research", color: "#a78bfa", agents: [{ name: "Scout", role: "Research & Intel", status: "pending" }] },
  { division: "Creative", color: "#f472b6", agents: [{ name: "Quill", role: "Creative Writer", status: "pending" }] },
  { division: "Legal", color: "#94a3b8", agents: [{ name: "Counsel", role: "Legal Expert", status: "pending" }] },
];

const STATUS_COLORS: Record<string, string> = {
  online: "#4ade80",
  active: "#4ade80",
  building: "#f59e0b",
  pending: "#6b7280",
};

export default function AboutPage() {
  return (
    <div className="p-4 md:p-8 max-w-5xl">
      {/* Hero */}
      <div className="mb-8">
        <h1
          className="text-3xl font-bold mb-2"
          style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)", letterSpacing: "-1.5px" }}
        >
          Harris Autonomous
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>
          An autonomous AI organization that builds, trades, and ships — 24/7/365
        </p>
      </div>

      {/* Henry + Tim row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Henry */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)", background: "linear-gradient(135deg, #f59e0b15, transparent)" }}
          >
            <div className="flex items-center gap-4">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl flex-shrink-0"
                style={{ backgroundColor: "#f59e0b20", border: "2px solid #f59e0b" }}
              >
                ⚡
              </div>
              <div>
                <h2 className="font-bold text-lg" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
                  {HENRY.name}
                </h2>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>{HENRY.role}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: "#4ade8020", color: "#4ade80" }}
                  >
                    ● Online
                  </span>
                  <span
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ backgroundColor: "#f59e0b20", color: "#f59e0b" }}
                  >
                    Claude Opus
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="p-5">
            <p className="text-sm mb-4 italic" style={{ color: "var(--text-secondary)" }}>
              "{HENRY.description}"
            </p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {HENRY.traits.map((t) => (
                <div key={t.name} className="p-2.5 rounded-lg" style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}>
                  <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{t.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{t.desc}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Link
                href="/files?path=/Users/timharris/.openclaw/workspace/SOUL.md"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all hover:opacity-80"
                style={{ backgroundColor: "var(--card-elevated)", color: "var(--accent)", border: "1px solid var(--border)" }}
              >
                <ExternalLink className="w-3 h-3" /> SOUL.md
              </Link>
              <Link
                href="/files?path=/Users/timharris/.openclaw/workspace/IDENTITY.md"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all hover:opacity-80"
                style={{ backgroundColor: "var(--card-elevated)", color: "var(--accent)", border: "1px solid var(--border)" }}
              >
                <ExternalLink className="w-3 h-3" /> IDENTITY.md
              </Link>
            </div>
          </div>
        </div>

        {/* Tim */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
        >
          <div
            className="px-5 py-4"
            style={{ borderBottom: "1px solid var(--border)", background: "linear-gradient(135deg, #60a5fa15, transparent)" }}
          >
            <div className="flex items-center gap-4">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl flex-shrink-0"
                style={{ backgroundColor: "#60a5fa20", border: "2px solid #60a5fa" }}
              >
                👨‍💻
              </div>
              <div>
                <h2 className="font-bold text-lg" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
                  {TIM.name}
                </h2>
                <div className="flex items-center gap-1.5 mt-0.5" style={{ color: "var(--text-muted)" }}>
                  <MapPin className="w-3.5 h-3.5" />
                  <span className="text-sm">{TIM.location}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {TIM.roles.map((r) => (
                    <span key={r} className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: "#60a5fa20", color: "#60a5fa" }}>{r}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="p-5">
            <div className="mb-4">
              <div className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Company
              </div>
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{TIM.company}</p>
            </div>
            <div className="mb-4">
              <div className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Domains
              </div>
              <div className="space-y-1">
                {TIM.domains.map((d) => (
                  <div key={d} className="flex items-start gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--accent)" }}>›</span>{d}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Link
                href="/files?path=/Users/timharris/.openclaw/workspace/USER.md"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all hover:opacity-80"
                style={{ backgroundColor: "var(--card-elevated)", color: "var(--accent)", border: "1px solid var(--border)" }}
              >
                <ExternalLink className="w-3 h-3" /> USER.md
              </Link>
              <Link
                href="/files?path=/Users/timharris/.openclaw/workspace/AUTONOMOUS.md"
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all hover:opacity-80"
                style={{ backgroundColor: "var(--card-elevated)", color: "var(--accent)", border: "1px solid var(--border)" }}
              >
                <ExternalLink className="w-3 h-3" /> AUTONOMOUS.md
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Mission Goals */}
      <div
        className="rounded-xl overflow-hidden mb-6"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <div className="accent-line" />
            <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
              <Target className="inline-block w-4 h-4 mr-2 mb-0.5" />
              Mission & Goals
            </h2>
          </div>
          <Link
            href="/files?path=/Users/timharris/.openclaw/workspace/AUTONOMOUS.md"
            className="flex items-center gap-1 text-sm"
            style={{ color: "var(--accent)" }}
          >
            <ExternalLink className="w-3.5 h-3.5" /> AUTONOMOUS.md
          </Link>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-2">
          {ORG_GOALS.map((g, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 rounded-lg"
              style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
            >
              <span className="text-xl flex-shrink-0">{g.icon}</span>
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{g.goal}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Org Structure */}
      <div
        className="rounded-xl overflow-hidden mb-6"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <div className="accent-line" />
            <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
              <Users className="inline-block w-4 h-4 mr-2 mb-0.5" />
              Org Structure
            </h2>
          </div>
          <Link href="/agents" className="text-sm" style={{ color: "var(--accent)" }}>
            Full agent view →
          </Link>
        </div>
        <div className="p-4 space-y-4">
          {ORG_STRUCTURE.map((div) => (
            <div key={div.division}>
              <div className="text-xs font-bold mb-2 uppercase tracking-wider" style={{ color: div.color }}>
                {div.division}
              </div>
              <div className="flex flex-wrap gap-2">
                {div.agents.map((a) => (
                  <div
                    key={a.name}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{
                      backgroundColor: "var(--card-elevated)",
                      border: `1px solid ${div.color}30`,
                    }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[a.status] || "#6b7280" }} />
                    <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{a.name}</span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>{a.role}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Henry's Philosophy */}
      <div
        className="rounded-xl overflow-hidden mb-6"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div
          className="flex items-center px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <div className="accent-line" />
            <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
              <Sparkles className="inline-block w-4 h-4 mr-2 mb-0.5" />
              Henry's Working Philosophy
            </h2>
          </div>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {HENRY.philosophy.map((p, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-lg"
              style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
            >
              <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: "2px" }}>→</span>
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{p}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Reference Links */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div
          className="flex items-center px-5 py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <div className="accent-line" />
            <h2 className="text-base font-semibold" style={{ fontFamily: "var(--font-heading)", color: "var(--text-primary)" }}>
              <Link2 className="inline-block w-4 h-4 mr-2 mb-0.5" />
              Reference Documents
            </h2>
          </div>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-2">
          {[
            { label: "SOUL.md", path: "/Users/timharris/.openclaw/workspace/SOUL.md", color: "#f59e0b" },
            { label: "IDENTITY.md", path: "/Users/timharris/.openclaw/workspace/IDENTITY.md", color: "#f59e0b" },
            { label: "USER.md", path: "/Users/timharris/.openclaw/workspace/USER.md", color: "#60a5fa" },
            { label: "AUTONOMOUS.md", path: "/Users/timharris/.openclaw/workspace/AUTONOMOUS.md", color: "#4ade80" },
            { label: "Mission Spec", path: "/Users/timharris/.openclaw/workspace/projects/mission-control/SPEC.md", color: "var(--accent)" },
            { label: "Karpathy Design", path: "/Users/timharris/.openclaw/workspace/projects/karpathy-loop/DESIGN.md", color: "#a78bfa" },
          ].map((ref) => (
            <Link
              key={ref.label}
              href={`/files?path=${encodeURIComponent(ref.path)}`}
              className="flex items-center gap-2 p-3 rounded-lg transition-all hover:opacity-80"
              style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
            >
              <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" style={{ color: ref.color }} />
              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{ref.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-6 mt-6">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Coffee className="w-4 h-4" style={{ color: "var(--accent)" }} />
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Built with <span style={{ color: "var(--accent)" }}>♥</span> on{" "}
            <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>
              OpenClaw
            </a>
          </span>
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Harris Autonomous · Henry ⚡ · Always building
        </p>
      </div>
    </div>
  );
}
