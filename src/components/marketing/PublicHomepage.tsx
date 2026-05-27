import Link from "next/link";
import Image from "next/image";
import type { ComponentType, CSSProperties } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  FileText,
  FolderOpen,
  Github,
  LaptopMinimal,
  Lock,
  Menu,
  Puzzle,
  RefreshCcw,
  ShieldCheck,
  SquareTerminal,
  Users,
  Workflow,
  Wrench,
} from "lucide-react";

const navItems = [
  { label: "Product", href: "#top" },
  { label: "Quickstart", href: "#quickstart" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
  { label: "Local-first", href: "#local-first" },
  { label: "Compatibility", href: "#compatibility" },
  { label: "FAQ", href: "#faq" },
] as const;

const proofPoints = [
  "Local-first by default",
  "Goals, tasks, runs, reviews, memory, and files in one console",
  "Optional runners and provider keys stay visible as readiness states",
  "Review loops keep agent output from being treated as done automatically",
] as const;

const quickstartSteps = [
  "Clone the repository.",
  "Copy the example environment file.",
  "Install dependencies with npm.",
  "Start the local dev server.",
  "Open HiveRunner in the browser.",
] as const;

const howItWorksSteps = [
  {
    title: "Define the goal",
    body: "Turn a company or project objective into tasks and reviewable work.",
  },
  {
    title: "Assign the right agent",
    body: "Route work to configured local or external runners and keep ownership visible.",
  },
  {
    title: "Track the run",
    body: "Watch task state, runtime readiness, comments, artifacts, and execution context from the operator console.",
  },
  {
    title: "Review before closure",
    body: "Move completed work through review instead of treating every agent output as automatically done.",
  },
  {
    title: "Preserve context",
    body: "Keep memory, files, decisions, and task history close to the work they support.",
  },
] as const;

const features = [
  {
    title: "Goals and tasks",
    description: "Plan work, split it into reviewable tasks, track status, and keep the operator in control of closure.",
    icon: Workflow,
  },
  {
    title: "Run visibility",
    description: "Inspect task runs, execution context, comments, artifacts, and runtime state without searching through terminal history.",
    icon: SquareTerminal,
  },
  {
    title: "Agent coordination",
    description: "Create agent roles, assign work, preserve ownership, and make handoffs visible.",
    icon: Users,
  },
  {
    title: "Runtime readiness",
    description: "See which optional CLIs, provider keys, and runner adapters are ready before you rely on them.",
    icon: Wrench,
  },
  {
    title: "Memory and files",
    description: "Keep durable project context, files, notes, and task evidence close to the workflows that use them.",
    icon: FolderOpen,
  },
  {
    title: "Review loops",
    description: "Route outputs through review states so agent work does not silently become accepted work.",
    icon: RefreshCcw,
  },
] as const;

const localFirstBullets = [
  "Start without creating a hosted account, Supabase project, OAuth app, or provider key.",
  "Keep local workspace state and runtime setup visible to the operator.",
  "Add optional runners and provider keys only when the workflow needs them.",
  "Treat hosted multi-user operation as a future path with stricter requirements, not as a claim the current site should imply.",
] as const;

const compatibilityRows = [
  {
    label: "Codex CLI",
    status: "Supported",
    note: "The Codex CLI is a first-class optional runtime path when the command is installed and authenticated locally.",
  },
  {
    label: "Claude / Claude Code",
    status: "Supported",
    note: "Claude Code is supported as a local CLI runtime. Direct Anthropic API keys are separate from Claude Code login.",
  },
  {
    label: "Gemini",
    status: "Supported",
    note: "Gemini CLI is supported as an optional local runtime, and Gemini API keys are checked separately when needed.",
  },
  {
    label: "Hermes",
    status: "Supported",
    note: "Hermes is supported as another optional local runtime profile when the environment exposes it.",
  },
  {
    label: "OpenCode",
    status: "Compatible",
    note: "OpenCode can fit the external runner model when your local workflow exposes it as a command or runner integration.",
  },
  {
    label: "Cursor",
    status: "Compatible",
    note: "Cursor can participate in a compatible editor-agent workflow when it is surfaced through the local environment or a browser-review loop.",
  },
  {
    label: "Browser and CLI agents",
    status: "Compatible",
    note: "Other browser-driven or CLI-driven agents can be surfaced through the external runner adapter, but HiveRunner does not claim a native integration for each one.",
  },
  {
    label: "OpenClaw",
    status: "Supported",
    note: "OpenClaw remains available as a legacy local runner path in environments that have it installed.",
  },
] as const;

const faqItems = [
  {
    question: "Is HiveRunner a hosted SaaS?",
    answer:
      "No. HiveRunner is presented as a local-first, open-source command center, not a finished multi-tenant hosted product.",
  },
  {
    question: "Is HiveRunner open-source?",
    answer:
      "Yes. The public repository is the primary distribution path, and the local-first setup is the default way to evaluate it today.",
  },
  {
    question: "Which agents are supported?",
    answer:
      "HiveRunner models Codex, Claude Code, Gemini, Hermes, OpenClaw, and external runner commands. OpenCode, Cursor, and other CLI or browser agents are compatible when you expose them through a command, browser target, or reviewable runner path.",
  },
  {
    question: "Do I need API keys to try it?",
    answer:
      "No. The local boot path does not require provider keys. Keys and runtime CLIs are optional setup choices for the workflows you want to run.",
  },
  {
    question: "Does it run on a Mac mini?",
    answer:
      "Yes, if the Mac mini is the local machine running the required runtime tools. HiveRunner itself is local-first and does not require hosted infrastructure.",
  },
  {
    question: "Is HiveRunner production-ready?",
    answer:
      "It is useful today for local operator workflows, but it should not be sold as a hosted production SaaS. Team or production use should stay inside the local-first boundary until deployment, security, and operations requirements are handled explicitly.",
  },
] as const;

const githubUrl = "https://github.com/timharris707/hiverunner";

const homepageShellStyle = {
  "--bg": "#2d2c2c",
  "--surface": "#212020",
  "--surface-elevated": "#2c2b2b",
  "--surface-hover": "#343333",
  "--border": "rgba(222, 220, 209, 0.12)",
  "--border-strong": "rgba(222, 220, 209, 0.22)",
  "--accent": "#d97706",
  "--accent-foreground": "#1a1716",
  "--text-primary": "#eae8e4",
  "--text-secondary": "#a8a6a0",
  "--text-muted": "#7a7872",
  "--positive": "#32D74B",
  "--warning": "#FFD60A",
  "--info": "#0A84FF",
  "--shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.3)",
  "--shadow-glass": "0 12px 32px rgba(12, 10, 9, 0.3)",
  "--shadow-cta": "0 4px 16px rgba(217, 119, 6, 0.10)",
} as CSSProperties;

export default function HomePage() {
  return (
    <main id="top" className="relative overflow-hidden bg-[var(--bg)] text-[var(--text-primary)]" style={homepageShellStyle}>
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(222,220,209,0.045) 1px, transparent 1px), linear-gradient(to bottom, rgba(222,220,209,0.045) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.9), transparent 96%)",
          WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.9), transparent 96%)",
        }}
      />

      <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color:color-mix(in_srgb,var(--bg)_88%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link href="#top" className="flex items-center gap-3 text-sm font-semibold">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--shadow-sm)]"
            >
              <Image src="/logo-mark.svg" alt="" width={24} height={24} priority />
            </span>
            <span className="hidden text-[var(--text-primary)] sm:inline">HiveRunner</span>
          </Link>

          <nav className="hidden items-center gap-5 lg:flex" aria-label="Primary">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] sm:inline-flex"
            >
              <Github className="h-4 w-4" />
              timharris707/hiverunner
            </Link>
            <Link
              href="#quickstart"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-foreground)] shadow-[var(--shadow-cta)] transition-transform hover:-translate-y-0.5"
            >
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
            <details className="group relative lg:hidden">
              <summary
                className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)] [&::-webkit-details-marker]:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="h-4 w-4" />
              </summary>
              <div className="absolute right-0 top-12 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-2 shadow-[var(--shadow-glass)]">
                {navItems.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  >
                    {item.label}
                    <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
                  </Link>
                ))}
                <Link
                  href={githubUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-3 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
                >
                  <span className="inline-flex items-center gap-2">
                    <Github className="h-4 w-4" />
                    timharris707/hiverunner
                  </span>
                  <ChevronRight className="h-4 w-4 text-[var(--accent)]" />
                </Link>
              </div>
            </details>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-10 px-4 pb-8 pt-10 sm:px-6 sm:pb-10 sm:pt-12 md:grid-cols-[1.05fr_0.95fr] lg:px-8">
        <div className="relative z-10 max-w-3xl">
          <h1 className="max-w-3xl text-4xl font-semibold leading-[1.02] text-[var(--text-primary)] sm:text-6xl sm:leading-[0.96] lg:text-7xl">
            HiveRunner runs AI agent work from one local command center.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--text-secondary)] sm:text-xl">
            HiveRunner helps you define goals, assign agents, track runs, review outputs, preserve context, and see which runtimes are ready before you depend on them. Clone it, run it locally, and build your agent workflow from your own machine.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="#quickstart"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-foreground)] shadow-[var(--shadow-cta)] transition-transform hover:-translate-y-0.5"
            >
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
            >
              <Github className="h-4 w-4" />
              timharris707/hiverunner
            </Link>
            <Link
              href="#local-first"
              className="inline-flex items-center gap-2 rounded-full border border-transparent px-2 py-3 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
            >
              Read the local-first boundary
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-8 hidden flex-wrap gap-2 sm:flex">
            {proofPoints.map((item) => (
              <div
                key={item}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-secondary)]"
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 hidden md:block">
          <div className="overflow-hidden rounded-3xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--shadow-glass)]">
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-4">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
              <div className="ml-3 text-xs font-medium text-[var(--text-muted)]">
                operator-console.local
              </div>
            </div>

            <div className="grid gap-3 p-4 lg:p-5">
              <ConsoleBlock
                label="Goal"
                title="Ship a useful workspace"
                body="Coordinate goals, task ownership, review states, and runtime readiness from the local workspace."
                tone="accent"
              />
              <div className="grid gap-4 md:grid-cols-2">
                <ConsoleBlock
                  label="Task"
                  title="Break work into tasks"
                  body="Keep planning, execution, review, and evidence visible as separate operator panels."
                  tone="neutral"
                />
                <ConsoleBlock
                  label="Run"
                  title="Needs review"
                  body="Agent work stays in review until an operator confirms the output."
                  tone="warning"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
                <ConsoleBlock
                  label="Runtime readiness"
                  title="Optional runners"
                  body="Codex, Claude Code, Gemini, Hermes, OpenClaw, and external commands appear as readiness states."
                  tone="success"
                />
                <ConsoleBlock
                  label="Memory"
                  title="Context attached"
                  body="Files, notes, and decisions remain close to the work they support."
                  tone="info"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="quickstart" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Quickstart" title="Start locally in minutes." description="HiveRunner is built for evaluation from a fresh clone. Start the app locally, enter as the local owner, open the default workspace, and decide which optional runtimes or provider keys you want to connect." />

        <div className="mt-10 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
            <ol className="space-y-4">
              {quickstartSteps.map((step, index) => (
                <li key={step} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-elevated)] text-sm font-semibold text-[var(--accent)]">
                    {index + 1}
                  </span>
                  <p className="pt-1 text-base leading-7 text-[var(--text-secondary)]">{step}</p>
                </li>
              ))}
            </ol>

            <div className="mt-8 rounded-2xl border border-[var(--border-strong)] bg-[#171615] p-5 font-mono text-[12px] leading-7 text-[#d9d5cb] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div className="mb-4 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">
                <SquareTerminal className="h-4 w-4 text-[var(--accent)]" />
                Local boot path
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap">
{`git clone https://github.com/timharris707/hiverunner.git hive-runner
cd hive-runner
cp .env.example .env.local
npm install
npm run dev`}
              </pre>
            </div>
          </div>

          <div className="grid gap-6">
            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">Browser</p>
              <p className="mt-3 text-xl font-semibold text-[var(--text-primary)]">Open <span className="font-mono text-[0.95em]">http://localhost:3010</span>.</p>
              <p className="mt-3 text-[var(--text-secondary)]">
                With the default local configuration, HiveRunner runs in <span className="font-mono text-[var(--text-primary)]">local-single-user</span> mode. No Supabase project, OAuth app, provider key, password, or admin account is required for the local boot path.
              </p>
            </div>

            <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">Boundary note</p>
              <p className="mt-3 text-[var(--text-secondary)]">
                Optional runtimes and provider keys are setup choices, not prerequisites for opening the app.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Operator loop" title="One operator loop for agent work." description="HiveRunner organizes agent work around the operational loop a human already needs: set the goal, route the task, watch execution, review output, and preserve the useful context for the next run." />

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {howItWorksSteps.map((step, index) => (
            <article
              key={step.title}
              className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                  Step {index + 1}
                </span>
                <CheckCircle2 className="h-4 w-4 text-[var(--positive)]" />
              </div>
              <h3 className="mt-4 text-lg font-semibold tracking-tight text-[var(--text-primary)]">{step.title}</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Product surface" title="Built for the real overhead of running agents." />

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article
                key={feature.title}
                className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 transition-transform duration-200 hover:-translate-y-1"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-elevated)] text-[var(--accent)]">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-tight text-[var(--text-primary)]">{feature.title}</h3>
                <p className="mt-3 text-sm leading-7 text-[var(--text-secondary)]">{feature.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="local-first" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Local-first" title="Local-first because agent work starts on your machine." description="The first version of a serious agent workflow usually lives beside local code, local files, local credentials, and local runtime tools. HiveRunner is designed around that reality: it gives one operator a local command center before asking them to adopt hosted infrastructure." />

        <div className="mt-10 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
            <ul className="space-y-4">
              {localFirstBullets.map((item) => (
                <li key={item} className="flex gap-3 text-[var(--text-secondary)]">
                  <ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-[var(--positive)]" />
                  <span className="leading-7">{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-elevated)] p-5">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
                Boundary callout
              </p>
              <p className="mt-3 text-[var(--text-secondary)]">
                HiveRunner is not presented as a finished hosted SaaS. It is a local-first, open-source control plane for builders who want to coordinate agent work from their own machine.
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8">
            <div className="grid gap-4 sm:grid-cols-2">
              <LocalBoundaryCard label="Your machine" value="Local host" icon={LaptopMinimal} />
              <LocalBoundaryCard label="Your workspace" value="Files and notes" icon={FileText} />
              <LocalBoundaryCard label="Your tools" value="Optional runners" icon={Puzzle} />
              <LocalBoundaryCard label="Your control" value="Review before close" icon={Lock} />
            </div>
          </div>
        </div>
      </section>

      <section id="compatibility" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Compatibility" title="Bring the runners you actually use." description="HiveRunner is built to coordinate optional local and external agent runners. Missing CLIs or provider keys should appear as setup work in runtime readiness, not as broken onboarding." />

        <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--text-secondary)]">
          HiveRunner models Codex, Claude Code, Gemini, Hermes, OpenClaw, and the external runner path directly. OpenCode, Cursor, and similar editor or browser agents are compatible when they are exposed as a command, a browser target, or another reviewable runner integration; this page does not claim a native integration where the repo does not provide one.
        </p>

        <div className="mt-10 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="grid border-b border-[var(--border)] px-6 py-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)] sm:grid-cols-[0.8fr_0.8fr_1.4fr]">
            <span>Runner</span>
            <span>Status</span>
            <span>Compatibility note</span>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {compatibilityRows.map((row) => (
              <div key={row.label} className="grid gap-3 px-6 py-5 sm:grid-cols-[0.8fr_0.8fr_1.4fr] sm:items-start">
                <div className="text-base font-semibold text-[var(--text-primary)]">{row.label}</div>
                <div
                  className={`inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-medium ${
                    row.status === "Supported"
                      ? "border-[rgba(50,215,75,0.22)] bg-[color:color-mix(in_srgb,var(--positive)_8%,var(--surface))] text-[var(--positive)]"
                      : "border-[rgba(217,119,6,0.26)] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface))] text-[var(--accent)]"
                  }`}
                >
                  {row.status}
                </div>
                <p className="text-sm leading-7 text-[var(--text-secondary)]">{row.note}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--border)] px-6 py-4 text-sm text-[var(--text-muted)]">
            Compatibility depends on the runner, CLI, credentials, and local configuration available in the operator&apos;s environment. The public site should not claim universal agent-framework support.
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="FAQ" title="A few direct answers before you try it." />

        <div className="mt-10 space-y-3">
          {faqItems.map((item) => (
            <details
              key={item.question}
              className="group rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 open:border-[var(--border-strong)]"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
                <span className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                  {item.question}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform group-open:rotate-90" />
              </summary>
              <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--text-secondary)]">
                {item.answer}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 pb-24 sm:px-6 lg:px-8">
        <div className="rounded-[2rem] border border-[var(--border-strong)] bg-[linear-gradient(180deg,var(--surface)_0%,var(--surface-elevated)_100%)] px-6 py-8 sm:px-8 sm:py-10">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">
              Start local
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-4xl">
              Start with the local path. Add more runners when you need them.
            </h2>
            <p className="mt-4 text-[var(--text-secondary)]">
              HiveRunner stays useful when the workflow is local, inspectable, and under human control.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="#quickstart"
                className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-foreground)] shadow-[var(--shadow-cta)] transition-transform hover:-translate-y-0.5"
              >
                Get Started
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
              >
                <Github className="h-4 w-4" />
                timharris707/hiverunner
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="mb-4 inline-flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--accent)]">
        <span className="h-px w-10 bg-[var(--accent)]" aria-hidden="true" />
        {eyebrow}
      </p>
      <h2 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-4xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-base leading-8 text-[var(--text-secondary)] sm:text-lg">
          {description}
        </p>
      ) : null}
    </div>
  );
}

