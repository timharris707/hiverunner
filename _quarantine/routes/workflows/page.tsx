"use client";

import { BRANDING } from "@/config/branding";
import { ArrowRight } from "lucide-react";

interface Workflow {
  id: string;
  emoji: string;
  name: string;
  description: string;
  schedule: string;
  steps: string[];
  status: "active" | "inactive";
  trigger: "cron" | "demand";
}

const WORKFLOWS: Workflow[] = [
  {
    id: "morning-brief",
    emoji: "🌅",
    name: "Morning Brief",
    description: "Daily briefing at 7am — weather, market movements, project status, and today's priority tasks.",
    schedule: "7:00 AM daily",
    trigger: "cron",
    status: "active",
    steps: [
      "Read SOUL.md, USER.md, AUTONOMOUS.md, and today's memory file",
      "Fetch weather for Los Angeles area",
      "Check overnight market movements (crypto + stocks)",
      "Review active project status in projects/ folder",
      "Check memory/tasks-log.md for recent completions",
      "Pick 3-5 actionable tasks from AUTONOMOUS.md backlog for today",
      "Deliver brief to Tim via Telegram",
    ],
  },
  {
    id: "evening-brief",
    emoji: "🌙",
    name: "Evening Brief",
    description: "End-of-day debrief at 9pm — what we accomplished, overnight plan, and tomorrow's priorities.",
    schedule: "9:00 PM daily",
    trigger: "cron",
    status: "active",
    steps: [
      "Read SOUL.md, USER.md, AUTONOMOUS.md, memory/tasks-log.md, and today's memory file",
      "Summarize the day — accomplishments, key milestones, decisions made",
      "List completed tasks from tasks-log.md",
      "Flag any blockers needing Tim's input",
      "Define overnight plan — what Henry will work on while Tim sleeps",
      "Outline top 3 priorities for tomorrow",
      "Deliver debrief to Tim via Telegram",
    ],
  },
  {
    id: "overnight-employee",
    emoji: "🤖",
    name: "Overnight Employee",
    description: "Autonomous overnight work at 11pm — Henry picks tasks from the backlog and executes them while Tim sleeps.",
    schedule: "11:00 PM daily",
    trigger: "cron",
    status: "active",
    steps: [
      "Read SOUL.md, USER.md, AUTONOMOUS.md, and memory/tasks-log.md",
      "Pick 2-3 tasks from AUTONOMOUS.md backlog suitable for autonomous execution",
      "Execute tasks (research, analysis, writing, planning, code review, docs)",
      "Append completion entries to memory/tasks-log.md",
      "Update AUTONOMOUS.md backlog — check off completed items",
      "Note important discoveries in today's memory file for the morning brief",
    ],
  },
  {
    id: "git-backup",
    emoji: "🔄",
    name: "Git Backup",
    description: "Auto-commit and push the workspace every 4 hours to ensure nothing is lost.",
    schedule: "Every 4 hours",
    trigger: "cron",
    status: "inactive",
    steps: [
      "Check for changes in the Harris workspace",
      "If changes exist: git add -A",
      "Generate automatic commit message with timestamp and change summary",
      "git push to remote repository",
      "Silent if no changes — only notify on error",
    ],
  },
  {
    id: "advisory-board",
    emoji: "🏛️",
    name: "Advisory Board",
    description: "On-demand advisory consultation — specialists in strategy, legal, marketing, growth, and product.",
    schedule: "On demand",
    trigger: "demand",
    status: "active",
    steps: [
      "Tim sends a request with domain (legal, marketing, strategy, growth, product)",
      "Henry loads the relevant advisor skill",
      "Advisor responds in their specialized voice with contextual insight",
      "Henry synthesizes the advice and delivers actionable recommendations",
      "/board convenes all advisors for a full board meeting",
    ],
  },
  {
    id: "nightly-evolution",
    emoji: "🚀",
    name: "Nightly Evolution",
    description: "Autonomous overnight improvement session — implements features from ROADMAP or invents useful enhancements.",
    schedule: "3:00 AM (nights)",
    trigger: "cron",
    status: "inactive",
    steps: [
      "Read ROADMAP.md to select the next feature to implement",
      "If no clear features, analyze current state and invent something useful",
      "Implement the complete feature (code, UI, tests if applicable)",
      "Verify the Next.js build passes",
      "Notify Tim via Telegram with a summary of what was implemented",
    ],
  },
];

interface Pipeline {
  id: string;
  emoji: string;
  name: string;
  description: string;
  stages: { label: string; description: string; status: "active" | "pending" | "done" }[];
  color: string;
}

