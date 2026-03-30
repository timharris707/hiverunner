/**
 * GET  /api/advisory/sessions/[id]/review-loop — Return current loop state
 * POST /api/advisory/sessions/[id]/review-loop — Execute loop actions
 *
 * Actions (via `action` field in request body):
 *   "start"            — Begin the loop from task #1
 *   "advance"          — Process next step (worker submit, reviewer check, or move to next task)
 *   "override"         — Human overrides a task status { taskId, newStatus }
 *   "pause"            — Pause the loop
 *   "resume"           — Resume the loop
 *   "add-task"         — Add a new task to the list { description, insertAfter? }
 *   "supervisor-check" — Trigger supervisor status update
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { buildAdvisoryAgentDefs, type AdvisoryAgentDef } from "@/config/agents";
import { spawnAdvisoryAgentWithRetry } from "@/lib/advisory-agent";

const DATA_DIR = path.join(process.cwd(), "data", "advisory");

// ─── Agent definitions — from central registry ──────────────────────────────

const AGENT_DEFS = buildAdvisoryAgentDefs();

// ─── Agent spawning helper ───────────────────────────────────────────────────

async function callAgent(sessionId: string, agentId: string, systemPrompt: string, userPrompt: string): Promise<{ text: string; model: string }> {
  const result = await spawnAdvisoryAgentWithRetry({
    sessionId,
    agentId: `reviewloop-${agentId}`,
    systemPrompt,
    userPrompt,
    timeoutSeconds: 120,
  });
  return { text: result.text, model: result.model };
}

// ─── Session file helpers ────────────────────────────────────────────────────

function readSession(filePath: string) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function writeSession(filePath: string, session: Record<string, unknown>) {
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
}

function appendEvent(filePath: string, event: Record<string, unknown>) {
  const session = readSession(filePath);
  session.events = [...(session.events || []), event];
  writeSession(filePath, session);
}

function setThinkingAgent(filePath: string, agentId: string | null) {
  try {
    const session = readSession(filePath);
    session.thinkingAgent = agentId;
    writeSession(filePath, session);
  } catch { /* ignore */ }
}

// ─── Review Loop types ───────────────────────────────────────────────────────

interface ReviewTask {
  id: number;
  description: string;
  status: "pending" | "in-progress" | "in-review" | "approved" | "rejected" | "retrying" | "blocked";
  attempts: number;
  notes: string;
  overriddenBy: string | null;
  workerOutput?: string;
  reviewerFeedback?: string;
}

