# Advisory Board Round 2: Mission Control v0.5 → v1.0

## Session Setup

**Mode:** Roundtable
**Rounds:** 3
**Moderator:** Henry ⚡
**Pacing:** Sequential (each panelist speaks once per round, no repeats)

## Panel (6 members)

1. **Pixel 💻** (Full-Stack Engineer) — You built the UI. Review every page with a designer's eye. Call out layout issues, broken flows, missing states, and UX friction. You own the frontend verdict.

2. **Forge 🔧** (Backend Engineer) — You built the pipeline and APIs. Review the architecture: is the build queue reliable? Are state transitions enforced? Is the data layer solid? You own the backend verdict.

3. **Gater 🚧** (QA Lead) — You review every build. Is the QA pipeline working? Can you verify quality without manual effort? Are tasks skipping review? Are builds shipping untested? You own the quality verdict.

4. **Vigil 🛡️** (QA Automation) — You run automated checks. What test coverage exists? What's missing? Can you catch regressions before Gater sees them? You own the automation verdict.

5. **Quill ✍️** (Creative & Marketing) — You see this from the outside. Is Mission Control legible to someone who didn't build it? Can a first-time viewer understand what's happening in 10 seconds? Does it feel like a product or a dev tool? You own the communication verdict.

6. **Quant 📊** (Strategy Architect) — You use the Trading Desk daily. Is the data trustworthy? Can you make decisions from what you see? Does the dashboard actually help you trade better? You own the end-user verdict.

## The Mission (read this first)

Harris Autonomous is building a fully autonomous organization. The goal: Tim walks away for a day, a week, a month — and the system keeps building, trading, shipping, and improving without human intervention.

Mission Control is the nervous system. If it's broken, autonomy is broken. Tonight Tim spent 4 hours manually orchestrating because the system couldn't do it itself. That's the gap we're closing.

## What Sprint 1 Shipped

[Henry fills this in with actual results before session launch — every task that completed, what changed, what's verified]

## What's Still Broken (Tim's observations from tonight)

These are real issues Tim flagged while watching the board live:

1. **Review column gets skipped** — QA runs during in-progress, tasks jump straight to done. The review column is never used as intended.
2. **On-deck doesn't auto-promote** — when an agent finishes, the next task sits in on-deck until someone manually moves it. Zero autonomy.
3. **Gater doesn't auto-spawn** — she's just a name on the task, not a real agent that wakes up and reviews. Henry has to manually trigger her every time.
4. **Multiple tasks glow for one agent** — Forge showed 3 glowing tasks when he can only work one. Confusing and inaccurate.
5. **Done column glows** — completed tasks had stale buildState=running, causing phantom glows.
6. **Agents page completely broken** — shows "Polling agent sessions..." forever, no agent cards render.
7. **Tasks disappear** — 12 sprint tasks were created and vanished. Possibly archived or reconciled away.
8. **buildState not cleared on completion** — tasks move to done but keep running/spawning state.
9. **No visibility into what agents are doing** — cards glow but you can't see what's happening inside. Paperclip shows live tool calls; we show nothing.
10. **No activity feed** — no way to see the overall story of what's happening across the org.

## Screenshots

[Henry captures fresh Playwright screenshots of every page before session launch and describes what each one shows — the panel reacts to REALITY not memory]

## Round Structure

### Round 1: "What did Sprint 1 actually fix?"
Review the screenshots. Compare to what was broken before. Did the fixes land? Are they working? What's better? What's still broken? Be specific — name pages, behaviors, files.

### Round 2: "What's the highest-impact work for Sprint 2?"
Each panelist gives their TOP 3 priorities for the next sprint. Not a wishlist — your three specific, buildable tasks that would move us closest to v1.0. Disagree with each other. Debate priority order.

### Round 3: "Are we v1.0 yet? What's the gap?"
Honest assessment. If we shipped everything from Round 2, would you call it v1.0? If not, what's still missing? Define the finish line clearly so we know when we've crossed it.

## Ground Rules

- **One response per panelist per round.** No repeating yourself. Say it once, say it well.
- **React to the screenshots.** Not to what you remember building. What do you SEE right now?
- **Every problem comes with a proposed fix.** No complaints without solutions.
- **Disagree openly.** If Pixel says the UI is fine and Gater says it's broken, that tension is valuable.
- **Think like an owner.** This is your product. Would you ship this to a customer?

## Output

The session MUST complete with:
1. **Synthesis** — Henry summarizes the key findings and areas of agreement/disagreement
2. **Action Items** — specific, buildable tasks extracted from the discussion
3. **Sprint 2 Task List** — each action item becomes a task on the board, assigned to the right agent, prioritized by panel consensus

## How We Build Sprint 2 (Non-Negotiable)

Everything goes through the system:
- Tasks created on the task board with proper assignments
- Agents build through the pipeline — Codex for coding, Sonnet for complex reasoning
- Gater auto-spawns on review (if Sprint 1 fix shipped) or Henry triggers manually
- Every agent logs to their memory file
- Nothing ships without QA sign-off

**This is our system improving itself. Make it count.**
