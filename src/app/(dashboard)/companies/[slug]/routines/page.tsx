"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  MoreHorizontal,
  Plus,
  Search,
  Workflow,
} from "lucide-react";

import { CompanyErrorState, CompanyShell } from "@/components/company/company-ui";
import { ActiveProjectBanner } from "@/components/orchestration/ActiveProjectBanner";
import { listCompanies, listCompanyAgents, listProjects } from "@/lib/orchestration/client";
import { useActiveProjectState } from "@/lib/active-project-state";
import { resolveActiveProject } from "@/lib/active-project-utils";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
} from "@/lib/orchestration/types";

interface Routine {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  agentId: string;
  agentName: string;
  enabled: boolean;
  schedule: string;
  lastRun: string | null;
  lastRunStatus: "success" | "failed" | "running" | null;
}

const SAMPLE_ROUTINES: Routine[] = [];

export default function CompanyRoutinesPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const { activeProject, clearActiveProject } = useActiveProjectState();
  const [routines, setRoutines] = useState<Routine[]>(SAMPLE_ROUTINES);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const [formName, setFormName] = useState("");
  const [formProjectId, setFormProjectId] = useState("");
  const [formAgentId, setFormAgentId] = useState("");
  const [formSchedule, setFormSchedule] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [companyRows, projectRows, agentRows] = await Promise.all([
          listCompanies(),
          listProjects({ company: slug }),
          listCompanyAgents(slug),
        ]);
        if (cancelled) return;

        setCompany(companyRows.find((r) => r.slug === slug) ?? null);
        setProjects(projectRows);
        setAgents(agentRows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [slug]);

  const activeProjectRecord = useMemo(
    () => resolveActiveProject(projects, activeProject, slug),
    [activeProject, projects, slug]
  );

  const filteredRoutines = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return routines.filter((r) => {
      if (activeProjectRecord && r.projectId !== activeProjectRecord.id) return false;
      if (!needle) return true;
      return `${r.name} ${r.projectName} ${r.agentName}`.toLowerCase().includes(needle);
    });
  }, [routines, query, activeProjectRecord]);

  const handleCreate = () => {
    const trimmed = formName.trim();
    if (!trimmed || !formProjectId || !formAgentId || !formSchedule.trim()) return;

    const project = projects.find((p) => p.id === formProjectId);
    const agent = agents.find((a) => a.id === formAgentId);

    const newRoutine: Routine = {
      id: crypto.randomUUID(),
      name: trimmed,
      projectId: formProjectId,
      projectName: project?.name ?? "Unknown",
      agentId: formAgentId,
      agentName: agent?.name ?? "Unknown",
      enabled: true,
      schedule: formSchedule.trim(),
      lastRun: null,
      lastRunStatus: null,
    };

    setRoutines((prev) => [newRoutine, ...prev]);
    setFormName("");
    setFormProjectId("");
    setFormAgentId("");
    setFormSchedule("");
    setCreating(false);
  };

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved from orchestration data." href="/" />;
  }

  return (
    <CompanyShell
      eyebrow="Routines"
      title="Routines"
      description="Recurring work definitions that materialize into auditable execution issues."
      accentColor="#a8a29e"
    >
      {activeProjectRecord ? (
        <ActiveProjectBanner companySlug={slug} project={activeProjectRecord} onClear={clearActiveProject} compact />
      ) : null}

      {/* header row */}
      <div className="flex items-center justify-between">
        <div />
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "8px 16px",
            borderRadius: "10px",
            border: "1px solid rgba(120,113,108,0.4)",
            background: "rgba(41,37,36,0.55)",
            color: "#d6d3d1",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 120ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.border = "1px solid rgba(168,162,158,0.5)";
            e.currentTarget.style.background = "rgba(68,64,60,0.6)";
            e.currentTarget.style.color = "#f5f5f4";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.border = "1px solid rgba(120,113,108,0.4)";
            e.currentTarget.style.background = "rgba(41,37,36,0.55)";
            e.currentTarget.style.color = "#d6d3d1";
          }}
        >
          <Plus size={14} strokeWidth={2.2} />
          Create routine
        </button>
      </div>

      {/* create form */}
      {creating ? (
        <div
          style={{
            borderRadius: "14px",
            border: "1px solid rgba(120,113,108,0.3)",
            background: "rgba(28,25,23,0.7)",
            padding: "20px",
          }}
        >
          <h3 style={{ marginBottom: "16px", fontSize: "13px", fontWeight: 600, color: "#f5f5f4" }}>
            New Routine
          </h3>
          <div className="grid gap-3 lg:grid-cols-12">
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Routine name"
              className="lg:col-span-4"
              style={{
                borderRadius: "10px",
                border: "1px solid rgba(120,113,108,0.3)",
                background: "rgba(41,37,36,0.5)",
                padding: "8px 12px",
                fontSize: "13px",
                color: "#f5f5f4",
                outline: "none",
              }}
            />
            <select
              value={formProjectId}
              onChange={(e) => setFormProjectId(e.target.value)}
              className="lg:col-span-3"
              style={{
                borderRadius: "10px",
                border: "1px solid rgba(120,113,108,0.3)",
                background: "rgba(41,37,36,0.5)",
                padding: "8px 12px",
                fontSize: "13px",
                color: "#d6d3d1",
                outline: "none",
              }}
            >
              <option value="">Select project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              value={formAgentId}
              onChange={(e) => setFormAgentId(e.target.value)}
              className="lg:col-span-3"
              style={{
                borderRadius: "10px",
                border: "1px solid rgba(120,113,108,0.3)",
                background: "rgba(41,37,36,0.5)",
                padding: "8px 12px",
                fontSize: "13px",
                color: "#d6d3d1",
                outline: "none",
              }}
            >
              <option value="">Select agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <input
              value={formSchedule}
              onChange={(e) => setFormSchedule(e.target.value)}
              placeholder="Schedule (e.g. every day at 7am)"
              className="lg:col-span-8"
              style={{
                borderRadius: "10px",
                border: "1px solid rgba(120,113,108,0.3)",
                background: "rgba(41,37,36,0.5)",
                padding: "8px 12px",
                fontSize: "13px",
                color: "#f5f5f4",
                outline: "none",
              }}
            />
            <div className="flex gap-2 lg:col-span-4">
              <button
                type="button"
                onClick={handleCreate}
                style={{
                  flex: 1,
                  borderRadius: "10px",
                  border: "1px solid rgba(120,113,108,0.4)",
                  background: "rgba(68,64,60,0.5)",
                  padding: "8px 12px",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#f5f5f4",
                  cursor: "pointer",
                }}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                style={{
                  borderRadius: "10px",
                  border: "1px solid rgba(120,113,108,0.25)",
                  background: "rgba(41,37,36,0.4)",
                  padding: "8px 12px",
                  fontSize: "13px",
                  color: "#a8a29e",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* routines table */}
      <div
        style={{
          borderRadius: "14px",
          border: "1px solid rgba(120,113,108,0.25)",
          background: "rgba(28,25,23,0.65)",
          overflow: "hidden",
        }}
      >
        {/* search */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(120,113,108,0.18)" }}>
          <div style={{ position: "relative", maxWidth: "320px" }}>
            <Search
              size={14}
              style={{
                position: "absolute",
                left: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "#78716c",
                pointerEvents: "none",
              }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search routines"
              style={{
                width: "100%",
                borderRadius: "10px",
                border: "1px solid rgba(120,113,108,0.3)",
                background: "rgba(41,37,36,0.5)",
                padding: "8px 12px 8px 32px",
                fontSize: "13px",
                color: "#f5f5f4",
                outline: "none",
              }}
            />
          </div>
        </div>

        {/* column headers */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr 80px 40px",
            alignItems: "center",
            padding: "10px 20px",
            borderBottom: "1px solid rgba(120,113,108,0.18)",
          }}
        >
          {["Name", "Project", "Agent", "Last run", "Enabled", ""].map((h) => (
            <span
              key={h || "actions"}
              style={{
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#78716c",
              }}
            >
              {h}
            </span>
          ))}
        </div>

        {/* rows */}
        {filteredRoutines.length === 0 ? (
          <div style={{ padding: "48px 20px", textAlign: "center" }}>
            {loading ? (
              <p style={{ fontSize: "13px", color: "#78716c" }}>Loading...</p>
            ) : routines.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "14px",
                    border: "1px dashed rgba(120,113,108,0.4)",
                    background: "rgba(41,37,36,0.3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Workflow size={20} color="#78716c" />
                </div>
                <p style={{ fontSize: "13px", fontWeight: 500, color: "#d6d3d1" }}>No routines yet</p>
                <p style={{ fontSize: "12px", color: "#78716c" }}>
                  Create your first routine to schedule recurring work for your agents.
                </p>
              </div>
            ) : (
              <p style={{ fontSize: "13px", color: "#78716c" }}>No routines matched this filter.</p>
            )}
          </div>
        ) : (
          filteredRoutines.map((routine) => (
            <div
              key={routine.id}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr 80px 40px",
                alignItems: "center",
                padding: "14px 20px",
                borderBottom: "1px solid rgba(120,113,108,0.1)",
                transition: "background 120ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {/* name */}
              <span style={{ fontSize: "13px", fontWeight: 500, color: "#f5f5f4" }}>{routine.name}</span>

              {/* project */}
              <span style={{ fontSize: "13px", color: "#a8a29e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {routine.projectName}
              </span>

              {/* agent */}
              <span style={{ fontSize: "13px", color: "#a8a29e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {routine.agentName}
              </span>

              {/* last run */}
              <div>
                {routine.lastRun ? (
                  <span style={{ fontSize: "12px", color: "#a8a29e" }}>
                    {new Date(routine.lastRun).toLocaleString()}
                  </span>
                ) : (
                  <span style={{ fontSize: "12px", color: "#57534e" }}>Never run</span>
                )}
              </div>

              {/* toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button
                  type="button"
                  onClick={() => {
                    setRoutines((prev) =>
                      prev.map((r) =>
                        r.id === routine.id ? { ...r, enabled: !r.enabled } : r
                      )
                    );
                  }}
                  aria-label={routine.enabled ? "Disable routine" : "Enable routine"}
                  style={{
                    position: "relative",
                    width: "36px",
                    height: "20px",
                    borderRadius: "999px",
                    border: "none",
                    background: routine.enabled
                      ? "rgba(168,162,158,0.45)"
                      : "rgba(68,64,60,0.4)",
                    cursor: "pointer",
                    transition: "background 120ms ease",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: "2px",
                      width: "16px",
                      height: "16px",
                      borderRadius: "999px",
                      background: routine.enabled ? "#f5f5f4" : "#78716c",
                      transition: "transform 120ms ease",
                      transform: routine.enabled ? "translateX(18px)" : "translateX(2px)",
                    }}
                  />
                </button>
                <span style={{ fontSize: "11px", color: "#78716c" }}>
                  {routine.enabled ? "On" : "Off"}
                </span>
              </div>

              {/* more */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  aria-label="More options"
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "8px",
                    border: "1px solid rgba(120,113,108,0.25)",
                    background: "transparent",
                    color: "#78716c",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    transition: "all 120ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.border = "1px solid rgba(120,113,108,0.4)";
                    e.currentTarget.style.color = "#d6d3d1";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.border = "1px solid rgba(120,113,108,0.25)";
                    e.currentTarget.style.color = "#78716c";
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </CompanyShell>
  );
}