interface ReviewLoop {
  tasks: ReviewTask[];
  currentTaskIndex: number;
  workerAgent: string;
  reviewerAgent: string;
  supervisorAgent: string;
  supervisorInterval: number;
  totalApproved: number;
  totalRejected: number;
  autoContinue: boolean;
  paused: boolean;
  maxRetries: number;
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildWorkerPrompt(task: ReviewTask, topic: string, workerAgent: string, previousFeedback?: string): { system: string; user: string } {
  const agent = AGENT_DEFS[workerAgent];
  const agentIdentity = agent
    ? `You are ${agent.name} ${agent.emoji}, the ${agent.role} at Harris Autonomous.\nYour expertise: ${agent.expertise}\n\n${agent.persona}`
    : `You are ${workerAgent}, an AI agent at Harris Autonomous.`;

  const system = `${agentIdentity}

---

**YOUR ROLE: WORKER**

You are executing tasks in a structured review loop. A Reviewer will check your work after you submit — they will approve or reject with specific feedback.

**How to operate:**
- Complete the assigned task thoroughly and precisely
- Be specific and actionable — vague work will be rejected
- If this is a retry after rejection, directly address EVERY piece of feedback
- Show your work clearly so the reviewer can evaluate it
- Do not pad with unnecessary caveats — deliver the work product

**Session topic:** ${topic}`;

  const retryBlock = previousFeedback
    ? `\n\n**PREVIOUS ATTEMPT WAS REJECTED. Reviewer feedback:**\n${previousFeedback}\n\nAddress every point above. Be explicit about what you changed.`
    : "";

  const user = `**Task #${task.id}: ${task.description}**${retryBlock}${task.notes ? `\n\n**Notes:** ${task.notes}` : ""}

Complete this task now. Deliver your work product.`;

  return { system, user };
}

function buildReviewerPrompt(task: ReviewTask, workerOutput: string, topic: string, reviewerAgent: string, workerAgent: string): { system: string; user: string } {
  const agent = AGENT_DEFS[reviewerAgent];
  const agentIdentity = agent
    ? `You are ${agent.name} ${agent.emoji}, the ${agent.role} at Harris Autonomous.\nYour expertise: ${agent.expertise}\n\n${agent.persona}`
    : `You are ${reviewerAgent}, an AI agent at Harris Autonomous.`;

  const system = `${agentIdentity}

---

**YOUR ROLE: REVIEWER**

You are reviewing work submitted by ${workerAgent} in a structured review loop. Your job is to evaluate whether the work meets the bar — approve it or reject it with specific, actionable feedback.

**How to review:**
- Evaluate the work against the task requirements
- Be specific: quote or reference exact parts you're critiquing
- If rejecting, explain exactly what needs to change and why
- Don't reject for style preferences — reject for substance issues
- If the work is good enough, approve it. Don't create busywork.

**You MUST end your review with exactly one of these on its own line:**
VERDICT: APPROVE
VERDICT: REJECT

**Session topic:** ${topic}`;

  const user = `**Task #${task.id}: ${task.description}**

**${workerAgent}'s submission (attempt ${task.attempts}):**

${workerOutput}

Review this work. Is it complete, correct, and sufficient? End with your VERDICT.`;

  return { system, user };
}

function buildSupervisorPrompt(loop: ReviewLoop, topic: string): { system: string; user: string } {
  const agent = AGENT_DEFS[loop.supervisorAgent];
  const agentIdentity = agent
    ? `You are ${agent.name} ${agent.emoji}, the ${agent.role} at Harris Autonomous.\nYour expertise: ${agent.expertise}\n\n${agent.persona}`
    : `You are ${loop.supervisorAgent}, an AI agent at Harris Autonomous.`;

  const statusEmoji: Record<string, string> = {
    "pending": "⬜", "in-progress": "🔄", "in-review": "👀",
    "approved": "✅", "rejected": "❌", "retrying": "🔁", "blocked": "⏸️",
  };

  const taskSummary = loop.tasks.map((t) =>
    `${statusEmoji[t.status] || "⬜"} Task #${t.id}: ${t.description} [${t.status}, ${t.attempts} attempt(s)]${t.overriddenBy ? " ✋ OVERRIDDEN" : ""}`
  ).join("\n");

  const system = `${agentIdentity}

---

**YOUR ROLE: SUPERVISOR**

You are overseeing a structured review loop where ${loop.workerAgent} executes tasks and ${loop.reviewerAgent} reviews them. Provide a brief status update on overall progress.

**Session topic:** ${topic}`;

  const total = loop.tasks.length;
  const pct = total > 0 ? Math.round((loop.totalApproved / total) * 100) : 0;

  const user = `**Progress Report**

${loop.totalApproved} of ${total} tasks completed (${pct}%)
Rejected: ${loop.totalRejected} total rejections across all tasks

**Task Status:**
${taskSummary}

Provide a brief supervisor status update: what's going well, any concerns, and recommendations. Keep it concise (2-3 paragraphs max).`;

  return { system, user };
}

// ─── GET: Return current loop state ──────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const filePath = path.join(DATA_DIR, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const session = readSession(filePath);
  return NextResponse.json({
    reviewLoop: session.reviewLoop || null,
    status: session.status,
    paused: session.reviewLoop?.paused ?? false,
  });
}