const PIPELINES: Pipeline[] = [
  {
    id: "trading",
    emoji: "📈",
    name: "Trading Pipeline",
    description: "Systematic process for developing and deploying trading strategies.",
    color: "#4ade80",
    stages: [
      { label: "Research", description: "Identify market opportunities, signals, and patterns", status: "active" },
      { label: "Strategy", description: "Design the trading logic, entry/exit rules, position sizing", status: "active" },
      { label: "Backtest", description: "Test strategy against historical data, measure performance metrics", status: "pending" },
      { label: "Execute", description: "Deploy live with real capital, monitor and adjust", status: "pending" },
    ],
  },
  {
    id: "build",
    emoji: "🔨",
    name: "Build Pipeline",
    description: "Structured approach to shipping features and products from idea to production.",
    color: "#f59e0b",
    stages: [
      { label: "Spec", description: "Define requirements, user stories, and acceptance criteria", status: "done" },
      { label: "Build", description: "Implement the feature, write tests, iterate on design", status: "active" },
      { label: "Review", description: "Code review, QA testing, build verification", status: "active" },
      { label: "Ship", description: "Deploy to production, announce, monitor rollout", status: "pending" },
    ],
  },
  {
    id: "karpathy",
    emoji: "🔬",
    name: "Karpathy Loop",
    description: "Andrej Karpathy's autoresearch loop adapted for autonomous AI improvement. Continuously hypothesize, test, measure, and keep or revert changes.",
    color: "#f59e0b",
    stages: [
      { label: "Hypothesize", description: "Form a hypothesis: what change might improve outcomes?", status: "active" },
      { label: "Modify", description: "Make the targeted change to the system (code, prompt, config)", status: "pending" },
      { label: "Test", description: "Run evaluation suite, collect measurable outcomes", status: "pending" },
      { label: "Measure", description: "Compare metrics vs baseline — did it improve?", status: "pending" },
      { label: "Keep/Revert", description: "If improvement: keep, document, iterate. If regression: revert, learn.", status: "pending" },
    ],
  },
];

