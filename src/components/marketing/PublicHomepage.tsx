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
  { label: "How it works", href: "#how-it-works" },
  { label: "Runners", href: "#compatibility" },
  { label: "Features", href: "#features" },
  { label: "Local-first", href: "#local-first" },
  { label: "Quickstart", href: "#quickstart" },
  { label: "FAQ", href: "#faq" },
] as const;

const proofPoints = [
  "One goal → sprint plan → tasks → runs → review",
  "Codex, Claude Code, Gemini + the CLIs you already run",
  "Review gates baked in — agent output is never auto-accepted",
  "Local-first: runs on a lane you own",
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
    body: "Turn a project or company objective into a unit of work HiveRunner can plan.",
  },
  {
    title: "Get a sprint plan",
    body: "HiveRunner decomposes the goal into a scoped sprint — a complete unit of work, not a flat to-do list.",
  },
  {
    title: "Split into tasks",
    body: "The sprint becomes typed, prioritized tasks on a board you can see end to end.",
  },
  {
    title: "Assign agents + runners",
    body: "Each task routes to an agent and a runner — Codex, Claude Code, Gemini, Hermes, or external — by role and model.",
  },
  {
    title: "Run on a lane you own",
    body: "Work executes on the stable execution lane. Observer lanes stay read-only, so nothing runs that you did not authorize.",
  },
  {
    title: "Review before closure",
    body: "Output moves through review states instead of being treated as done. Memory and cost carry into the next sprint.",
  },
] as const;

const features = [
  {
    title: "Goal-to-sprint engine",
    description: "Turn one goal into a sprint plan, split it into tasks, and track every run to review — the whole unit of work, not a scattered to-do list.",
    icon: Workflow,
  },
  {
    title: "Bring your own runners",
    description: "Coordinate Codex, Claude Code, and Gemini as first-class runners, plus Hermes, OpenClaw, and external CLIs. Each appears as a readiness state.",
    icon: Wrench,
  },
  {
    title: "Review gates",
    description: "Agent output routes through review states, so work never silently becomes accepted work. You hold the gate on every result.",
    icon: RefreshCcw,
  },
  {
    title: "Run visibility & cost",
    description: "Inspect runs, execution context, comments, and artifacts — and see what each sprint is spending — without digging through terminal history.",
    icon: SquareTerminal,
  },
  {
    title: "Agent coordination",
    description: "Create agent roles, assign tasks, preserve ownership, and make handoffs visible across the whole sprint.",
    icon: Users,
  },
  {
    title: "Memory that carries",
    description: "Keep durable context, files, and decisions close to the work — and carry them into the next sprint instead of starting cold.",
    icon: FolderOpen,
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
    note: "First-class runner, preferred for GPT coding work, with an automatic fallback to Claude/Sonnet when the codex command is not on your PATH.",
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
    question: "What does HiveRunner actually do?",
    answer:
      "It turns a goal into a sprint plan, splits the plan into tasks, assigns each task to an agent and a runner, executes the work on a lane you own, and holds every result at review until you sign off. One goal in, a coordinated and reviewable sprint out.",
  },
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
      "Codex, Claude Code, and Gemini are first-class runners; Hermes, OpenClaw, and external runner commands round out the bundled set. OpenCode, Cursor, and other CLI or browser agents are compatible when you expose them through a command, browser target, or reviewable runner path.",
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
          <p className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
            <Workflow className="h-3.5 w-3.5" />
            Automate the sprint. Keep the review.
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-[1.02] text-[var(--text-primary)] sm:text-6xl sm:leading-[0.96] lg:text-7xl">
            Give your agents a goal. Get back a finished sprint.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--text-secondary)] sm:text-xl">
            HiveRunner decomposes one goal into a sprint plan, splits it into tasks, and assigns your agents — Codex, Claude Code, Gemini, and the CLIs you already run. They execute on a lane you own; nothing ships until you clear review.
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

            <div className="grid gap-2 p-4 lg:p-5">
              <ConsoleBlock
                label="Goal"
                title="Ship the billing redesign"
                body="One objective in. HiveRunner plans the sprint."
                tone="accent"
              />

              <CascadeConnector label="proposes a sprint plan" />

              <div className="rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-elevated)] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    Sprint plan
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)]">6 tasks · 3 agents</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <TaskChip runner="Codex" status="done" />
                  <TaskChip runner="Claude" status="done" />
                  <TaskChip runner="Gemini" status="running" />
                </div>
              </div>

              <CascadeConnector label="converges on review" />

              <div className="rounded-2xl border border-[rgba(255,214,10,0.22)] bg-[color:color-mix(in_srgb,var(--warning)_10%,var(--surface))] p-4">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[var(--warning)]" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--warning)]">
                    Needs review
                  </p>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                  Nothing ships until you sign off.
                </p>
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
        <SectionHeading eyebrow="Goal → sprint → review" title="One goal in. A whole sprint out." description="HiveRunner organizes agent work the way a software team already does: a goal becomes a sprint plan, the plan becomes tasks, tasks run through your agents, and every result converges on review before it counts as done." />

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <SectionHeading eyebrow="Runners" title="Bring the agents you already run." description="Codex, Claude Code, and Gemini are first-class runners; Hermes, OpenClaw, and external CLIs plug in through the runner boundary. Every runner is optional and shows up as a readiness state, so missing CLIs are setup work, not broken onboarding." />

        <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--text-secondary)]">
          HiveRunner coordinates Codex, Claude Code, Gemini, Hermes, OpenClaw, and the external runner path directly. OpenCode, Cursor, and similar editor or browser agents are compatible when they are exposed as a command, a browser target, or another reviewable runner integration; this page does not claim a native integration where the repo does not provide one.
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
              Get started
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-4xl">
              Run your AI agents like a software team.
            </h2>
            <p className="mt-4 text-[var(--text-secondary)]">
              Clone it, define a goal, and watch it become a sprint your agents run — on a lane you own, with you on the review gate. Add more runners when you need them.
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

      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-sm text-[var(--text-muted)]">
          <span>© 2026 HiveRunner · Built by Tim Harris</span>
          <span className="flex gap-5">
            <Link
              href="https://x.com/timharris707"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-[var(--text-primary)]"
            >
              @timharris707
            </Link>
            <Link
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-[var(--text-primary)]"
            >
              GitHub
            </Link>
          </span>
        </div>
      </footer>
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

function CascadeConnector({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pl-1 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">
      <ChevronRight className="h-3.5 w-3.5 rotate-90 text-[var(--accent)]" aria-hidden="true" />
      {label}
    </div>
  );
}

function TaskChip({ runner, status }: { runner: string; status: "done" | "running" }) {
  const isDone = status === "done";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[11px] font-medium text-[var(--text-primary)]">{runner}</span>
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${isDone ? "bg-[var(--positive)]" : "bg-[var(--accent)]"}`}
          aria-hidden="true"
        />
      </div>
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">{isDone ? "run done" : "running"}</p>
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
