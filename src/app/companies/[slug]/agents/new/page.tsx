"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  Brain,
  BriefcaseBusiness,
  Code2,
  Loader2,
  Sparkles,
  UserPlus,
  Users,
  X,
} from "lucide-react";

const ICON_OPTIONS = [
  { value: "pixel", label: "Pixel", icon: Code2 },
  { value: "forge", label: "Forge", icon: BriefcaseBusiness },
  { value: "gater", label: "Gater", icon: Users },
];

const MODEL_OPTIONS = [
  { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "openai-codex/gpt-5.4", label: "GPT-5.4" },
  { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
];

export default function CreateCompanyAgentPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params?.slug ?? "";

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [iconKey, setIconKey] = useState("pixel");
  const [model, setModel] = useState("anthropic/claude-sonnet-4-6");
  const [reportsTo, setReportsTo] = useState("Henry");
  const [personality, setPersonality] = useState("");
  const [mission, setMission] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rosterOptions, setRosterOptions] = useState<Array<{ id: string; name: string; openclawAgentId?: string }>>([]);

  const canSubmit = useMemo(() => name.trim().length > 0 && role.trim().length > 0, [name, role]);

  const closeHref = `/companies/${encodeURIComponent(slug)}/team`;

  useEffect(() => {
    let cancelled = false;

    const loadRoster = async () => {
      try {
        const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/agents?syncOpenClaw=false`, {
          cache: "no-store",
        });
        const json = (await response.json().catch(() => ({}))) as {
          agents?: Array<{ id?: string; name?: string; openclawAgentId?: string }>;
        };
        if (!response.ok || cancelled) return;
        const options = (json.agents ?? [])
          .map((agent) => ({
            id: String(agent.id ?? "").trim(),
            name: String(agent.name ?? "").trim(),
            openclawAgentId: agent.openclawAgentId ? String(agent.openclawAgentId) : undefined,
          }))
          .filter((agent) => agent.id && agent.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        setRosterOptions(options);
      } catch {
        if (!cancelled) setRosterOptions([]);
      }
    };

    if (slug) void loadRoster();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const onSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/agents/hire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          role: role.trim(),
          emoji: iconKey,
          model,
          reportsTo: reportsTo.trim() || "Henry",
          personality: personality.trim(),
          mission: mission.trim(),
        }),
      });

      const json = (await response.json().catch(() => ({}))) as { error?: string; agent?: { id?: string } };
      if (!response.ok) {
        throw new Error(json.error || "Failed to create agent");
      }

      router.push(`/companies/${encodeURIComponent(slug)}/team`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,rgba(28,25,23,0.98),rgba(12,10,9,1))]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(217,119,6,0.16),transparent_30%),radial-gradient(circle_at_80%_12%,rgba(120,53,15,0.18),transparent_24%),rgba(12,10,9,0.72)] backdrop-blur-[8px]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(12,10,9,0.22),rgba(12,10,9,0.7))]" />

      <div className="relative z-10 flex min-h-screen w-full items-center justify-center px-4 py-8 md:px-6">
        <div className="w-full max-w-2xl">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-amber-300/70">NeverIdle Agent Creation</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Add a New Agent</h1>
              <p className="mt-2 max-w-xl text-sm text-stone-400">
                Create a real runtime-backed company agent with its own workspace, identity files, and orchestration record.
              </p>
            </div>
            <Link
              href={closeHref}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-stone-700/80 bg-[rgba(28,25,23,0.82)] text-stone-300 transition hover:border-amber-400/40 hover:text-white"
              aria-label="Close add agent"
            >
              <X size={18} />
            </Link>
          </div>

          <div className="rounded-[28px] border border-stone-600/45 bg-[radial-gradient(circle_at_top,rgba(217,119,6,0.14),transparent_34%),linear-gradient(165deg,rgba(41,37,36,0.96),rgba(12,10,9,0.99))] p-5 shadow-[0_30px_80px_rgba(12,10,9,0.65)] backdrop-blur-2xl md:p-6">
            <div className="mb-5 grid gap-3 sm:grid-cols-3">
              <Highlight icon={<UserPlus className="h-4 w-4" />} label="Creates workspace" />
              <Highlight icon={<Sparkles className="h-4 w-4" />} label="Writes core files" />
              <Highlight icon={<Users className="h-4 w-4" />} label="Registers runtime agent" />
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr,220px]">
              <Field label="Agent Name" required>
                <input className={inputClass} placeholder="e.g. Pixel" value={name} onChange={(event) => setName(event.target.value)} />
              </Field>

              <Field label="Icon Style" required>
                <div className="grid grid-cols-3 gap-2">
                  {ICON_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const selected = iconKey === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setIconKey(option.value)}
                        className={`rounded-xl border px-3 py-3 text-left transition ${
                          selected
                            ? "border-amber-400/50 bg-amber-500/10 text-white"
                            : "border-stone-700/80 bg-[rgba(28,25,23,0.92)] text-stone-300 hover:border-stone-500"
                        }`}
                      >
                        <Icon className="mb-2 h-4 w-4 text-white" />
                        <div className="text-sm font-medium">{option.label}</div>
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Role" required>
                <input className={inputClass} placeholder="e.g. Full-Stack Engineer" value={role} onChange={(event) => setRole(event.target.value)} />
              </Field>

              <Field label="Reports To">
                <select className={inputClass} value={reportsTo} onChange={(event) => setReportsTo(event.target.value)}>
                  <option value="">Unassigned</option>
                  <option value="Henry">Henry</option>
                  {rosterOptions.map((agent) => (
                    <option key={agent.id} value={agent.openclawAgentId || agent.id}>{agent.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-stone-500">This now reads from the real company roster. Workspace is the canonical home for core files; Runtime State remains the separate OpenClaw internal agent directory.</p>
              </Field>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Model">
                <select className={inputClass} value={model} onChange={(event) => setModel(event.target.value)}>
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="Agent Focus">
                <input className={inputClass} placeholder="UI, frontend, polishing, product feel" value={personality} onChange={(event) => setPersonality(event.target.value)} />
              </Field>
            </div>

            <div className="mt-4 grid gap-4">
              <Field label="Mission / Operating Notes">
                <textarea className={`${inputClass} min-h-[132px] resize-none`} placeholder="What should this agent own? What kind of work should they do?" value={mission} onChange={(event) => setMission(event.target.value)} />
              </Field>
            </div>

            <div className="mt-4 rounded-2xl border border-amber-800/40 bg-amber-950/20 p-3 text-sm text-stone-300">
              <div className="flex items-start gap-2">
                <Brain className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="font-medium text-stone-200">Sprint 1 behavior</p>
                  <p className="mt-1 text-xs leading-relaxed text-stone-400">This ships the real file creation and runtime registration path first. AI-generated polish and smarter rules can layer on later.</p>
                </div>
              </div>
            </div>

            {error ? (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-800/60 bg-red-900/20 p-3 text-sm text-red-300">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                {error}
              </div>
            ) : null}

            <div className="mt-6 flex items-center justify-between border-t border-stone-800/80 pt-5">
              <Link href={closeHref} className="inline-flex items-center gap-2 text-sm text-stone-400 transition hover:text-white">
                <BriefcaseBusiness className="h-4 w-4" /> Back to Team
              </Link>

              <button type="button" onClick={() => void onSubmit()} disabled={!canSubmit || saving} className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:bg-stone-700 disabled:text-stone-500">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Create Agent
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] uppercase tracking-[0.16em] text-stone-400">
        {label}
        {required ? <span className="ml-1 text-amber-400">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function Highlight({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/15 px-3 py-3 text-xs text-stone-300">
      <div className="mb-2 text-amber-300">{icon}</div>
      <p>{label}</p>
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-stone-700/80 bg-[rgba(28,25,23,0.92)] px-3 py-2.5 text-sm text-stone-100 placeholder:text-stone-500 focus:border-amber-500/70 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors";
