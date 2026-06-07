"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Layers3, Loader2, Plus, Sparkles, X } from "lucide-react";

import {
  createCompanyGoal,
  createProject,
  createTemplateDraftPlan,
} from "@/lib/orchestration/client";
import { buildCanonicalGoalPath, goalRouteKey } from "@/lib/orchestration/route-paths";
import {
  listBuiltInStarterSprintTemplates,
  type BuiltInStarterSprintTemplate,
  type StarterSprintIntakeQuestion,
} from "@/lib/orchestration/starter-sprint-templates";
import type {
  OrchestrationCompanyGoal,
  OrchestrationTemplateDraftPlan,
  TaskExecutionEngine,
  TaskModelLane,
} from "@/lib/orchestration/types";

export type CreatedTemplateDraft = {
  goal: OrchestrationCompanyGoal;
  draftPlan: OrchestrationTemplateDraftPlan;
};

type ExistingGoalTarget = {
  goalId: string;
  goalName: string;
  defaultExecutionEngine?: TaskExecutionEngine | null;
  defaultModelLane?: TaskModelLane | null;
};

type TemplateLaunchDialogProps = {
  companySlug: string;
  companyCode: string;
  launchSource: "goals" | "goal-detail" | "projects" | "project-detail";
  triggerLabel?: string;
  triggerTitle?: string;
  dialogTitle?: string;
  existingGoal?: ExistingGoalTarget;
  projectId?: string;
  projectName?: string;
  newProject?: {
    companyId: string;
    initialName?: string;
  };
  onCreated?: (created: CreatedTemplateDraft) => void | Promise<void>;
  redirectOnCreated?: boolean;
};

function defaultAnswerForQuestion(question: StarterSprintIntakeQuestion): string | string[] {
  if (question.type === "multi_select") {
    return Array.isArray(question.defaultValue) ? [...question.defaultValue] : [];
  }
  return typeof question.defaultValue === "string" ? question.defaultValue : "";
}

function initialAnswers(template: BuiltInStarterSprintTemplate): Record<string, string | string[]> {
  return Object.fromEntries(
    template.intake.questions.map((question) => [question.id, defaultAnswerForQuestion(question)]),
  );
}

function isQuestionAnswered(question: StarterSprintIntakeQuestion, value: string | string[] | undefined): boolean {
  if (!question.required) return true;
  if (question.type === "multi_select") return Array.isArray(value) && value.length > 0;
  return typeof value === "string" && value.trim().length > 0;
}

function summarizeAnswer(question: StarterSprintIntakeQuestion, value: string | string[] | undefined): string {
  if (question.type === "multi_select") {
    const values = Array.isArray(value) ? value : [];
    return values
      .map((item) => question.options?.find((option) => option.value === item)?.label ?? item)
      .join(", ");
  }
  const text = typeof value === "string" ? value : "";
  return question.options?.find((option) => option.value === text)?.label ?? text;
}

function defaultGoalName(template: BuiltInStarterSprintTemplate, answers: Record<string, string | string[]>): string {
  const firstQuestion = template.intake.questions[0];
  const suffix = firstQuestion ? summarizeAnswer(firstQuestion, answers[firstQuestion.id]).trim() : "";
  return [template.draftOutputs.goal.title, suffix].filter(Boolean).join(": ").slice(0, 150);
}

function defaultProjectName(template: BuiltInStarterSprintTemplate): string {
  return `${template.shortName} Project`.slice(0, 120);
}

function answerPayload(answers: Record<string, string | string[]>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(answers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.filter(Boolean) : value.trim(),
    ]),
  );
}

const fieldStyle: CSSProperties = {
  width: "100%",
  borderRadius: 8,
  border: "0.5px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-primary)",
  padding: "9px 11px",
  fontSize: 13,
  outline: "none",
};

const secondaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  borderRadius: 8,
  border: "0.5px solid var(--border-strong)",
  background: "transparent",
  color: "var(--text-secondary)",
  fontSize: 13,
  fontWeight: 550,
  padding: "8px 13px",
  cursor: "pointer",
};