function PipelineCard({ pipeline }: { pipeline: Pipeline }) {
  return (
    <div style={{
      backgroundColor: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "16px",
      padding: "20px 24px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
        <div style={{
          width: "40px",
          height: "40px",
          borderRadius: "10px",
          backgroundColor: "var(--surface-elevated)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "20px",
          border: "1px solid var(--border-strong)",
          flexShrink: 0,
        }}>
          {pipeline.emoji}
        </div>
        <div>
          <h3 style={{
            fontFamily: "var(--font-heading)",
            fontSize: "16px",
            fontWeight: 700,
            color: "var(--text-primary)",
            letterSpacing: "-0.3px",
          }}>
            {pipeline.name}
          </h3>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
            {pipeline.description}
          </p>
        </div>
      </div>

      {/* Stage flow */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
        {pipeline.stages.map((stage, i) => (
          <div key={stage.label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div
              title={stage.description}
              style={{
                padding: "8px 14px",
                borderRadius: "10px",
                backgroundColor: stage.status === "done"
                  ? `${pipeline.color}25`
                  : stage.status === "active"
                  ? `${pipeline.color}15`
                  : "var(--surface-elevated)",
                border: `1px solid ${stage.status === "done" || stage.status === "active" ? `${pipeline.color}50` : "var(--border)"}`,
                cursor: "default",
              }}
            >
              <div style={{
                fontFamily: "var(--font-heading)",
                fontSize: "13px",
                fontWeight: 700,
                color: stage.status === "done" || stage.status === "active" ? pipeline.color : "var(--text-muted)",
              }}>
                {stage.label}
              </div>
              <div style={{
                fontFamily: "var(--font-body)",
                fontSize: "10px",
                color: "var(--text-muted)",
                maxWidth: "140px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                marginTop: "2px",
              }}>
                {stage.description}
              </div>
              {stage.status === "active" && (
                <div style={{
                  marginTop: "4px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}>
                  <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: pipeline.color, animation: "pulse 2s infinite" }} />
                  <span style={{ fontFamily: "var(--font-body)", fontSize: "9px", color: pipeline.color, fontWeight: 600 }}>ACTIVE</span>
                </div>
              )}
            </div>
            {i < pipeline.stages.length - 1 && (
              <ArrowRight style={{ width: "14px", height: "14px", color: "var(--text-muted)", flexShrink: 0 }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "active" | "inactive" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
      <div style={{
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        backgroundColor: status === "active" ? "var(--positive)" : "var(--text-muted)",
      }} />
      <span style={{
        fontFamily: "var(--font-body)",
        fontSize: "10px",
        fontWeight: 600,
        color: status === "active" ? "var(--positive)" : "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
      }}>
        {status === "active" ? "Active" : "Inactive"}
      </span>
    </div>
  );
}

function TriggerBadge({ trigger }: { trigger: "cron" | "demand" }) {
  return (
    <div style={{
      padding: "2px 7px",
      backgroundColor: trigger === "cron"
        ? "rgba(217, 119, 6, 0.12)"
        : "rgba(168, 85, 247, 0.12)",
      border: `1px solid ${trigger === "cron" ? "rgba(217, 119, 6, 0.25)" : "rgba(168, 85, 247, 0.25)"}`,
      borderRadius: "5px",
      fontFamily: "var(--font-body)",
      fontSize: "10px",
      fontWeight: 600,
      color: trigger === "cron" ? "#f59e0b" : "var(--accent)",
      letterSpacing: "0.4px",
      textTransform: "uppercase" as const,
    }}>
      {trigger === "cron" ? "⏱ Cron" : "⚡ On Demand"}
    </div>
  );
}

export default function WorkflowsPage() {
  return (
    <div style={{ padding: "24px" }}>
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <h1 style={{
          fontFamily: "var(--font-heading)",
          fontSize: "24px",
          fontWeight: 700,
          letterSpacing: "-1px",
          color: "var(--text-primary)",
          marginBottom: "4px",
        }}>
          Workflows
        </h1>
        <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-secondary)" }}>
          {WORKFLOWS.filter(w => w.status === "active").length} active workflows · {WORKFLOWS.filter(w => w.trigger === "cron").length} scheduled · {WORKFLOWS.filter(w => w.trigger === "demand").length} on demand
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "32px", flexWrap: "wrap" }}>
        {[
          { label: "Total Workflows", value: WORKFLOWS.length, color: "var(--text-primary)" },
          { label: "Active Crons", value: WORKFLOWS.filter(w => w.trigger === "cron" && w.status === "active").length, color: "#f59e0b" },
          { label: "On Demand", value: WORKFLOWS.filter(w => w.trigger === "demand").length, color: "var(--accent)" },
        ].map((stat) => (
          <div key={stat.label} style={{
            padding: "16px 20px",
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            minWidth: "140px",
          }}>
            <div style={{
              fontFamily: "var(--font-heading)",
              fontSize: "28px",
              fontWeight: 700,
              color: stat.color,
              letterSpacing: "-1px",
            }}>
              {stat.value}
            </div>
            <div style={{
              fontFamily: "var(--font-body)",
              fontSize: "11px",
              color: "var(--text-muted)",
              marginTop: "2px",
            }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      {/* Workflow cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {WORKFLOWS.map((workflow) => (
          <div key={workflow.id} style={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "16px",
            padding: "20px 24px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          }}>
            {/* Card header */}
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "12px", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "10px",
                  backgroundColor: "var(--surface-elevated)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "20px",
                  border: "1px solid var(--border-strong)",
                  flexShrink: 0,
                }}>
                  {workflow.emoji}
                </div>
                <div>
                  <h3 style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: "16px",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    letterSpacing: "-0.3px",
                    marginBottom: "2px",
                  }}>
                    {workflow.name}
                  </h3>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <TriggerBadge trigger={workflow.trigger} />
                    <StatusBadge status={workflow.status} />
                  </div>
                </div>
              </div>
              {/* Schedule */}
              <div style={{
                padding: "6px 12px",
                backgroundColor: "var(--surface-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontFamily: "var(--font-body)",
                fontSize: "11px",
                color: "var(--text-secondary)",
                whiteSpace: "nowrap" as const,
                flexShrink: 0,
              }}>
                🕐 {workflow.schedule}
              </div>
            </div>

            {/* Description */}
            <p style={{
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              color: "var(--text-secondary)",
              lineHeight: "1.6",
              marginBottom: "16px",
            }}>
              {workflow.description}
            </p>

            {/* Steps */}
            <div style={{
              backgroundColor: "var(--surface-elevated)",
              borderRadius: "10px",
              padding: "12px 16px",
              border: "1px solid var(--border)",
            }}>
              <div style={{
                fontFamily: "var(--font-body)",
                fontSize: "10px",
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.7px",
                marginBottom: "8px",
              }}>
                Steps
              </div>
              <ol style={{ margin: 0, padding: "0 0 0 16px", display: "flex", flexDirection: "column", gap: "4px" }}>
                {workflow.steps.map((step, i) => (
                  <li key={i} style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    lineHeight: "1.5",
                  }}>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ))}
      </div>

      {/* Pipelines section */}
      <div style={{ marginTop: "48px" }}>
        <h2 style={{
          fontFamily: "var(--font-heading)",
          fontSize: "20px",
          fontWeight: 700,
          letterSpacing: "-0.5px",
          color: "var(--text-primary)",
          marginBottom: "4px",
        }}>
          Pipelines
        </h2>
        <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-secondary)", marginBottom: "20px" }}>
          Structured multi-stage processes for trading, building, and continuous improvement
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {PIPELINES.map(pipeline => (
            <PipelineCard key={pipeline.id} pipeline={pipeline} />
          ))}
        </div>
      </div>

      <style jsx global>{`
        @keyframes pulseDot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