// ─── POST: Execute loop actions ──────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const filePath = path.join(DATA_DIR, `${id}.json`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const body = await req.json();
  const { action } = body;
  const session = readSession(filePath);
  const topic = session.topic as string;

  // ── Start: Begin the loop ──
  if (action === "start") {
    if (session.status !== "active") {
      return NextResponse.json({ error: "Session is not active" }, { status: 400 });
    }
    const loop: ReviewLoop | undefined = session.reviewLoop;
    if (!loop) {
      return NextResponse.json({ error: "No reviewLoop configured" }, { status: 400 });
    }

    // Emit start event
    appendEvent(filePath, {
      id: `evt_loop_start_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: "start",
      speaker: loop.supervisorAgent,
      emoji: AGENT_DEFS[loop.supervisorAgent]?.emoji || "⚡",
      role: "supervisor",
      text: `🚀 **Review Loop Started**\n\n**Topic:** ${topic}\n\n**Worker:** ${loop.workerAgent} · **Reviewer:** ${loop.reviewerAgent} · **Supervisor:** ${loop.supervisorAgent}\n**Tasks:** ${loop.tasks.length} · **Auto-Continue:** ${loop.autoContinue ? "ON" : "OFF"} · **Max Retries:** ${loop.maxRetries}\n\nBeginning task #1...`,
    });

    // Fire and forget: run the first step
    runLoopStep(filePath, id, topic).catch(console.error);
    return NextResponse.json({ ok: true, message: "Loop started" });
  }

  // ── Advance: Continue to next step (manual continue) ──
  if (action === "advance") {
    if (session.status !== "active") {
      return NextResponse.json({ error: "Session is not active" }, { status: 400 });
    }
    const loop: ReviewLoop | undefined = session.reviewLoop;
    if (!loop) {
      return NextResponse.json({ error: "No reviewLoop configured" }, { status: 400 });
    }

    // Unpause if paused
    if (loop.paused) {
      loop.paused = false;
      session.reviewLoop = loop;
      writeSession(filePath, session);
    }

    runLoopStep(filePath, id, topic).catch(console.error);
    return NextResponse.json({ ok: true, message: "Loop advancing" });
  }

  // ── Override: Human overrides a task status ──
  if (action === "override") {
    const { taskId, newStatus, notes } = body;
    const loop: ReviewLoop | undefined = session.reviewLoop;
    if (!loop) {
      return NextResponse.json({ error: "No reviewLoop configured" }, { status: 400 });
    }

    const taskIdx = loop.tasks.findIndex((t: ReviewTask) => t.id === taskId);
    if (taskIdx === -1) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const task = loop.tasks[taskIdx];
    const oldStatus = task.status;
    task.status = newStatus;
    task.overriddenBy = "Tim";
    if (notes) task.notes = notes;

    // Update counters
    if (newStatus === "approved" && oldStatus !== "approved") {
      loop.totalApproved += 1;
      // If this was the current task, advance
      if (taskIdx === loop.currentTaskIndex) {
        loop.currentTaskIndex += 1;
      }
    }
    if (oldStatus === "approved" && newStatus !== "approved") {
      loop.totalApproved = Math.max(0, loop.totalApproved - 1);
    }

    loop.tasks[taskIdx] = task;
    session.reviewLoop = loop;
    writeSession(filePath, session);

    // Emit override event
    appendEvent(filePath, {
      id: `evt_override_${Date.now()}_t${taskId}`,
      timestamp: new Date().toISOString(),
      type: newStatus === "approved" ? "approve" : "supervisor",
      speaker: "Tim",
      emoji: "✋",
      role: "supervisor",
      text: `**✋ Human Override — Task #${taskId}:** ${task.description}\n\nStatus changed from **${oldStatus}** → **${newStatus}**${notes ? `\n\n**Notes:** ${notes}` : ""}`,
      taskId,
      verdict: newStatus === "approved" ? "approve" : undefined,
    });

    return NextResponse.json({ ok: true, reviewLoop: loop });
  }

  // ── Pause ──
  if (action === "pause") {
    const loop: ReviewLoop | undefined = session.reviewLoop;
    if (!loop) {
      return NextResponse.json({ error: "No reviewLoop configured" }, { status: 400 });
    }
    loop.paused = true;
    session.reviewLoop = loop;
    writeSession(filePath, session);

    appendEvent(filePath, {
      id: `evt_pause_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: "supervisor",
      speaker: "Tim",
      emoji: "⏸️",
      role: "supervisor",
      text: "**⏸️ Loop Paused** — Waiting for human to resume.",
    });

    return NextResponse.json({ ok: true, paused: true });
  }

  // ── Resume ──
  if (action === "resume") {
    const loop: ReviewLoop | undefined = session.reviewLoop;
    if (!loop) {
      return NextResponse.json({ error: "No reviewLoop configured" }, { status: 400 });
    }
    loop.paused = false;
    session.reviewLoop = loop;
    writeSession(filePath, session);

    appendEvent(filePath, {
      id: `evt_resume_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: "supervisor",
      speaker: "Tim",
      emoji: "▶️",
      role: "supervisor",
      text: "**▶️ Loop Resumed** — Continuing execution.",
    });

    // If auto-continue is on, kick off the next step
    if (loop.autoContinue) {
      runLoopStep(filePath, id, topic).catch(console.error);
    }

    return NextResponse.json({ ok: true, paused: false });
  }

  // ── Add Task ──
  if (action === "add-task") {
    const { description, insertAfter } = body;
    if (!description?.trim()) {
      return NextResponse.json({ error: "Task description is required" }, { status: 400 });
    }
    const loop: ReviewLoop | undefined = session.reviewLoop;
    if (!loop) {
      return NextResponse.json({ error: "No reviewLoop configured" }, { status: 400 });
    }

    const maxId = loop.tasks.reduce((max: number, t: ReviewTask) => Math.max(max, t.id), 0);
    const newTask: ReviewTask = {
      id: maxId + 1,
      description: description.trim(),
      status: "pending",
      attempts: 0,
      notes: "",
      overriddenBy: null,
    };

    if (typeof insertAfter === "number") {
      const insertIdx = loop.tasks.findIndex((t: ReviewTask) => t.id === insertAfter);
      if (insertIdx !== -1) {
        loop.tasks.splice(insertIdx + 1, 0, newTask);
      } else {
        loop.tasks.push(newTask);
      }
    } else {
      loop.tasks.push(newTask);
    }

    session.reviewLoop = loop;
    writeSession(filePath, session);

    appendEvent(filePath, {
      id: `evt_addtask_${Date.now()}_t${newTask.id}`,
      timestamp: new Date().toISOString(),
      type: "supervisor",
      speaker: "Tim",
      emoji: "➕",
      role: "supervisor",
      text: `**➕ Task Added:** #${newTask.id} — ${newTask.description}`,
      taskId: newTask.id,
    });

    return NextResponse.json({ ok: true, task: newTask, reviewLoop: loop });
  }

  // ── Supervisor Check ──
  if (action === "supervisor-check") {
    const loop: ReviewLoop | undefined = session.reviewLoop;
    if (!loop) {
      return NextResponse.json({ error: "No reviewLoop configured" }, { status: 400 });
    }
    runSupervisorCheck(filePath, loop, topic, model).catch(console.error);
    return NextResponse.json({ ok: true, message: "Supervisor check triggered" });
  }

  // ── Set Auto-Continue ──
  if (action === "set-auto-continue") {
    const loop: ReviewLoop | undefined = session.reviewLoop;
    if (!loop) {
      return NextResponse.json({ error: "No reviewLoop configured" }, { status: 400 });
    }
    loop.autoContinue = !!body.autoContinue;
    session.reviewLoop = loop;
    writeSession(filePath, session);
    return NextResponse.json({ ok: true, autoContinue: loop.autoContinue });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}