export function TemplateLaunchDialog({
  companySlug,
  companyCode,
  launchSource,
  triggerLabel = "Start from template",
  triggerTitle,
  dialogTitle,
  existingGoal,
  projectId,
  projectName,
  newProject,
  onCreated,
  redirectOnCreated = true,
}: TemplateLaunchDialogProps) {
  const router = useRouter();
  const templates = useMemo(() => [...listBuiltInStarterSprintTemplates()], []);
  const [open, setOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id ?? "build-something");
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0]!;
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(() => initialAnswers(selectedTemplate));
  const [goalName, setGoalName] = useState(() => defaultGoalName(selectedTemplate, initialAnswers(selectedTemplate)));
  const [projectNameDraft, setProjectNameDraft] = useState(() => newProject?.initialName ?? defaultProjectName(selectedTemplate));
  const [goalTouched, setGoalTouched] = useState(false);
  const [projectTouched, setProjectTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextAnswers = initialAnswers(selectedTemplate);
    setAnswers(nextAnswers);
    setGoalTouched(false);
    setProjectTouched(false);
    if (!existingGoal) setGoalName(defaultGoalName(selectedTemplate, nextAnswers));
    if (newProject) setProjectNameDraft(newProject.initialName ?? defaultProjectName(selectedTemplate));
  }, [existingGoal?.goalId, newProject?.companyId, newProject?.initialName, selectedTemplate]);

  useEffect(() => {
    if (existingGoal || goalTouched) return;
    setGoalName(defaultGoalName(selectedTemplate, answers));
  }, [answers, existingGoal, goalTouched, selectedTemplate]);

  const canSubmit = selectedTemplate.intake.questions.every((question) => isQuestionAnswered(question, answers[question.id]))
    && (existingGoal || goalName.trim().length >= 2)
    && (!newProject || projectNameDraft.trim().length >= 2)
    && !busy;

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      let targetProjectId = projectId;
      if (newProject) {
        const project = await createProject({
          companyId: newProject.companyId,
          name: projectNameDraft.trim(),
          description: selectedTemplate.publicDescription,
          status: "active",
        });
        if (!project) throw new Error("Unable to create the template project.");
        targetProjectId = project.id;
      }

      let targetGoal: OrchestrationCompanyGoal | null = null;
      if (existingGoal) {
        targetGoal = {
          sprint: {
            id: existingGoal.goalId,
            name: existingGoal.goalName,
            goalKind: "company",
          },
        } as OrchestrationCompanyGoal;
      } else {
        targetGoal = await createCompanyGoal({
          companySlug,
          ...(targetProjectId ? { projectId: targetProjectId } : {}),
          name: goalName.trim(),
          goal: selectedTemplate.draftOutputs.goal.objective,
          goalKind: "company",
          status: "planned",
        });
        if (!targetGoal) throw new Error("Unable to create the template goal.");
      }

      const draftPlan = await createTemplateDraftPlan({
        companySlug,
        companyGoalId: targetGoal.sprint.id,
        templateId: selectedTemplate.id,
        answers: answerPayload(answers),
        defaultExecutionEngine: existingGoal?.defaultExecutionEngine ?? undefined,
        defaultModelLane: existingGoal?.defaultModelLane ?? undefined,
      });
      if (!draftPlan) throw new Error("Unable to create the template draft.");

      const created = { goal: targetGoal, draftPlan };
      await onCreated?.(created);
      window.dispatchEvent(new CustomEvent("goals-pending-drafts-change", { detail: { companySlug } }));
      setOpen(false);
      if (redirectOnCreated) {
        router.push(buildCanonicalGoalPath(companyCode, goalRouteKey(created.goal.sprint)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Template launch failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        title={triggerTitle}
        onClick={() => setOpen(true)}
        data-testid="template-launch-trigger"
        data-template-entry-point={launchSource}
        style={secondaryButtonStyle}
      >
        <Sparkles size={14} />
        {triggerLabel}
      </button>
      {open ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
            background: "var(--modal-backdrop)",
            backdropFilter: "blur(4px)",
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
          role="dialog"
          aria-modal="true"
          aria-label={dialogTitle ?? "Start from template"}
          data-testid="template-launch-dialog"
          data-template-entry-point={launchSource}
          style={{
              width: "min(980px, 100%)",
              maxHeight: "calc(100dvh - 36px)",
              display: "flex",
              flexDirection: "column",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--modal-glass)",
              boxShadow: "var(--shadow-glass)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "15px 18px", borderBottom: "0.5px solid var(--border)" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-primary)", fontSize: 15, fontWeight: 720 }}>
                  <Sparkles size={16} />
                  {dialogTitle ?? "Start from template"}
                </div>
                <div style={{ marginTop: 3, color: "var(--text-secondary)", fontSize: 12 }}>
                  {existingGoal ? existingGoal.goalName : newProject ? "New project" : projectName ? `Project: ${projectName}` : "Company-wide"}
                </div>
              </div>
              <button
                type="button"
                aria-label="Close template launcher"
                title="Close"
                onClick={close}
                disabled={busy}
                style={{ border: "none", background: "transparent", color: "var(--text-muted)", cursor: busy ? "wait" : "pointer", padding: 4 }}
              >
                <X size={17} />
              </button>
            </div>

            <div style={{ overflowY: "auto", padding: 18, display: "grid", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
                {templates.map((template) => {
                  const active = template.id === selectedTemplate.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setSelectedTemplateId(template.id)}
                      style={{
                        minHeight: 126,
                        display: "grid",
                        gap: 8,
                        alignContent: "start",
                        textAlign: "left",
                        borderRadius: 8,
                        border: active ? "0.5px solid var(--border-strong)" : "0.5px solid var(--border)",
                        background: active ? "var(--surface-hover)" : "var(--surface)",
                        color: "var(--text-primary)",
                        padding: 12,
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 13, fontWeight: 700 }}>
                        {template.name}
                        {active ? <Check size={14} /> : null}
                      </span>
                      <span style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.4 }}>{template.summary}</span>
                      <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{template.draftOutputs.taskPlan.length} proposed tasks</span>
                    </button>
                  );
                })}
              </div>

              {newProject ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: 650 }}>Project name</span>
                  <input
                    value={projectNameDraft}
                    onChange={(event) => {
                      setProjectTouched(true);
                      setProjectNameDraft(event.target.value);
                    }}
                    style={fieldStyle}
                  />
                </label>
              ) : null}

              {!existingGoal ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: 650 }}>Goal name</span>
                  <input
                    value={goalName}
                    onChange={(event) => {
                      setGoalTouched(true);
                      setGoalName(event.target.value);
                    }}
                    style={fieldStyle}
                  />
                </label>
              ) : null}

              <div style={{ display: "grid", gap: 12 }}>
                {selectedTemplate.intake.questions.map((question) => (
                  <TemplateQuestionField
                    key={question.id}
                    question={question}
                    value={answers[question.id]}
                    onChange={(value) => setAnswers((current) => ({ ...current, [question.id]: value }))}
                  />
                ))}
              </div>

              <div style={{ display: "grid", gap: 8, borderRadius: 8, border: "0.5px solid var(--border)", padding: 12, background: "var(--surface)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-primary)", fontSize: 13, fontWeight: 700 }}>
                  <FileText size={14} />
                  Review gate
                </div>
                <div style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.5 }}>
                  {selectedTemplate.draftOutputs.reviewGate.description}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {selectedTemplate.validationCriteria.checklist.slice(0, 3).map((item) => (
                    <span key={item} style={{ borderRadius: 999, border: "0.5px solid var(--border)", padding: "3px 8px", color: "var(--text-muted)", fontSize: 11 }}>
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              {error ? (
                <div role="status" style={{ color: "var(--negative)", fontSize: 12 }}>
                  {error}
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px", borderTop: "0.5px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text-muted)", fontSize: 12, minWidth: 0 }}>
                <Layers3 size={14} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Draft plan only. Board tasks are created after approval.
                </span>
              </div>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  borderRadius: 8,
                  border: "0.5px solid var(--border-strong)",
                  background: "var(--surface-hover)",
                  color: canSubmit ? "var(--text-primary)" : "var(--text-muted)",
                  fontSize: 13,
                  fontWeight: 650,
                  padding: "8px 14px",
                  cursor: canSubmit ? "pointer" : "not-allowed",
                  opacity: canSubmit ? 1 : 0.55,
                  whiteSpace: "nowrap",
                }}
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {busy ? "Creating draft..." : "Create draft"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function TemplateQuestionField({
  question,
  value,
  onChange,
}: {
  question: StarterSprintIntakeQuestion;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
}) {
  const label = (
    <span style={{ display: "grid", gap: 3 }}>
      <span style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: 650 }}>{question.label}</span>
      <span style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.4 }}>{question.helpText}</span>
    </span>
  );

  if (question.type === "single_select") {
    return (
      <label data-template-question-id={question.id} style={{ display: "grid", gap: 6 }}>
        {label}
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          style={fieldStyle}
        >
          {(question.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    );
  }

  if (question.type === "multi_select") {
    const values = new Set(Array.isArray(value) ? value : []);
    return (
      <fieldset data-template-question-id={question.id} style={{ display: "grid", gap: 7, border: 0, padding: 0, margin: 0 }}>
        <legend style={{ padding: 0 }}>{label}</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {(question.options ?? []).map((option) => {
            const checked = values.has(option.value);
            return (
              <label
                key={option.value}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 999,
                  border: checked ? "0.5px solid var(--border-strong)" : "0.5px solid var(--border)",
                  background: checked ? "var(--surface-hover)" : "var(--surface)",
                  color: "var(--text-secondary)",
                  padding: "5px 9px",
                  fontSize: 12,
                }}
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
    <label data-template-question-id={question.id} style={{ display: "grid", gap: 6 }}>
      {label}
      {multiline ? (
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
          style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.5 }}
        />
      ) : (
        <input
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          style={fieldStyle}
        />
      )}
    </label>
  );
}
