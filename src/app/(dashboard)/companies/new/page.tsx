"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  FolderGit2,
  Crown,
  ClipboardList,
  Rocket,
  Check,
  ChevronRight,
  ChevronLeft,
  SkipForward,
  Loader2,
  Sparkles,
  AlertCircle,
  X,
  Users,
  Plus,
  Trash2,
  ImageIcon,
  Mic2,
} from "lucide-react";

import {
  COMPANY_WIZARD_STATIC_MODEL_OPTIONS,
  createInitialCompanyWizardData,
} from "@/lib/orchestration/company-wizard";
import {
  STARTER_TEAM_TEMPLATES,
  cloneStarterTeamRoles,
  getStarterTeamTemplate,
  type StarterTeamSelectedRoleCard,
  type StarterTeamWorkType,
} from "@/lib/orchestration/starter-team-templates";
import {
  listBuiltInStarterSprintTemplates,
  type BuiltInStarterSprintTemplate,
  type StarterSprintIntakeQuestion,
} from "@/lib/orchestration/starter-sprint-templates";

type FirstWorkMode = "template" | "task";
type FirstWorkTemplateData = {
  mode: FirstWorkMode;
  templateId: string;
  goalName: string;
  answers: Record<string, string | string[]>;
};

interface WizardData {
  company: { name: string; description: string; slug: string };
  owner: { displayName: string; email: string };
  project: { name: string; description: string; sourceWorkspaceRoot?: string } | null;
  starterTeam: { workType: StarterTeamWorkType; agents: StarterTeamSelectedRoleCard[] };
  ceo: { name: string; model: string; guidance: string };
  firstWork: FirstWorkTemplateData;
  task: { title: string; description: string; priority: string };
}

const STEPS = [
  { num: 1, label: "Company", icon: Building2 },
  { num: 2, label: "Project", icon: FolderGit2 },
  { num: 3, label: "Team", icon: Users },
  { num: 4, label: "CEO", icon: Crown },
  { num: 5, label: "First Work", icon: ClipboardList },
  { num: 6, label: "Launch", icon: Rocket },
];

function slugify(s: string) {
  return s
    .replace(/'/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
        {label}
        {required && <span className="ml-1 text-[var(--accent)]">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]";
const selectClass =
  "w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] transition-colors focus:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]";

const STARTER_SPRINT_TEMPLATES = [...listBuiltInStarterSprintTemplates()];

function defaultTemplateAnswer(question: StarterSprintIntakeQuestion): string | string[] {
  if (question.type === "multi_select") {
    return Array.isArray(question.defaultValue) ? [...question.defaultValue] : [];
  }
  return typeof question.defaultValue === "string" ? question.defaultValue : "";
}

function defaultTemplateAnswers(template: BuiltInStarterSprintTemplate): Record<string, string | string[]> {
  return Object.fromEntries(template.intake.questions.map((question) => [question.id, defaultTemplateAnswer(question)]));
}

function templateQuestionAnswered(question: StarterSprintIntakeQuestion, value: string | string[] | undefined): boolean {
  if (!question.required) return true;
  if (question.type === "multi_select") return Array.isArray(value) && value.length > 0;
  return typeof value === "string" && value.trim().length > 0;
}

function defaultTemplateGoalName(template: BuiltInStarterSprintTemplate): string {
  return `${template.draftOutputs.goal.title}: ${template.shortName}`.slice(0, 150);
}

function createInitialFirstWork(): FirstWorkTemplateData {
  const template = STARTER_SPRINT_TEMPLATES[0]!;
  return {
    mode: "template",
    templateId: template.id,
    goalName: defaultTemplateGoalName(template),
    answers: defaultTemplateAnswers(template),
  };
}

function firstWorkValidationMessage(firstWork: FirstWorkTemplateData): string | null {
  if (firstWork.mode === "task") return null;
  const template = STARTER_SPRINT_TEMPLATES.find((item) => item.id === firstWork.templateId) ?? STARTER_SPRINT_TEMPLATES[0]!;
  if (!firstWork.goalName.trim()) return "Name the first template goal.";
  const missing = template.intake.questions.find((question) => !templateQuestionAnswered(question, firstWork.answers[question.id]));
  return missing ? `${missing.label} is required.` : null;
}

function templateAnswerPayload(answers: Record<string, string | string[]>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(answers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.filter(Boolean) : value.trim(),
    ]),
  );
}

