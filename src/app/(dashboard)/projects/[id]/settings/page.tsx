"use client";

import { use, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertOctagon, Loader2, Palette, Save, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { ProjectShellNav } from "@/components/orchestration/ProjectShellNav";
import { getProjectBoard, listCompanies, listStaleTaskAlerts } from "@/lib/orchestration/client";

type StaleThresholdDraft = {
  review: number;
  inProgress: number;
  blocked: number;
};

const DEFAULT_THRESHOLDS: StaleThresholdDraft = {
  review: 1,
  inProgress: 4,
  blocked: 2,
};

const EMOJI_PRESETS = ["🛰️", "🌃", "🧠", "🚀", "⚙️", "🛡️", "🧪", "🎯"];

function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(168, Math.max(0, value));
}

export default function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [projectName, setProjectName] = useState("Project");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [emojiDraft, setEmojiDraft] = useState("🛰️");
  const [emojiBaseline, setEmojiBaseline] = useState("🛰️");
  const [thresholdDraft, setThresholdDraft] = useState<StaleThresholdDraft>(DEFAULT_THRESHOLDS);
  const [thresholdBaseline, setThresholdBaseline] = useState<StaleThresholdDraft>(DEFAULT_THRESHOLDS);
  const [companyThemeName, setCompanyThemeName] = useState<string | null>(null);
  const [companySlug, setCompanySlug] = useState<string | null>(null);

  const [savingEmoji, setSavingEmoji] = useState(false);
  const [savingThresholds, setSavingThresholds] = useState(false);

  useEffect(() => {
    let mounted = true;

    Promise.all([getProjectBoard(id), listCompanies(), listStaleTaskAlerts(id)])
      .then(([board, companies, alerts]) => {
        if (!mounted) return;

        if (!board) {
          setLoadError("Project not found.");
          return;
        }

        setProjectName(board.project.name);
        const currentEmoji = board.project.emoji || "🛰️";
        setEmojiDraft(currentEmoji);
        setEmojiBaseline(currentEmoji);

        const thresholds = alerts?.defaults ?? DEFAULT_THRESHOLDS;
        const nextThresholds = {
          review: thresholds.review,
          inProgress: thresholds.inProgress,
          blocked: thresholds.blocked,
        };
        setThresholdDraft(nextThresholds);
        setThresholdBaseline(nextThresholds);

        const company = companies.find((row) => row.id === board.project.companyId);
        if (company) {
          setCompanyThemeName(company.theme.name);
          setCompanySlug(company.slug);
        }

        setLoadError(null);
      })
      .catch(() => {
        if (mounted) setLoadError("Failed to load project settings.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [id]);

  const thresholdDirty = useMemo(
    () =>
      thresholdDraft.review !== thresholdBaseline.review ||
      thresholdDraft.inProgress !== thresholdBaseline.inProgress ||
      thresholdDraft.blocked !== thresholdBaseline.blocked,
    [thresholdBaseline, thresholdDraft]
  );
  const emojiDirty = useMemo(() => emojiDraft.trim() !== emojiBaseline.trim(), [emojiBaseline, emojiDraft]);

  const saveEmoji = async () => {
    const nextEmoji = emojiDraft.trim();
    if (!nextEmoji) {
      setError("Project emoji cannot be empty.");
      return;
    }

    setSavingEmoji(true);
    setError(null);
    setNotice(null);

    const response = await fetch(`/api/orchestration/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji: nextEmoji }),
    }).catch(() => null);

    setSavingEmoji(false);

    if (!response?.ok) {
      setError("Could not save project emoji.");
      return;
    }

    setEmojiBaseline(nextEmoji);
    setNotice("Project identity updated.");
  };

  const saveThresholds = async () => {
    setSavingThresholds(true);
    setError(null);
    setNotice(null);

    const payload = {
      staleAlertThresholdsHours: {
        review: clampThreshold(thresholdDraft.review),
        inProgress: clampThreshold(thresholdDraft.inProgress),
        blocked: clampThreshold(thresholdDraft.blocked),
      },
    };

    const response = await fetch(`/api/orchestration/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);

    setSavingThresholds(false);

    if (!response?.ok) {
      setError("Could not save stale-alert thresholds.");
      return;
    }

    setThresholdBaseline(payload.staleAlertThresholdsHours);
    setNotice("Execution rules updated.");
  };

  return (
    <div className="orchestra-shell p-4 md:p-8">
      <ProjectShellNav projectId={id} projectName={projectName} />

      {loadError ? <Banner tone="error">{loadError}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-44 animate-pulse rounded-2xl border border-white/10 bg-slate-900/70" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Execution Rules" icon={<Zap className="h-4 w-4" />}>
            <p className="mb-3 text-xs text-slate-400">
              Controls stale-task escalation windows used by orchestration alerts.
            </p>

            <ThresholdInput
              label="Review stale after (hours)"
              value={thresholdDraft.review}
              onChange={(value) =>
                setThresholdDraft((prev) => ({ ...prev, review: value }))
              }
            />
            <ThresholdInput
              label="In Progress stale after (hours)"
              value={thresholdDraft.inProgress}
              onChange={(value) =>
                setThresholdDraft((prev) => ({ ...prev, inProgress: value }))
              }
            />
            <ThresholdInput
              label="Blocked stale after (hours)"
              value={thresholdDraft.blocked}
              onChange={(value) =>
                setThresholdDraft((prev) => ({ ...prev, blocked: value }))
              }
            />

            <button
              type="button"
              disabled={savingThresholds || !thresholdDirty}
              onClick={() => void saveThresholds()}
              className="mt-2 inline-flex items-center gap-1 rounded-lg border border-amber-300/40 bg-amber-400/12 px-3 py-1.5 text-xs text-amber-100 disabled:opacity-60"
            >
              {savingThresholds ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Thresholds
            </button>
          </Panel>

          <Panel title="Project Identity" icon={<Sparkles className="h-4 w-4" />}>
            <p className="mb-3 text-xs text-slate-400">Update the project emoji used across board cards and navigation surfaces.</p>
            <label className="mb-2 block text-[11px] uppercase tracking-[0.12em] text-slate-500">Project Emoji</label>
            <div className="mb-3 flex items-center gap-2">
              <input
                value={emojiDraft}
                onChange={(event) => setEmojiDraft(event.target.value)}
                maxLength={8}
                className="w-20 rounded-lg border border-white/10 bg-slate-900/85 px-3 py-2 text-center text-xl text-white outline-none focus:border-amber-400/60"
                aria-label="Project emoji"
              />
              <button
                type="button"
                onClick={() => void saveEmoji()}
                disabled={savingEmoji || !emojiDirty}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-300/40 bg-amber-400/12 px-3 py-2 text-xs text-amber-100 disabled:opacity-60"
              >
                {savingEmoji ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Emoji
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {EMOJI_PRESETS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setEmojiDraft(emoji)}
                  className="rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1 text-base transition hover:border-amber-300/45"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Avatar Theme" icon={<Palette className="h-4 w-4" />}>
            <Setting
              label="Current theme"
              value={companyThemeName ?? "Company default"}
              helper="Theme is managed at company level for visual consistency."
            />
            {companySlug ? (
              <Link
                href={`/companies/${companySlug}`}
                className="mt-2 inline-flex rounded-lg border border-white/10 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200 hover:border-amber-300/40"
              >
                Open Company Settings
              </Link>
            ) : null}
          </Panel>

          <Panel title="Access & Safety" icon={<ShieldCheck className="h-4 w-4" />}>
            <Setting label="Reviewer" value="Gater" helper="Review-owner for this project." />
            <Setting label="WIP limit per agent" value="3" helper="Soft limit shown on board lane counts." />
            <Setting label="Auto-restart failed sessions" value="Disabled" helper="Manual operator review required." />
          </Panel>

          <Panel title="Danger Zone" icon={<AlertOctagon className="h-4 w-4" />}>
            <p className="text-sm text-slate-300">
              Archive and delete actions stay disabled in scaffolding mode to prevent accidental project loss.
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200 opacity-70">
                Archive Project (Disabled)
              </button>
              <button type="button" disabled className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200 opacity-70">
                Delete Project (Disabled)
              </button>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[linear-gradient(175deg,rgba(30,41,59,0.78),rgba(2,6,23,0.9))] p-4 backdrop-blur-xl">
      <div className="mb-3 inline-flex items-center gap-2 text-amber-200">
        {icon}
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Setting({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="mb-2 rounded-lg border border-white/10 bg-slate-900/70 p-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm text-slate-200">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{helper}</p>
    </div>
  );
}

function ThresholdInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mb-2 block rounded-lg border border-white/10 bg-slate-900/70 p-2">
      <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <input
        type="number"
        min={0}
        max={168}
        step="0.5"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-md border border-white/10 bg-slate-950/70 px-2 py-1.5 text-sm text-white outline-none focus:border-amber-400/60"
      />
    </label>
  );
}

function Banner({ children, tone }: { children: ReactNode; tone: "success" | "error" }) {
  const cls =
    tone === "success"
      ? "mb-3 rounded-xl border border-amber-300/35 bg-amber-400/10 p-3 text-sm text-amber-100"
      : "mb-3 rounded-xl border border-rose-400/35 bg-rose-500/10 p-3 text-sm text-rose-100";

  return <div className={cls}>{children}</div>;
}