// ─── Loop step execution ─────────────────────────────────────────────────────

async function runLoopStep(filePath: string, sessionId: string, topic: string) {
  let session = readSession(filePath);
  let currentLoop: ReviewLoop = session.reviewLoop;

  // Check paused
  if (currentLoop.paused) return;
  if (session.status !== "active") return;

  const taskIndex = currentLoop.currentTaskIndex;
  const task = currentLoop.tasks[taskIndex];

  if (!task) {
    // All tasks done
    await new Promise((r) => setTimeout(r, 500));
    await runSupervisorCheck(filePath, sessionId, currentLoop, topic);

    session = readSession(filePath);
    session.status = "completed";
    session.completedAt = new Date().toISOString();
    session.outcome = "review-loop-complete";
    writeSession(filePath, session);
    return;
  }

  // Skip already-approved tasks (e.g. via human override)
  if (task.status === "approved") {
    currentLoop.currentTaskIndex += 1;
    session.reviewLoop = currentLoop;
    writeSession(filePath, session);
    // Continue to next
    if (currentLoop.autoContinue && !currentLoop.paused) {
      await new Promise((r) => setTimeout(r, 300));
      return runLoopStep(filePath, sessionId, topic);
    }
    return;
  }

  // Skip blocked tasks
  if (task.status === "blocked") {
    currentLoop.currentTaskIndex += 1;
    session.reviewLoop = currentLoop;
    writeSession(filePath, session);
    if (currentLoop.autoContinue && !currentLoop.paused) {
      await new Promise((r) => setTimeout(r, 300));
      return runLoopStep(filePath, sessionId, topic);
    }
    return;
  }

  const isRetry = task.status === "rejected" || task.status === "retrying";

  // ── Step 1: Worker executes the task ──
  task.status = "in-progress";
  task.attempts += 1;
  currentLoop.tasks[taskIndex] = task;
  session.reviewLoop = currentLoop;
  writeSession(filePath, session);

  const previousFeedback = isRetry ? task.reviewerFeedback : undefined;
  const { system: workerSystem, user: workerUser } = buildWorkerPrompt(task, topic, currentLoop.workerAgent, previousFeedback);

  setThinkingAgent(filePath, currentLoop.workerAgent);
  let workerOutput = "";
  let workerModel = "openclaw-agent";
  try {
    const wResult = await callAgent(sessionId, currentLoop.workerAgent, workerSystem, workerUser);
    workerOutput = wResult.text;
    workerModel = wResult.model;
  } catch (err) {
    workerOutput = `⚠️ Failed to generate response: ${String(err)}`;
  }
  setThinkingAgent(filePath, null);

  // Save worker output
  task.workerOutput = workerOutput;
  session = readSession(filePath);
  currentLoop = session.reviewLoop;
  currentLoop.tasks[taskIndex] = task;
  session.reviewLoop = currentLoop;
  writeSession(filePath, session);

  const workerAgent = AGENT_DEFS[currentLoop.workerAgent];
  appendEvent(filePath, {
    id: `evt_work_${Date.now()}_t${task.id}`,
    timestamp: new Date().toISOString(),
    type: "worker",
    speaker: currentLoop.workerAgent,
    emoji: workerAgent?.emoji || "🔵",
    role: "worker",
    text: `**📄 Task #${task.id}${isRetry ? ` (Attempt ${task.attempts})` : ""}:** ${task.description}\n\n${workerOutput}`,
    taskId: task.id,
    model: workerModel,
  });

  await new Promise((r) => setTimeout(r, 500));

  // Check session still active and not paused
  session = readSession(filePath);
  currentLoop = session.reviewLoop;
  if (session.status !== "active" || currentLoop.paused) return;

  // ── Step 2: Reviewer evaluates ──
  task.status = "in-review";
  currentLoop.tasks[taskIndex] = task;
  session.reviewLoop = currentLoop;
  writeSession(filePath, session);

  const { system: reviewerSystem, user: reviewerUser } = buildReviewerPrompt(
    task, workerOutput, topic, currentLoop.reviewerAgent, currentLoop.workerAgent
  );

  setThinkingAgent(filePath, currentLoop.reviewerAgent);
  let reviewText = "";
  let reviewModel = "openclaw-agent";
  try {
    const rResult = await callAgent(sessionId, currentLoop.reviewerAgent, reviewerSystem, reviewerUser);
    reviewText = rResult.text;
    reviewModel = rResult.model;
  } catch (err) {
    reviewText = `⚠️ Failed to generate review: ${String(err)}`;
  }
  setThinkingAgent(filePath, null);

  const isApproved = reviewText.includes("VERDICT: APPROVE") && !reviewText.includes("VERDICT: REJECT");

  // Update task status
  session = readSession(filePath);
  currentLoop = session.reviewLoop;

  if (isApproved) {
    task.status = "approved";
    task.reviewerFeedback = reviewText;
    currentLoop.totalApproved += 1;
    currentLoop.currentTaskIndex += 1;
  } else {
    task.status = "rejected";
    task.reviewerFeedback = reviewText;
    currentLoop.totalRejected += 1;
  }

  currentLoop.tasks[taskIndex] = task;
  session.reviewLoop = currentLoop;
  writeSession(filePath, session);

  const reviewerAgentDef = AGENT_DEFS[currentLoop.reviewerAgent];
  appendEvent(filePath, {
    id: `evt_review_${Date.now()}_t${task.id}`,
    timestamp: new Date().toISOString(),
    type: isApproved ? "approve" : "reject",
    speaker: currentLoop.reviewerAgent,
    emoji: reviewerAgentDef?.emoji || "🟡",
    role: "reviewer",
    text: `**${isApproved ? "🟢 Approved" : "🔴 Rejected"} — Task #${task.id}:** ${task.description}\n\n${reviewText}`,
    verdict: isApproved ? "approve" : "reject",
    taskId: task.id,
    model: reviewModel,
  });

  // ── Step 3: Decide what happens next ──

  // Supervisor check every N approved tasks
  if (isApproved && currentLoop.totalApproved > 0 && currentLoop.totalApproved % currentLoop.supervisorInterval === 0) {
    await new Promise((r) => setTimeout(r, 500));
    await runSupervisorCheck(filePath, sessionId, currentLoop, topic);
  }

  // Re-read for freshest state
  session = readSession(filePath);
  currentLoop = session.reviewLoop;
  if (session.status !== "active" || currentLoop.paused) return;

  if (isApproved) {
    // Check if all tasks done
    if (currentLoop.currentTaskIndex >= currentLoop.tasks.length) {
      await new Promise((r) => setTimeout(r, 500));
      await runSupervisorCheck(filePath, sessionId, currentLoop, topic);
      session = readSession(filePath);
      session.status = "completed";
      session.completedAt = new Date().toISOString();
      session.outcome = "review-loop-complete";
      writeSession(filePath, session);
      return;
    }

    // Auto-continue to next task
    if (currentLoop.autoContinue && !currentLoop.paused) {
      await new Promise((r) => setTimeout(r, 500));
      return runLoopStep(filePath, sessionId, topic);
    }
    // Otherwise, wait for human to click "Continue"
  } else {
    // Rejected — auto-retry if under maxRetries and auto-continue is on
    if (task.attempts < currentLoop.maxRetries && currentLoop.autoContinue && !currentLoop.paused) {
      // Mark as retrying
      task.status = "retrying";
      currentLoop.tasks[taskIndex] = task;
      session = readSession(filePath);
      session.reviewLoop = currentLoop;
      writeSession(filePath, session);

      await new Promise((r) => setTimeout(r, 500));
      return runLoopStep(filePath, sessionId, topic);
    }
    // Otherwise, wait for human intervention (retry, override, or skip)
  }
}

async function runSupervisorCheck(filePath: string, sessionId: string, loop: ReviewLoop, topic: string) {
  const session = readSession(filePath);
  const currentLoop: ReviewLoop = session.reviewLoop || loop;

  const { system, user } = buildSupervisorPrompt(currentLoop, topic);

  setThinkingAgent(filePath, currentLoop.supervisorAgent);
  let supervisorText = "";
  let supModel = "openclaw-agent";
  try {
    const sResult = await callAgent(sessionId, currentLoop.supervisorAgent, system, user);
    supervisorText = sResult.text;
    supModel = sResult.model;
  } catch (err) {
    supervisorText = `⚠️ Supervisor check failed: ${String(err)}`;
  }
  setThinkingAgent(filePath, null);

  const supAgent = AGENT_DEFS[currentLoop.supervisorAgent];
  appendEvent(filePath, {
    id: `evt_supervisor_${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: "supervisor",
    speaker: currentLoop.supervisorAgent,
    emoji: supAgent?.emoji || "🟠",
    role: "supervisor",
    text: `**📋 Supervisor Status Update**\n\n${supervisorText}`,
    model: supModel,
  });
}