function StepIndicator({ current, completed }: { current: number; completed: Set<number> }) {
  return (
    <div className="mb-8 grid select-none grid-cols-3 gap-3 sm:flex sm:items-center sm:justify-center sm:gap-0">
      {STEPS.map((step, i) => {
        const done = completed.has(step.num);
        const active = step.num === current;
        const future = !done && !active;
        const Icon = step.icon;
        return (
          <div key={step.num} className="flex min-w-0 items-center justify-center">
            {i > 0 && (
              <div
                className={`hidden h-0.5 w-10 sm:block ${done ? "bg-[var(--positive)]" : active ? "bg-[var(--accent)]" : "bg-[var(--border)]"} transition-colors`}
              />
            )}
            <div className="flex min-w-0 flex-col items-center gap-1">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-all ${
                  done
                    ? "bg-[var(--positive-soft)] text-[var(--positive)] ring-2 ring-[var(--positive-soft)]"
                    : active
                      ? "bg-[var(--accent-soft)] text-[var(--accent)] ring-2 ring-[var(--accent-soft)]"
                      : "bg-[var(--surface)] text-[var(--text-muted)] ring-1 ring-[var(--border)]"
                }`}
              >
                {done ? <Check size={16} /> : <Icon size={16} />}
              </div>
              <span
                className={`max-w-full truncate text-[10px] ${
                  done ? "text-[var(--positive)]" : active ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
                } ${future ? "opacity-50" : ""}`}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StepCompany({
  data,
  owner,
  onChange,
  onOwnerChange,
}: {
  data: WizardData["company"];
  owner: WizardData["owner"];
  onChange: (d: WizardData["company"]) => void;
  onOwnerChange: (d: WizardData["owner"]) => void;
}) {
  const setField = (k: keyof WizardData["company"], v: string) => {
    const next = { ...data, [k]: v };
    if (k === "name" && data.slug === slugify(data.name)) {
      next.slug = slugify(v);
    }
    onChange(next);
  };
  const setOwnerField = (k: keyof WizardData["owner"], v: string) => {
    onOwnerChange({ ...owner, [k]: v });
  };
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
          <Building2 size={20} className="text-[var(--accent)]" /> Company Details
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Name your company and describe its mission.</p>
      </div>
      <Field label="Company Name" required>
        <input className={inputClass} placeholder="e.g. Northstar Labs" value={data.name} onChange={(e) => setField("name", e.target.value)} />
      </Field>
      <Field label="Description / Mission">
        <textarea className={inputClass} rows={4} placeholder="What does this company do? What are its goals?" value={data.description} onChange={(e) => setField("description", e.target.value)} />
      </Field>
      <Field label="Slug (optional)">
        <input className={inputClass} placeholder="auto-generated from company name" value={data.slug} onChange={(e) => setField("slug", slugify(e.target.value))} />
        <p className="mt-1 text-xs text-[var(--text-muted)]">Leave blank to auto-generate from the company name. HiveRunner will assign an isolated workspace under the active lane root.</p>
      </Field>
      <div className="border-t border-[var(--border)] pt-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Owner</h3>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">This is the human account that owns the company and creates the launch task.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your Name" required>
          <input className={inputClass} placeholder="e.g. Jordan Lee" value={owner.displayName} onChange={(e) => setOwnerField("displayName", e.target.value)} />
        </Field>
        <Field label="Your Email" required>
          <input className={inputClass} type="email" placeholder="you@company.com" value={owner.email} onChange={(e) => setOwnerField("email", e.target.value)} />
        </Field>
      </div>
    </div>
  );
}

function StepProject({ data, onChange }: { data: WizardData["project"]; onChange: (d: WizardData["project"]) => void }) {
  const project = data ?? { name: "", description: "", sourceWorkspaceRoot: "" };
  const isCustom = Boolean(data);
  const setField = (k: keyof NonNullable<WizardData["project"]>, v: string) => onChange({ ...project, [k]: v });
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
          <FolderGit2 size={20} className="text-[var(--accent)]" /> Project Setup
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Optional. Launch with the default Operations project, or define a custom first project now.</p>
      </div>
      <div className={`rounded-lg border p-4 ${!isCustom ? "border-[var(--positive)] bg-[var(--positive-soft)]" : "border-[var(--border)] bg-[var(--surface)]"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Use default Operations project</p>
            <p className="text-sm text-[var(--text-secondary)]">Recommended for first launch. HiveRunner will create an Operations project automatically so the CEO can start working immediately.</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              !isCustom
                ? "bg-[var(--positive-soft)] text-[var(--positive)] ring-1 ring-[var(--positive)]"
                : "bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {!isCustom ? "Selected" : "Use Default"}
          </button>
        </div>
      </div>
      <div className={`rounded-lg border p-4 ${isCustom ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--surface)]"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Customize the first project</p>
            <p className="text-sm text-[var(--text-secondary)]">Use this only if you already know the first project structure you want created before launch.</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(data ?? { name: "", description: "" })}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              isCustom
                ? "bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[var(--accent)]"
                : "bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {isCustom ? "Customizing" : "Customize"}
          </button>
        </div>
        {isCustom && (
          <div className="mt-4 space-y-4 border-t border-[var(--border)] pt-4">
            <Field label="Project Name" required>
              <input className={inputClass} placeholder="e.g. Weather Edge" value={project.name} onChange={(e) => setField("name", e.target.value)} />
            </Field>
            <Field label="Description">
              <textarea className={inputClass} rows={3} placeholder="What is this project about?" value={project.description} onChange={(e) => setField("description", e.target.value)} />
            </Field>
            <Field label="Source Workspace">
              <input
                className={inputClass}
                placeholder="/path/to/loanmeld"
                value={project.sourceWorkspaceRoot ?? ""}
                onChange={(e) => setField("sourceWorkspaceRoot", e.target.value)}
              />
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Optional existing repo path. Leave blank to use the managed HiveRunner project workspace.
              </p>
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

function createCustomStarterRole(): StarterTeamSelectedRoleCard {
  const id = `custom-${Date.now().toString(36)}`;
  return {
    id,
    name: "",
    role: "",
    defaultSelected: true,
    selected: true,
    optional: true,
    custom: true,
    summary: "",
    mission: "",
    kickoffIntentCopy: "Support the first project with a custom operator-defined role.",
    capabilities: [],
    editableFields: ["selected", "name", "role", "summary", "mission", "capabilities", "reportsTo", "modelLane"],
    reportsTo: "ceo-or-lead",
    defaultRuntimeProvider: "manual",
    modelLane: "default",
    runtimeProvider: "manual",
    model: "",
  };
}

function starterTeamValidationMessage(starterTeam: WizardData["starterTeam"]) {
  const selectedRoles = starterTeam.agents.filter((agent) => agent.selected);
  const template = getStarterTeamTemplate(starterTeam.workType);
  const templateAllowsLeadOnly = starterTeam.workType === "blank-custom" || template.defaultSelectedRoleIds.length === 0;
  if (!templateAllowsLeadOnly && selectedRoles.length === 0) {
    return "Select at least one starter role, or choose Blank/custom.";
  }
  const incomplete = selectedRoles.find((agent) => !agent.name.trim() || !agent.role.trim());
  if (incomplete) {
    return "Selected roles need a name and role.";
  }
  return null;
}

function StepStarterTeam({
  data,
  onChange,
  onTaskChange,
}: {
  data: WizardData["starterTeam"];
  onChange: (d: WizardData["starterTeam"]) => void;
  onTaskChange: (d: WizardData["task"]) => void;
}) {
  const template = getStarterTeamTemplate(data.workType);
  const selectedRoles = data.agents.filter((agent) => agent.selected);
  const validationMessage = starterTeamValidationMessage(data);
  const isBlankCustom = data.workType === "blank-custom";

  const setWorkType = (workType: StarterTeamWorkType) => {
    const nextTemplate = getStarterTeamTemplate(workType);
    onChange({
      workType,
      agents: cloneStarterTeamRoles(workType),
    });
    onTaskChange({ ...nextTemplate.kickoffTask });
  };

  const updateAgent = (id: string, patch: Partial<StarterTeamSelectedRoleCard>) => {
    onChange({
      ...data,
      agents: data.agents.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent)),
    });
  };

  const removeAgent = (id: string) => {
    onChange({
      ...data,
      agents: data.agents.filter((agent) => agent.id !== id),
    });
  };

  const addCustomRole = () => {
    onChange({
      ...data,
      agents: [...data.agents, createCustomStarterRole()],
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
          <Users size={20} className="text-[var(--accent)]" /> Starter Team
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Pick the kind of work this company should start with, then review the recommended roles.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {STARTER_TEAM_TEMPLATES.map((item) => {
          const active = item.workTypeId === data.workType;
          return (
            <button
              key={item.workTypeId}
              type="button"
              onClick={() => setWorkType(item.workTypeId)}
              className={`min-h-[116px] rounded-lg border p-3 text-left transition-colors ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]"
                  : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--text-primary)]">{item.displayCopy.label}</span>
                {active ? <Check size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" /> : null}
              </span>
              <span className="mt-2 block text-xs leading-relaxed text-[var(--text-secondary)]">
                {item.displayCopy.selectionHint}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">{template.templateName}</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{template.displayCopy.headline}</p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">{template.displayCopy.body}</p>
          </div>
          <div className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            {selectedRoles.length} selected
          </div>
        </div>
        <div className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Leadership</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{template.leadershipRule.rule}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Runtime setup</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{template.providerKeyRequirement.setupCopy}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <ImageIcon size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Avatar setup</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              Selected starter agents include bundled portraits. New AI-generated avatars later require your own OpenAI key.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <Mic2 size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Voice setup</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              Selected starter agents include saved voice choices. Live voice calls require your own Gemini key; setup works without it.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Role cards</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Deselected roles stay visible so you can change your mind before launch.</p>
          </div>
          {!isBlankCustom ? (
            <button
              type="button"
              onClick={addCustomRole}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            >
              <Plus size={15} /> Add role
            </button>
          ) : null}
        </div>

        {data.agents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-center">
            <p className="text-sm font-semibold text-[var(--text-primary)]">No starter roles selected by default.</p>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Blank/custom will launch with the owner, lead, project, and kickoff task only. You can create custom roles after setup.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.agents.map((agent) => (
              <div
                key={agent.id}
                className={`rounded-lg border p-4 transition-colors ${
                  agent.selected
                    ? "border-[var(--border-strong)] bg-[var(--surface)]"
                    : "border-[var(--border)] bg-[var(--surface)] opacity-70"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-w-0 items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
                      checked={agent.selected}
                      onChange={(e) => updateAgent(agent.id, { selected: e.target.checked })}
                    />
                    {agent.identity?.avatarUrl ? (
                      <img
                        src={agent.identity.avatarUrl}
                        alt={`${agent.name || "Starter agent"} avatar`}
                        className="h-10 w-10 shrink-0 rounded-md border border-[var(--border)] object-cover"
                      />
                    ) : null}
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[var(--text-primary)]">
                        {agent.name.trim() || "Unnamed role"}
                      </span>
                      <span className="block text-xs text-[var(--text-muted)]">
                        {agent.optional || agent.custom ? "Optional" : "Recommended"}
                      </span>
                      {agent.identity?.voiceId ? (
                        <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                          <Mic2 size={11} className="text-[var(--accent)]" />
                          {agent.identity.voiceId}
                        </span>
                      ) : null}
                    </span>
                  </label>
                  {agent.custom ? (
                    <button
                      type="button"
                      onClick={() => removeAgent(agent.id)}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:border-[var(--negative)] hover:text-[var(--negative)]"
                      aria-label="Remove custom role"
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Name" required>
                    <input
                      className={inputClass}
                      value={agent.name}
                      onChange={(e) => updateAgent(agent.id, { name: e.target.value })}
                    />
                  </Field>
                  <Field label="Role" required>
                    <input
                      className={inputClass}
                      value={agent.role}
                      onChange={(e) => updateAgent(agent.id, { role: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="mt-3 space-y-3">
                  <Field label="Summary">
                    <input
                      className={inputClass}
                      value={agent.summary}
                      onChange={(e) => updateAgent(agent.id, { summary: e.target.value })}
                    />
                  </Field>
                  <Field label="Mission">
                    <textarea
                      className={inputClass}
                      rows={2}
                      value={agent.mission}
                      onChange={(e) => updateAgent(agent.id, { mission: e.target.value })}
                    />
                  </Field>
                  <Field label="Capabilities">
                    <textarea
                      className={inputClass}
                      rows={2}
                      value={agent.capabilities.join(", ")}
                      placeholder="Break down work, review evidence, prepare updates"
                      onChange={(e) =>
                        updateAgent(agent.id, {
                          capabilities: e.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="Reports to">
                    <select
                      className={selectClass}
                      value={agent.reportsTo}
                      onChange={(e) => updateAgent(agent.id, { reportsTo: e.target.value as StarterTeamSelectedRoleCard["reportsTo"] })}
                    >
                      <option value="ceo-or-lead">CEO or lead</option>
                      <option value="owner">Owner</option>
                    </select>
                  </Field>
                  <Field label="Model lane">
                    <select
                      className={selectClass}
                      value={agent.modelLane}
                      onChange={(e) => updateAgent(agent.id, { modelLane: e.target.value as StarterTeamSelectedRoleCard["modelLane"] })}
                    >
                      <option value="default">Default</option>
                      <option value="fast">Fast</option>
                      <option value="mini">Mini</option>
                      <option value="deep">Deep</option>
                    </select>
                  </Field>
                </div>
              </div>
            ))}
          </div>
        )}

        {validationMessage ? (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--negative)] bg-[var(--negative-soft)] p-3 text-sm text-[var(--negative)]">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {validationMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StepCEO({
  data,
  onChange,
  modelOptions,
  loadingModels,
}: {
  data: WizardData["ceo"];
  onChange: (d: WizardData["ceo"]) => void;
  modelOptions: Array<{ value: string; label: string }>;
  loadingModels: boolean;
}) {
  const setField = (k: keyof WizardData["ceo"], v: string) => onChange({ ...data, [k]: v });
  const resolvedModelOptions = loadingModels && modelOptions.length === 0
    ? [{ value: data.model, label: "Loading available models..." }]
    : modelOptions;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
          <Crown size={20} className="text-[var(--accent)]" /> Appoint your CEO
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Your CEO will lead this company, manage the team, and execute on the mission.</p>
      </div>
      <Field label="CEO Name" required>
        <input className={inputClass} placeholder='e.g. "Ridge", "Atlas", "Nova"' value={data.name} onChange={(e) => setField("name", e.target.value)} />
      </Field>
      <Field label="Model">
        <select
          className={selectClass}
          value={data.model}
          onChange={(e) => setField("model", e.target.value)}
          disabled={loadingModels && modelOptions.length === 0}
        >
          {resolvedModelOptions.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        {loadingModels && modelOptions.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--text-muted)]">Loading the full model catalog for this lane.</p>
        ) : null}
      </Field>
      <Field label="Additional Guidance">
        <textarea className={inputClass} rows={3} placeholder="Any specific instructions, personality traits, or leadership style notes for the CEO..." value={data.guidance} onChange={(e) => setField("guidance", e.target.value)} />
      </Field>
      <div className="flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] p-3">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
          Role, capabilities, SOUL.md, AGENTS.md, and HEARTBEAT.md will be <strong className="text-[var(--text-primary)]">AI-generated</strong> from your company mission. You don&apos;t need to write them.
        </p>
      </div>
    </div>
  );
}

function StepFirstWork({
  firstWork,
  task,
  onFirstWorkChange,
  onTaskChange,
}: {
  firstWork: WizardData["firstWork"];
  task: WizardData["task"];
  onFirstWorkChange: (d: WizardData["firstWork"]) => void;
  onTaskChange: (d: WizardData["task"]) => void;
}) {
  const selectedTemplate = STARTER_SPRINT_TEMPLATES.find((item) => item.id === firstWork.templateId) ?? STARTER_SPRINT_TEMPLATES[0]!;
  const validationMessage = firstWorkValidationMessage(firstWork);
  const setTaskField = (k: keyof WizardData["task"], v: string) => onTaskChange({ ...task, [k]: v });
  const setTemplateId = (templateId: string) => {
    const template = STARTER_SPRINT_TEMPLATES.find((item) => item.id === templateId) ?? STARTER_SPRINT_TEMPLATES[0]!;
    onFirstWorkChange({
      mode: "template",
      templateId: template.id,
      goalName: defaultTemplateGoalName(template),
      answers: defaultTemplateAnswers(template),
    });
  };
  const setTemplateAnswer = (questionId: string, value: string | string[]) => {
    onFirstWorkChange({
      ...firstWork,
      mode: "template",
      answers: { ...firstWork.answers, [questionId]: value },
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
          <ClipboardList size={20} className="text-[var(--accent)]" /> First Work
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Choose the first work path for this company.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onFirstWorkChange(firstWork.mode === "template" ? firstWork : createInitialFirstWork())}
          data-testid="first-work-template-mode"
          className={`rounded-lg border p-4 text-left transition-colors ${
            firstWork.mode === "template"
              ? "border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
          }`}
        >
          <span className="flex items-center justify-between gap-2 text-sm font-semibold text-[var(--text-primary)]">
            Template draft
            {firstWork.mode === "template" ? <Check size={15} className="text-[var(--accent)]" /> : null}
          </span>
          <span className="mt-2 block text-xs leading-relaxed text-[var(--text-secondary)]">
            Create an operator-reviewable sprint plan before board tasks exist.
          </span>
        </button>
        <button
          type="button"
          onClick={() => onFirstWorkChange({ ...firstWork, mode: "task" })}
          data-testid="first-work-task-mode"
          className={`rounded-lg border p-4 text-left transition-colors ${
            firstWork.mode === "task"
              ? "border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
          }`}
        >
          <span className="flex items-center justify-between gap-2 text-sm font-semibold text-[var(--text-primary)]">
            Kickoff task
            {firstWork.mode === "task" ? <Check size={15} className="text-[var(--accent)]" /> : null}
          </span>
          <span className="mt-2 block text-xs leading-relaxed text-[var(--text-secondary)]">
            Start with a single task assigned to the CEO.
          </span>
        </button>
      </div>

      {firstWork.mode === "template" ? (
        <div className="space-y-4" data-testid="first-work-template-picker">
          <Field label="Template" required>
            <select
              className={selectClass}
              value={selectedTemplate.id}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              {STARTER_SPRINT_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{selectedTemplate.summary}</p>
          </Field>
          <Field label="Goal Name" required>
            <input
              className={inputClass}
              value={firstWork.goalName}
              onChange={(event) => onFirstWorkChange({ ...firstWork, goalName: event.target.value })}
            />
          </Field>
          <div className="grid gap-4">
            {selectedTemplate.intake.questions.map((question) => (
              <TemplateQuestionInput
                key={question.id}
                question={question}
                value={firstWork.answers[question.id]}
                onChange={(value) => setTemplateAnswer(question.id, value)}
              />
            ))}
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-secondary)]">
            Draft plan only. The generated sprint and board tasks wait for operator approval or valid Delegated Signoff.
          </div>
          {validationMessage ? (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--negative)] bg-[var(--negative-soft)] p-3 text-sm text-[var(--negative)]">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {validationMessage}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-5" data-testid="first-work-task-fields">
          <Field label="Task Title" required>
            <input className={inputClass} value={task.title} onChange={(e) => setTaskField("title", e.target.value)} />
          </Field>
          <Field label="Description (Optional)">
            <textarea className={inputClass} rows={4} value={task.description} onChange={(e) => setTaskField("description", e.target.value)} />
          </Field>
        </div>
      )}
    </div>
  );
}

function TemplateQuestionInput({
  question,
  value,
  onChange,
}: {
  question: StarterSprintIntakeQuestion;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
}) {
  if (question.type === "single_select") {
    return (
      <div data-template-question-id={question.id}>
        <Field label={question.label} required={question.required}>
        <select
          className={selectClass}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        >
          {(question.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{question.helpText}</p>
        </Field>
      </div>
    );
  }

  if (question.type === "multi_select") {
    const values = new Set(Array.isArray(value) ? value : []);
    return (
      <fieldset data-template-question-id={question.id} className="space-y-2">
        <legend className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
          {question.label}
          {question.required ? <span className="ml-1 text-[var(--accent)]">*</span> : null}
        </legend>
        <p className="text-xs text-[var(--text-muted)]">{question.helpText}</p>
        <div className="flex flex-wrap gap-2">
          {(question.options ?? []).map((option) => {
            const checked = values.has(option.value);
            return (
              <label
                key={option.value}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                  checked
                    ? "border-[var(--border-strong)] bg-[var(--surface-hover)] text-[var(--text-primary)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const next = new Set(values);
                    if (event.target.checked) next.add(option.value);
                    else next.delete(option.value);
                    onChange([...next]);
                  }}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                {option.label}
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  const multiline = question.type === "long_text";
  return (
    <div data-template-question-id={question.id}>
      <Field label={question.label} required={question.required}>
      {multiline ? (
        <textarea
          className={inputClass}
          rows={4}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className={inputClass}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <p className="mt-1 text-xs text-[var(--text-muted)]">{question.helpText}</p>
      </Field>
    </div>
  );
}

function SummaryCard({ icon: Icon, title, children }: { icon: typeof Building2; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><Icon size={15} className="text-[var(--accent)]" /> {title}</h3>
      <div className="space-y-0.5 text-xs text-[var(--text-secondary)]">{children}</div>
    </div>
  );
}

function StepReview({ data, modelOptions }: { data: WizardData; modelOptions: Array<{ value: string; label: string }> }) {
  const selectedAgents = data.starterTeam.agents.filter((agent) => agent.selected);
  const selectedTemplate = getStarterTeamTemplate(data.starterTeam.workType);
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
          <Rocket size={20} className="text-[var(--accent)]" /> Review &amp; Launch
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Everything looks good? Hit Launch to create your company.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryCard icon={Building2} title="Company">
          <p><strong className="text-[var(--text-primary)]">{data.company.name}</strong></p>
          {data.company.description && <p className="line-clamp-2">{data.company.description}</p>}
          <p className="text-[var(--text-muted)]">slug: {data.company.slug}</p>
          <p className="text-[var(--text-muted)]">owner: {data.owner.displayName} · {data.owner.email}</p>
        </SummaryCard>
        {data.project ? (
          <SummaryCard icon={FolderGit2} title="Project">
            <p><strong className="text-[var(--text-primary)]">{data.project.name}</strong></p>
            {data.project.description && <p className="line-clamp-2">{data.project.description}</p>}
          </SummaryCard>
        ) : (
          <SummaryCard icon={FolderGit2} title="Project">
            <p><strong className="text-[var(--text-primary)]">Operations</strong></p>
            <p>HiveRunner will create the default Operations project at launch.</p>
          </SummaryCard>
        )}
        <SummaryCard icon={Users} title="Starter Team">
          <p><strong className="text-[var(--text-primary)]">{selectedTemplate.displayCopy.label}</strong></p>
          <p>{selectedAgents.length > 0 ? selectedAgents.map((agent) => `${agent.name} (${agent.role})`).join(", ") : "Lead only; no extra teammates selected."}</p>
        </SummaryCard>
        <SummaryCard icon={Crown} title="CEO">
          <p><strong className="text-[var(--text-primary)]">{data.ceo.name}</strong> <span className="text-[var(--text-muted)]">({modelOptions.find((m) => m.value === data.ceo.model)?.label})</span></p>
          <p className="flex items-center gap-1 text-[var(--accent)]"><Sparkles size={11} /> AI-generated identity files</p>
        </SummaryCard>
        <SummaryCard icon={ClipboardList} title="First Work">
          {data.firstWork.mode === "template" ? (
            <>
              <p><strong className="text-[var(--text-primary)]">{data.firstWork.goalName}</strong></p>
              <p className="line-clamp-3">
                {STARTER_SPRINT_TEMPLATES.find((template) => template.id === data.firstWork.templateId)?.name ?? "Template draft"} creates a draft plan for review.
              </p>
            </>
          ) : (
            <>
              <p><strong className="text-[var(--text-primary)]">{data.task.title}</strong></p>
              <p className="line-clamp-3">{data.task.description || "No additional task description provided."}</p>
            </>
          )}
        </SummaryCard>
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] p-4 text-sm text-[var(--text-secondary)]">
        Launch will create the company, preserve the CEO or lead, pass the selected starter roles forward, and open the first work surface.
      </div>
    </div>
  );
}

export default function CompanyOnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highestStepVisited, setHighestStepVisited] = useState(1);
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setModelsLoading(true);
    fetch("/api/orchestration/models")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (Array.isArray(d.models) && d.models.length > 0) {
          setModelOptions(d.models.map((m: { value: string; label: string }) => ({
            value: m.value,
            label: m.label,
          })));
        } else {
          setModelOptions(COMPANY_WIZARD_STATIC_MODEL_OPTIONS);
        }
      })
      .catch(() => {
        if (!active) return;
        setModelOptions(COMPANY_WIZARD_STATIC_MODEL_OPTIONS);
      })
      .finally(() => {
        if (active) setModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const [data, setData] = useState<WizardData>(() => ({
    ...createInitialCompanyWizardData(),
    firstWork: createInitialFirstWork(),
  }));

  const completed = useMemo(() => {
    const s = new Set<number>();
    const effectiveSlug = data.company.slug.trim() || slugify(data.company.name);
    if (highestStepVisited > 1 && data.company.name.trim() && effectiveSlug && data.owner.displayName.trim() && data.owner.email.trim()) s.add(1);
    if (highestStepVisited > 2 && (data.project === null || data.project.name.trim())) s.add(2);
    if (highestStepVisited > 3 && !starterTeamValidationMessage(data.starterTeam)) s.add(3);
    if (highestStepVisited > 4 && data.ceo.name.trim()) s.add(4);
    if (highestStepVisited > 5 && (data.firstWork.mode === "template" ? !firstWorkValidationMessage(data.firstWork) : data.task.title.trim())) s.add(5);
    return s;
  }, [data, highestStepVisited]);

  const canAdvance = useMemo(() => {
    if (step === 1) return !!data.company.name.trim() && !!(data.company.slug.trim() || slugify(data.company.name)) && !!data.owner.displayName.trim() && data.owner.email.includes("@");
    if (step === 2) return data.project === null || !!data.project.name.trim();
    if (step === 3) return !starterTeamValidationMessage(data.starterTeam);
    if (step === 4) return !!data.ceo.name.trim() && (!modelsLoading || modelOptions.length > 0);
    if (step === 5) return data.firstWork.mode === "template" ? !firstWorkValidationMessage(data.firstWork) : !!data.task.title.trim();
    return true;
  }, [step, data, modelOptions.length, modelsLoading]);

  const next = useCallback(() => {
    if (step < 6) {
      const nextStep = step + 1;
      setStep(nextStep);
      setHighestStepVisited((prev) => Math.max(prev, nextStep));
    }
  }, [step]);
  console.log(JSON.stringify({ step, data, modelsLoading, canAdvance }));
  const back = useCallback(() => {
    if (step > 1) setStep((s) => s - 1);
  }, [step]);
  const skipProject = useCallback(() => {
    setData((d) => ({ ...d, project: null }));
    setStep(3);
    setHighestStepVisited((prev) => Math.max(prev, 3));
  }, []);

  const launch = useCallback(async () => {
    setLaunching(true);
    setError(null);
    try {
      const payload = {
        ...data,
        company: {
          ...data.company,
          slug: data.company.slug.trim() || slugify(data.company.name),
        },
        starterTeam: {
          ...data.starterTeam,
          agents: data.starterTeam.agents.filter((agent) => agent.selected),
        },
        firstWorkMode: data.firstWork.mode,
        ...(data.firstWork.mode === "template"
          ? {
              templateLaunch: {
                templateId: data.firstWork.templateId,
                goalName: data.firstWork.goalName.trim(),
                answers: templateAnswerPayload(data.firstWork.answers),
              },
            }
          : {}),
      };
      const res = await fetch("/api/orchestration/companies/create-full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Launch failed");
      const launchHref = typeof json.boardHref === "string"
        ? json.boardHref
        : typeof json.taskHref === "string"
          ? json.taskHref
          : typeof json.dashboardHref === "string"
            ? json.dashboardHref
          : typeof json.company?.slug === "string"
            ? `/companies/${encodeURIComponent(json.company.slug)}/dashboard`
            : "/";
      router.replace(launchHref);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLaunching(false);
    }
  }, [data, router]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create company"
      className="fixed inset-0 z-[90] bg-[var(--modal-backdrop)] backdrop-blur-[10px]"
    >
      <div className="flex h-full w-full items-start justify-center overflow-y-auto px-3 py-5 sm:px-5 md:px-8">
        <div className="w-full max-w-5xl rounded-lg border border-[var(--border)] bg-[var(--modal-glass)] p-5 shadow-[var(--shadow-glass)] ring-1 ring-white/[0.03] md:p-7">
          <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Create Company</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal text-[var(--text-primary)]">Launch a New Company</h1>
              <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">Build a fully operational AI company in six steps.</p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/companies")}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              aria-label="Close company wizard"
            >
              <X size={15} />
            </button>
          </header>

          <StepIndicator current={step} completed={completed} />

          {step === 1 && (
            <StepCompany
              data={data.company}
              owner={data.owner}
              onChange={(c) => setData((d) => ({ ...d, company: c }))}
              onOwnerChange={(owner) => setData((d) => ({ ...d, owner }))}
            />
          )}
          {step === 2 && <StepProject data={data.project} onChange={(p) => setData((d) => ({ ...d, project: p }))} />}
          {step === 3 && (
            <StepStarterTeam
              data={data.starterTeam}
              onChange={(starterTeam) => setData((d) => ({ ...d, starterTeam }))}
              onTaskChange={(task) => setData((d) => ({ ...d, task }))}
            />
          )}
          {step === 4 && (
            <StepCEO
              data={data.ceo}
              onChange={(c) => setData((d) => ({ ...d, ceo: c }))}
              modelOptions={modelOptions}
              loadingModels={modelsLoading}
            />
          )}
          {step === 5 && (
            <StepFirstWork
              firstWork={data.firstWork}
              task={data.task}
              onFirstWorkChange={(firstWork) => setData((d) => ({ ...d, firstWork }))}
              onTaskChange={(task) => setData((d) => ({ ...d, task }))}
            />
          )}
          {step === 6 && <StepReview data={data} modelOptions={modelOptions} />}
          {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--negative)] bg-[var(--negative-soft)] p-3 text-sm text-[var(--negative)]"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</div>}
          <div className="mt-8 flex items-center justify-between gap-4 border-t border-[var(--border)] pt-5">
            <div>{step > 1 && <button onClick={back} disabled={launching} className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-40"><ChevronLeft size={16} /> Back</button>}</div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {step === 2 && <button onClick={skipProject} className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"><SkipForward size={14} /> Use Default</button>}
              {step < 6 && <button onClick={next} disabled={!canAdvance} className="hr-primary-cta flex items-center gap-1.5 rounded-md px-5 py-2.5 text-sm font-medium transition-colors">Next <ChevronRight size={16} /></button>}
              {step === 6 && <button onClick={launch} disabled={launching || !completed.has(1) || !completed.has(3) || !completed.has(4) || !completed.has(5)} className="hr-primary-cta flex items-center gap-2 rounded-md px-6 py-2.5 text-sm font-semibold transition-colors">{launching ? <><Loader2 size={16} className="animate-spin" /> Creating company...</> : <><Rocket size={16} /> Launch Company</>}</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
