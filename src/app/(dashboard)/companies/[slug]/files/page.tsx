"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Archive, Folder, GitBranch, Grid3X3, List } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FileBrowser } from "@/components/FileBrowser";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";

interface Workspace {
  id: string;
  name: string;
  emoji?: string | null;
  avatarUrl?: string | null;
  path: string;
  group?: string;
  kind?: string;
  exists?: boolean;
  writable?: boolean;
  source?: string;
  description?: string;
  projectId?: string;
  projectSlug?: string;
  projectName?: string;
  agentName?: string;
  agentId?: string;
  agentSlug?: string;
}

type ProjectWorkspaceGroup = {
  id: string;
  name: string;
  rows: Workspace[];
};

function WorkspaceIcon({ workspace }: { workspace: Workspace }) {
  if (workspace.kind === "agent_memory") {
    if (workspace.avatarUrl) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={workspace.avatarUrl}
          alt=""
          style={{
            width: "22px",
            height: "22px",
            borderRadius: "999px",
            objectFit: "cover",
            flexShrink: 0,
            border: "1px solid var(--border)",
          }}
        />
      );
    }

    return (
      <span
        style={{
          width: "22px",
          height: "22px",
          borderRadius: "999px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          color: "var(--text-secondary)",
          border: "1px solid var(--border)",
          background: "var(--surface-hover)",
        }}
      >
        <AvatarGlyph value={workspace.emoji} size={13} />
      </span>
    );
  }

  const Icon =
    workspace.kind === "project_source" ? GitBranch : workspace.kind === "project_files" ? Folder : Archive;
  const color =
    workspace.kind === "project_files"
      ? "#F59E0B"
      : workspace.kind === "project_source"
        ? "var(--text-secondary)"
        : "var(--text-muted)";

  return (
    <span
      style={{
        width: "22px",
        height: "22px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color,
      }}
    >
      <Icon size={18} />
    </span>
  );
}

function displayWorkspaceName(workspace: Workspace): string {
  if (workspace.kind === "company") {
    return workspace.name.replace(/\s+company files$/i, "");
  }
  if (workspace.kind === "agent_memory") {
    return workspace.name.replace(/\s+memory$/i, "");
  }
  return workspace.name;
}

