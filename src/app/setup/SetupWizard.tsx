"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  KeyRound,
  ShieldCheck,
  Rocket,
  Check,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Building2,
  FolderOpen,
  SkipForward,
} from "lucide-react";
// `import type` is erased at compile time, so this does not pull the server-only
// onboarding-state module (fs / MC_DATA_DIR) into the client bundle.
import type { OnboardingCompletionReason } from "@/lib/onboarding/onboarding-state";

export type SetupWorkspace = {
  code: string;
  slug: string;
  name: string;
};

type ProviderStatus = {
  id: "openai" | "google" | "anthropic";
  label: string;
  configured: boolean;
  configuredSecretName: string | null;
  source: string | null;
  envVars: string[];
  enables: string[];
  missingImpact: string;
  setupCopy: string;
};

// The wizard only ever surfaces these three user-initiated reasons. The shared
// OnboardingCompletionReason also has "completed", which is a server-side
// fallback default (used when the API receives no/invalid reason) and is never
// sent from here — so we narrow it out rather than redefine a divergent union.
type CompletionReason = Exclude<OnboardingCompletionReason, "completed">;

const STEPS = [
  { num: 1, label: "Welcome", icon: Sparkles },
  { num: 2, label: "Provider keys", icon: KeyRound },
  { num: 3, label: "Overseer", icon: ShieldCheck },
  { num: 4, label: "Workspace", icon: Rocket },
] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-1 sm:gap-0">
      {STEPS.map((step, i) => {
        const done = step.num < current;
        const active = step.num === current;
        const Icon = step.icon;
        return (
          <div key={step.num} className="flex items-center">
            {i > 0 && (
              <div
                className={`hidden h-0.5 w-10 sm:block ${
                  done ? "bg-[var(--positive)]" : active ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                } transition-colors`}
              />
            )}
            <div className="flex flex-col items-center gap-1 px-1.5 sm:px-2">
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
                className={`text-[10px] ${
                  done ? "text-[var(--positive)]" : active ? "text-[var(--accent)]" : "text-[var(--text-muted)]"
                }`}
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

function StepWelcome() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
          <Sparkles size={20} className="text-[var(--accent)]" /> Welcome to HiveRunner
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          This is a one-time software setup for your local-first install. It is separate from creating a
          workspace — we&apos;ll get the software ready first, then you decide when to create or open a workspace.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Local-first &amp; private</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
            HiveRunner runs on your machine in <code className="rounded bg-[var(--surface-elevated)] px-1 py-0.5">local-single-user</code> mode.
            No external account, password, or hosted database is required to boot.
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm font-semibold text-[var(--text-primary)]">No workspace created yet</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
            Setup never auto-creates a company or workspace. You stay in control of when that happens — the
            last step lets you create one, open an existing one, or skip for now.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] p-3">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
          Next we&apos;ll check optional AI provider keys, point out the bundled Overseer skill, then hand you the
          workspace choice.
        </p>
      </div>
    </div>
  );
}

function StepProviders({ providers }: { providers: ProviderStatus[] | null }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
          <KeyRound size={20} className="text-[var(--accent)]" /> Provider keys (optional)
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          HiveRunner reads provider keys from your local environment. We only show whether each one is
          configured — never the secret value itself. Every key is optional; core local workflows run without them.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {(providers ?? []).map((provider) => (
          <div
            key={provider.id}
            className={`rounded-lg border p-4 ${
              provider.configured
                ? "border-[var(--positive)] bg-[var(--positive-soft)]"
                : "border-[var(--border)] bg-[var(--surface)]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{provider.label}</p>
                <p
                  className={`mt-1 text-xs font-semibold ${
                    provider.configured ? "text-[var(--positive)]" : "text-[var(--text-muted)]"
                  }`}
                >
                  {provider.configured
                    ? `Configured via ${provider.configuredSecretName}${provider.source ? ` (${provider.source})` : ""}`
                    : "Not configured"}
                </p>
              </div>
              {provider.configured ? (
                <Check size={16} className="mt-0.5 shrink-0 text-[var(--positive)]" />
              ) : (
                <AlertCircle size={16} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
              )}
            </div>
            <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Enables</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{provider.enables.join(", ")}</p>
              </div>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">{provider.missingImpact}</p>
            </div>
          </div>
        ))}
        {!providers && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-secondary)]">
            Checking provider readiness...
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Adding keys</p>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Add any keys you want to <code className="rounded bg-[var(--surface-elevated)] px-1 py-0.5">.env.local</code>,
          then restart the local lane so the new environment is picked up.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-xs text-[var(--text-secondary)]">
{`# .env.local
OPENAI_API_KEY=your-openai-key
GOOGLE_AI_API_KEY=your-google-ai-key   # Gemini / Google AI
ANTHROPIC_API_KEY=your-anthropic-key   # optional`}
        </pre>
        <p className="mt-3 text-xs leading-relaxed text-[var(--text-muted)]">
          Restart with <code className="rounded bg-[var(--surface-elevated)] px-1 py-0.5">npm run dev</code> (or
          <code className="mx-1 rounded bg-[var(--surface-elevated)] px-1 py-0.5">scripts/lane.sh dev start</code>), then
          reopen this page to see the updated status. Skipping keys only disables provider-backed features such as
          avatar generation and live voice.
        </p>
      </div>
    </div>
  );
}

function StepOverseer() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
          <ShieldCheck size={20} className="text-[var(--accent)]" /> The Overseer is bundled in
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          HiveRunner ships with a public-safe orchestration Overseer skill. It supervises goals, board movement,
          stale runners, blocked or review cards, and multi-agent work — and it&apos;s included out of the box.
        </p>
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">Bundled at</p>
        <pre className="mt-1 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3 text-xs text-[var(--text-secondary)]">
{`.agents/skills/hiverunner-orchestration-overseer/SKILL.md`}
        </pre>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          Every new workspace is seeded with this skill as
          <code className="mx-1 rounded bg-[var(--surface-elevated)] px-1 py-0.5">hiverunner-orchestration-overseer</code>,
          so supervising agents can read it before intervening. You don&apos;t need to install or configure anything —
          it&apos;s ready the moment a workspace exists.
        </p>
      </div>
      <div className="flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] p-3">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
        <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
          Local lane safety stays on: observer lanes are for viewing, execution lanes run only when the task contract
          or operator allows it.
        </p>
      </div>
    </div>
  );
}

function StepWorkspace({
  workspaces,
  primary,
  finishing,
  onFinish,
}: {
  workspaces: SetupWorkspace[];
  primary: SetupWorkspace | null;
  finishing: CompletionReason | null;
  onFinish: (reason: CompletionReason) => void;
}) {
  const hasWorkspace = Boolean(primary);
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
          <Rocket size={20} className="text-[var(--accent)]" /> Workspace
        </h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Software setup is ready. Choose what happens next — nothing is created automatically.
        </p>
      </div>

      <div className="grid gap-3">
        <button
          type="button"
          disabled={Boolean(finishing)}
          onClick={() => onFinish("created-workspace")}
          className="flex items-start gap-3 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-4 text-left transition-colors hover:border-[var(--border-strong)] disabled:opacity-50"
        >
          <Building2 size={18} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              Create your first workspace
              {finishing === "created-workspace" && <Loader2 size={14} className="animate-spin" />}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-[var(--text-secondary)]">
              Opens the New Company / New Workspace wizard. You&apos;ll define the company, team, CEO, and first goal there.
            </span>
          </span>
        </button>

        {hasWorkspace && (
          <button
            type="button"
            disabled={Boolean(finishing)}
            onClick={() => onFinish("opened-existing")}
            className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
          >
            <FolderOpen size={18} className="mt-0.5 shrink-0 text-[var(--accent)]" />
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                Open existing workspace
                {finishing === "opened-existing" && <Loader2 size={14} className="animate-spin" />}
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-[var(--text-secondary)]">
                Go to <strong className="text-[var(--text-primary)]">{primary?.name}</strong>
                {workspaces.length > 1 ? ` (and ${workspaces.length - 1} more)` : ""}.
              </span>
            </span>
          </button>
        )}

        <button
          type="button"
          disabled={Boolean(finishing)}
          onClick={() => onFinish("skipped")}
          className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] disabled:opacity-50"
        >
          <SkipForward size={18} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              Skip for now
              {finishing === "skipped" && <Loader2 size={14} className="animate-spin" />}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-[var(--text-secondary)]">
              Finish setup without creating a workspace. You won&apos;t see this walkthrough again — you can create or
              open a workspace whenever you&apos;re ready.
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

export default function SetupWizard({
  workspaces,
  primary,
  alreadyComplete,
}: {
  workspaces: SetupWorkspace[];
  primary: SetupWorkspace | null;
  alreadyComplete: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [finishing, setFinishing] = useState<CompletionReason | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/onboarding/provider-status")
      .then((r) => r.json())
      .then((payload: { providers?: ProviderStatus[] }) => {
        if (!active) return;
        setProviders(Array.isArray(payload.providers) ? payload.providers : []);
      })
      .catch(() => {
        if (active) setProviders([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const destinationFor = useCallback(
    (reason: CompletionReason): string => {
      // These are reached via client-side router.replace() — a SOFT navigation —
      // so they must target PHYSICAL pages. We deliberately avoid the
      // `[companyCode]` board path (e.g. /HIVE/tasks) that the root server-redirect
      // uses: that path is served by a middleware rewrite and triggers Next's
      // "Failed to fetch RSC payload" fallback on soft navigations. The root route
      // can use it because its redirect() is a hard navigation. See
      // docs/onboarding-rsc-navigation.md.
      if (reason === "created-workspace" || !primary) return "/companies/new";
      const slug = encodeURIComponent(primary.slug);
      // Open existing → straight into the workspace dashboard.
      if (reason === "opened-existing") return `/companies/${slug}/dashboard`;
      // Skip (only reachable with a workspace via a manual /setup re-run) →
      // the workspace overview, a distinct destination from "Open existing".
      return `/companies/${slug}`;
    },
    [primary],
  );

  const finish = useCallback(
    async (reason: CompletionReason) => {
      setFinishing(reason);
      setError(null);
      try {
        const res = await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ via: reason }),
        });
        if (!res.ok) {
          throw new Error(`Could not save setup completion (status ${res.status}).`);
        }
        router.replace(destinationFor(reason));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Could not save setup completion.");
        setFinishing(null);
      }
    },
    [destinationFor, router],
  );

  const next = useCallback(() => setStep((s) => Math.min(s + 1, STEPS.length)), []);
  const back = useCallback(() => setStep((s) => Math.max(s - 1, 1)), []);

  const isLastStep = step === STEPS.length;
  const headerNote = useMemo(
    () => (alreadyComplete ? "You've completed setup before — rerun any step or jump to a workspace." : "First-run software setup"),
    [alreadyComplete],
  );

  return (
    <div className="flex min-h-[100dvh] w-full items-start justify-center overflow-y-auto px-3 py-8 sm:px-5">
      <div className="w-full max-w-3xl rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-5 shadow-[var(--shadow-glass)] md:p-7">
        <header className="mb-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">{headerNote}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-normal text-[var(--text-primary)]">Set up HiveRunner</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
            Get the software ready, then choose a workspace when you&apos;re set.
          </p>
        </header>

        <StepIndicator current={step} />

        {step === 1 && <StepWelcome />}
        {step === 2 && <StepProviders providers={providers} />}
        {step === 3 && <StepOverseer />}
        {step === 4 && (
          <StepWorkspace workspaces={workspaces} primary={primary} finishing={finishing} onFinish={finish} />
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--negative)] bg-[var(--negative-soft)] p-3 text-sm text-[var(--negative)]">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between gap-4 border-t border-[var(--border)] pt-5">
          <div>
            {step > 1 && (
              <button
                onClick={back}
                disabled={Boolean(finishing)}
                className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-40"
              >
                <ChevronLeft size={16} /> Back
              </button>
            )}
          </div>
          <div className="flex items-center justify-end gap-3">
            {!isLastStep && (
              <button
                onClick={next}
                className="hr-primary-cta flex items-center gap-1.5 rounded-md px-5 py-2.5 text-sm font-medium transition-colors"
              >
                Next <ChevronRight size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