function ConsoleBlock({
  label,
  title,
  body,
  tone,
}: {
  label: string;
  title: string;
  body: string;
  tone: "accent" | "neutral" | "warning" | "success" | "info";
}) {
  const toneStyles: Record<typeof tone, { chip: string; border: string; background: string; text: string }> = {
    accent: {
      chip: "text-[var(--accent)]",
      border: "border-[var(--border-strong)]",
      background: "bg-[var(--surface-elevated)]",
      text: "text-[var(--text-secondary)]",
    },
    neutral: {
      chip: "text-[var(--text-muted)]",
      border: "border-[var(--border)]",
      background: "bg-[var(--surface)]",
      text: "text-[var(--text-secondary)]",
    },
    warning: {
      chip: "text-[var(--warning)]",
      border: "border-[rgba(255,214,10,0.22)]",
      background: "bg-[color:color-mix(in_srgb,var(--warning)_10%,var(--surface))]",
      text: "text-[var(--text-secondary)]",
    },
    success: {
      chip: "text-[var(--positive)]",
      border: "border-[rgba(50,215,75,0.22)]",
      background: "bg-[color:color-mix(in_srgb,var(--positive)_8%,var(--surface))]",
      text: "text-[var(--text-secondary)]",
    },
    info: {
      chip: "text-[var(--info)]",
      border: "border-[rgba(10,132,255,0.22)]",
      background: "bg-[color:color-mix(in_srgb,var(--info)_8%,var(--surface))]",
      text: "text-[var(--text-secondary)]",
    },
  };

  const styles = toneStyles[tone];

  return (
    <div className={`rounded-2xl border ${styles.border} ${styles.background} p-4`}>
      <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${styles.chip}`}>{label}</p>
      <h3 className="mt-3 text-lg font-semibold tracking-tight text-[var(--text-primary)]">{title}</h3>
      <p className={`mt-2 text-sm leading-6 ${styles.text}`}>{body}</p>
    </div>
  );
}

function LocalBoundaryCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--accent)]">
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">{label}</p>
          <p className="text-sm text-[var(--text-secondary)]">{value}</p>
        </div>
      </div>
    </div>
  );
}