export default function FilesPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = params?.slug ?? "";
  const requestedWorkspace = searchParams.get("workspace");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  useEffect(() => {
    const query = slug ? `?company=${encodeURIComponent(slug)}` : "";

    fetch(`/api/files/workspaces${query}`)
      .then((res) => res.json())
      .then((data) => {
        const rows: Workspace[] = data.workspaces || [];
        setWorkspaces(rows);
        if (rows.length > 0) {
          const requested = requestedWorkspace
            ? rows.find((row) => row.id === requestedWorkspace && row.exists !== false)
            : null;
          setSelectedWorkspace((requested ?? rows.find((row) => row.exists !== false) ?? rows[0]).id);
        }
      })
      .catch(() => setWorkspaces([]));
  }, [slug, requestedWorkspace]);

  const handleWorkspaceSelect = (workspaceId: string) => {
    setSelectedWorkspace(workspaceId);
    setCurrentPath("");
  };

  const selectedWorkspaceData = workspaces.find((w) => w.id === selectedWorkspace);
  const workspaceGroups = useMemo(() => {
    const projectMap = new Map<string, ProjectWorkspaceGroup>();
    const otherGroups = new Map<string, Workspace[]>();
    const companyRows: Workspace[] = [];
    const agentRows: Workspace[] = [];

    for (const workspace of workspaces) {
      const group = workspace.group || "Workspaces";
      if (group === "Company") {
        companyRows.push(workspace);
        continue;
      }
      if (group === "Agents") {
        agentRows.push(workspace);
        continue;
      }
      if (group === "Projects") {
        const projectId = workspace.projectId || workspace.projectSlug || workspace.name;
        const projectName = workspace.projectName || workspace.projectSlug || workspace.name;
        const existing = projectMap.get(projectId) || { id: projectId, name: projectName, rows: [] };
        existing.rows.push(workspace);
        projectMap.set(projectId, existing);
        continue;
      }
      otherGroups.set(group, [...(otherGroups.get(group) || []), workspace]);
    }

    const projectGroups = Array.from(projectMap.values())
      .map((project) => ({
        ...project,
        rows: project.rows.sort((a, b) => {
          const order = (workspace: Workspace) =>
            workspace.kind === "project_files" ? 0 : workspace.kind === "project_source" ? 1 : 2;
          return order(a) - order(b) || a.name.localeCompare(b.name);
        }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      companyRows,
      projectGroups,
      agentRows,
      otherGroups: Array.from(otherGroups.entries()),
    };
  }, [workspaces]);

  const renderWorkspaceButton = (
    workspace: Workspace,
    options: { label?: string; description?: string; indent?: boolean } = {},
  ) => {
    const isSelected = selectedWorkspace === workspace.id;
    const isMissing = workspace.exists === false;
    const label = options.label || displayWorkspaceName(workspace);
    const description =
      options.description ||
      (isMissing ? "Missing on disk" : workspace.description || workspace.source || workspace.agentName || workspace.kind);

    return (
      <button
        key={workspace.id}
        onClick={() => {
          if (!isMissing) handleWorkspaceSelect(workspace.id);
        }}
        disabled={isMissing}
        title={workspace.path}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: options.indent ? "7px 16px 7px 28px" : "9px 16px",
          background: isSelected ? "var(--surface-hover)" : "transparent",
          border: "none",
          borderLeft: isSelected ? "3px solid var(--border-strong)" : "3px solid transparent",
          cursor: isMissing ? "not-allowed" : "pointer",
          textAlign: "left",
          transition: "all 120ms ease",
          opacity: isMissing ? 0.55 : 1,
        }}
        onMouseEnter={(e) => {
          if (!isSelected && !isMissing) e.currentTarget.style.background = "var(--surface-hover)";
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = "transparent";
        }}
      >
        <WorkspaceIcon workspace={workspace} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: options.indent ? "12.5px" : "13px",
              fontWeight: isSelected ? 600 : 400,
              color: "var(--text-primary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: "11px",
              color: "var(--text-muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {description}
          </div>
        </div>
      </button>
    );
  };

  const selectedDisplayName = selectedWorkspaceData ? displayWorkspaceName(selectedWorkspaceData) : "";
  const selectedDescription = selectedWorkspaceData?.description || "";

  const renderSectionTitle = (title: string) => (
    <p
      style={{
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.08em",
        color: "var(--text-muted)",
        padding: "0 16px 8px",
        textTransform: "uppercase",
      }}
    >
      {title}
    </p>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: "0" }}>
      {/* Page header */}
      <div style={{ padding: "24px 24px 16px 24px" }}>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "17px",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            color: "var(--text-primary)",
            marginBottom: "4px",
          }}
        >
          Files
        </h1>
        <p style={{ fontFamily: "var(--font-body)", fontSize: "13px", color: "var(--text-secondary)" }}>
          Browse workspaces and agent files
        </p>
      </div>

      {/* Two-column layout */}
      <div
        style={{
          display: "flex",
          flex: 1,
          overflow: "hidden",
          borderTop: "1px solid var(--border)",
        }}
      >
        {/* ── LEFT SIDEBAR: Workspace list ─────────────────────────────────── */}
        <aside
          style={{
            width: "220px",
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            overflowY: "auto",
            padding: "16px 0",
            backgroundColor: "var(--surface, var(--card))",
          }}
        >
          {workspaceGroups.companyRows.length > 0 && (
            <div style={{ marginBottom: "14px" }}>
              {renderSectionTitle("Company")}
              {workspaceGroups.companyRows.map((workspace) => renderWorkspaceButton(workspace))}
            </div>
          )}

          {workspaceGroups.projectGroups.length > 0 && (
            <div style={{ marginBottom: "14px" }}>
              {renderSectionTitle("Projects")}
              {workspaceGroups.projectGroups.map((project) => (
                <div key={project.id} style={{ marginBottom: "8px" }}>
                  <div
                    style={{
                      padding: "2px 16px 5px 28px",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "var(--text-secondary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {project.name}
                  </div>
                  {project.rows.map((workspace) =>
                    renderWorkspaceButton(workspace, {
                      indent: true,
                      label:
                        workspace.kind === "project_files"
                          ? "Project files"
                          : workspace.kind === "project_source"
                            ? "Source repo"
                            : workspace.name,
                      description:
                        workspace.kind === "project_files"
                          ? "Managed plans, notes, and artifacts"
                          : workspace.kind === "project_source"
                            ? "Linked code workspace"
                            : undefined,
                    }),
                  )}
                </div>
              ))}
            </div>
          )}

          {workspaceGroups.agentRows.length > 0 && (
            <div style={{ marginBottom: "14px" }}>
              {renderSectionTitle("Agents")}
              {workspaceGroups.agentRows.map((workspace) => renderWorkspaceButton(workspace))}
            </div>
          )}

          {workspaceGroups.otherGroups.map(([group, rows]) => (
            <div key={group} style={{ marginBottom: "14px" }}>
              {renderSectionTitle(group)}
              {rows.map((workspace) => renderWorkspaceButton(workspace))}
            </div>
          ))}
        </aside>

        {/* ── RIGHT PANEL: File explorer ────────────────────────────────────── */}
        <main style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {selectedWorkspace && selectedWorkspaceData ? (
            <>
              {/* Breadcrumb bar + view toggle */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 16px",
                  borderBottom: "1px solid var(--border)",
                  backgroundColor: "var(--surface, var(--card))",
                  flexShrink: 0,
                  gap: "12px",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 }}>
                    <Breadcrumbs
                      path={currentPath}
                      onNavigate={setCurrentPath}
                      prefix={selectedDisplayName}
                    />
                    {!currentPath && selectedDescription ? (
                      <span
                        style={{
                          color: "var(--text-muted)",
                          fontSize: "12px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={selectedDescription}
                      >
                        {selectedDescription}
                      </span>
                    ) : null}
                  </div>
                  <div
                    title={selectedWorkspaceData.path}
                    style={{
                      marginTop: "3px",
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-mono, monospace)",
                      fontSize: "11px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {selectedWorkspaceData.path}
                  </div>
                </div>

                {/* View mode toggle */}
                <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                  <button
                    onClick={() => setViewMode("list")}
                    title="List view"
                    style={{
                      padding: "5px 7px",
                      borderRadius: "6px",
                      border: "0.5px solid transparent",
                      cursor: "pointer",
                      backgroundColor: viewMode === "list" ? "var(--surface-hover)" : "transparent",
                      color: viewMode === "list" ? "var(--text-primary)" : "var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 120ms ease",
                    }}
                  >
                    <List size={15} />
                  </button>
                  <button
                    onClick={() => setViewMode("grid")}
                    title="Grid view"
                    style={{
                      padding: "5px 7px",
                      borderRadius: "6px",
                      border: "0.5px solid transparent",
                      cursor: "pointer",
                      backgroundColor: viewMode === "grid" ? "var(--surface-hover)" : "transparent",
                      color: viewMode === "grid" ? "var(--text-primary)" : "var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 120ms ease",
                    }}
                  >
                    <Grid3X3 size={15} />
                  </button>
                </div>
              </div>

              {/* File list */}
              <div style={{ flex: 1, padding: "0" }}>
                <FileBrowser
                  workspace={selectedWorkspace}
                  path={currentPath}
                  onNavigate={setCurrentPath}
                  viewMode={viewMode}
                  emptyTitle={
                    selectedWorkspaceData.kind === "project_files" ? "No project files yet" : undefined
                  }
                  emptyDescription={
                    selectedWorkspaceData.kind === "project_files"
                      ? "This managed project workspace is ready for plans, notes, and artifacts."
                      : undefined
                  }
                  hiddenRootNames={selectedWorkspaceData.kind === "company" ? ["scripts", "source"] : []}
                />
              </div>
            </>
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-muted)",
                fontSize: "14px",
              }}
            >
              Select a workspace to explore its files
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
