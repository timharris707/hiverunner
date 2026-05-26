import fs from "fs";
import path from "path";

export type AgentAvatarIdentity = {
  styleId: string;
  gender: "female" | "male" | "androgynous";
  age: number;
  hairColor: string;
  hairLength: string;
  eyeColor: string;
  vibe: string;
};

export type AgentVoiceIdentity = {
  voiceId: string;
  rationale: string;
};

export type AgentAuthority = {
  canCreateTasks: boolean;
  canAssignTasks: boolean;
  approvalScope: string;
  canRelease: boolean;
  canCommitPush: boolean;
  handoff: string;
};

export type AgentDossier = {
  name: string;
  role: string;
  companyName: string;
  projectName: string;
  reportsTo: string;
  emoji: string;
  personality: string;
  mission: string;
  capabilities: string[];
  operatingPrinciples: string[];
  decisionRules: string[];
  escalationRules: string[];
  authority: AgentAuthority;
  avatar: AgentAvatarIdentity;
  voice: AgentVoiceIdentity;
  files: {
    identityMd: string;
    soulMd: string;
    agentsMd: string;
    heartbeatMd: string;
    toolsMd: string;
  };
};

export type AgentDossierInput = {
  name: string;
  role: string;
  companyName: string;
  projectName: string;
  projectSlug: string;
  reportsTo: string;
  emoji?: string | null;
  personality?: string | null;
  mission?: string | null;
  capabilities?: string | string[] | null;
  reason?: string | null;
  avatarStyleId?: string | null;
  avatarGender?: string | null;
  avatarAge?: number | null;
  avatarHairColor?: string | null;
  avatarHairLength?: string | null;
  avatarEyeColor?: string | null;
  avatarVibe?: string | null;
  voiceId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  speedPreference?: string | null;
  authority?: Partial<AgentAuthority> | null;
};

export type AgentReadinessReport = {
  ready: boolean;
  missingFiles: string[];
  missingFields: string[];
};

const FILE_NAMES = ["IDENTITY.md", "SOUL.md", "AGENTS.md", "HEARTBEAT.md", "TOOLS.md"] as const;

const VOICE_IDS = {
  strategy: "Orus",
  design: "Aoede",
  engineering: "Iapetus",
  product: "Kore",
  research: "Erinome",
  operations: "Schedar",
  quality: "Rasalgethi",
  finance: "Sadaltager",
  sales: "Achird",
  support: "Sulafat",
  general: "Charon",
} as const;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function oneOf<T>(items: readonly T[], seed: string): T {
  return items[stableHash(seed) % items.length] as T;
}

function compactLines(lines: string[]): string {
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function splitCapabilities(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => item.trim()).filter(Boolean);
  }
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function roleFamily(role: string): keyof typeof VOICE_IDS {
  const lower = role.toLowerCase();
  if (/\b(ceo|chief|founder|strategy|strategist|executive)\b/.test(lower)) return "strategy";
  if (/\b(design|designer|brand|creative|ux|ui|visual|art)\b/.test(lower)) return "design";
  if (/\b(engineer|developer|frontend|backend|full[- ]?stack|devops|platform|architect)\b/.test(lower)) {
    return "engineering";
  }
  if (/\b(product|pm|roadmap|program)\b/.test(lower)) return "product";
  if (/\b(research|analyst|market|insight)\b/.test(lower)) return "research";
  if (/\b(qa|quality|test|tester|review)\b/.test(lower)) return "quality";
  if (/\b(finance|accounting|revenue|pricing|ops finance)\b/.test(lower)) return "finance";
  if (/\b(sales|growth|business development|partnership)\b/.test(lower)) return "sales";
  if (/\b(support|success|customer|service)\b/.test(lower)) return "support";
  if (/\b(operations|ops|producer|coordinator|admin)\b/.test(lower)) return "operations";
  return "general";
}

function defaultEmoji(role: string): string {
  const family = roleFamily(role);
  if (family === "strategy") return "leadership";
  if (family === "design") return "design";
  if (family === "engineering") return "code";
  if (family === "product") return "product";
  if (family === "research") return "research";
  if (family === "quality") return "quality";
  if (family === "finance") return "finance";
  if (family === "sales") return "growth";
  if (family === "support") return "support";
  if (family === "operations") return "operations";
  return "agent";
}

function inferCapabilities(role: string, provided: string[]): string[] {
  const family = roleFamily(role);
  const roleSpecific: Record<keyof typeof VOICE_IDS, string[]> = {
    strategy: [
      "Set priorities from company goals and current constraints.",
      "Break ambiguous direction into accountable projects and tasks.",
      "Hire, route, and evaluate specialist agents.",
    ],
    design: [
      "Translate business goals into coherent product and brand experiences.",
      "Create design briefs, critiques, and implementation-ready UI guidance.",
      "Protect visual consistency across deliverables.",
    ],
    engineering: [
      "Read the codebase before changing behavior.",
      "Implement scoped fixes with tests for the changed contract.",
      "Surface technical risks, regressions, and integration blockers.",
    ],
    product: [
      "Clarify user outcomes, acceptance criteria, and sequencing.",
      "Turn broad ideas into small, testable work items.",
      "Maintain a practical roadmap across competing priorities.",
    ],
    research: [
      "Gather evidence, compare options, and identify uncertainty.",
      "Produce concise findings with sources, assumptions, and next steps.",
      "Separate facts from recommendations.",
    ],
    operations: [
      "Keep work moving across queues, owners, and deadlines.",
      "Detect stalled tasks and coordinate handoffs.",
      "Maintain clean status updates and escalation paths.",
    ],
    quality: [
      "Test critical workflows before declaring work complete.",
      "Reproduce failures with concrete steps and expected behavior.",
      "Block releases when acceptance criteria are not met.",
    ],
    finance: [
      "Model costs, revenue, and operational constraints.",
      "Call out assumptions and sensitivity risks.",
      "Keep recommendations tied to measurable business impact.",
    ],
    sales: [
      "Turn positioning into outbound, partnership, and conversion work.",
      "Track objections, buyer needs, and follow-up commitments.",
      "Keep promises grounded in current product capability.",
    ],
    support: [
      "Diagnose user issues from symptoms and recent changes.",
      "Communicate clearly, calmly, and actionably.",
      "Feed recurring issues back into product and engineering.",
    ],
    general: [
      "Own assigned work from intake to completion.",
      "Ask for missing context only when it blocks progress.",
      "Report status in concrete, verifiable terms.",
    ],
  };

  const merged = [...provided, ...roleSpecific[family]];
  return Array.from(new Set(merged)).slice(0, 16);
}

function inferOperatingPrinciples(role: string): string[] {
  const family = roleFamily(role);
  const base = [
    "Start from the company mission, the assigned task, and the current project state.",
    "Prefer concrete progress over broad commentary.",
    "Leave the workspace cleaner and more understandable than you found it.",
  ];
  if (family === "design") {
    return [
      ...base,
      "Make design decisions visible through rationale, not decoration.",
      "Validate responsive behavior and visual hierarchy before handoff.",
    ];
  }
  if (family === "engineering") {
    return [
      ...base,
      "Use the existing architecture before inventing new abstractions.",
      "Verify changes with the narrowest meaningful test first.",
    ];
  }
  if (family === "strategy") {
    return [
      ...base,
      "Make ownership and next actions explicit.",
      "Hire only when the missing capability is persistent and material.",
    ];
  }
  return base;
}

function inferDecisionRules(role: string): string[] {
  const family = roleFamily(role);
  if (family === "quality") {
    return [
      "Do not mark work complete without a reproducible verification path.",
      "Escalate flaky, ambiguous, or untestable acceptance criteria.",
      "Prefer one precise failing case over a vague broad concern.",
    ];
  }
  if (family === "engineering") {
    return [
      "Touch the smallest surface area that can solve the assigned problem.",
      "Avoid schema, API, or workflow changes without checking downstream callers.",
      "Call out any verification that could not be run.",
    ];
  }
  if (family === "design") {
    return [
      "Prioritize user workflow clarity over decorative novelty.",
      "Keep visual systems consistent with the existing product language.",
      "Escalate when brand, audience, or accessibility constraints conflict.",
    ];
  }
  return [
    "Choose the action that most directly advances the assigned outcome.",
    "Escalate when authority, missing access, or unclear goals would cause rework.",
    "Use concise status updates that name the result, blocker, and next step.",
  ];
}

function inferAvatar(input: AgentDossierInput): AgentAvatarIdentity {
  const family = roleFamily(input.role);
  const seed = `${input.companyName}:${input.name}:${input.role}`;
  const styleByFamily: Record<keyof typeof VOICE_IDS, string> = {
    strategy: "editorial-executive",
    design: "studio-portrait",
    engineering: "technical-operator",
    product: "product-lead",
    research: "research-analyst",
    operations: "operations-lead",
    quality: "quality-specialist",
    finance: "finance-advisor",
    sales: "market-facing",
    support: "customer-guide",
    general: "hiverunner",
  };
  const vibeByFamily: Record<keyof typeof VOICE_IDS, string> = {
    strategy: "decisive, composed, executive",
    design: "observant, tasteful, visually fluent",
    engineering: "focused, precise, systems-minded",
    product: "practical, connective, user-centered",
    research: "curious, rigorous, evidence-driven",
    operations: "steady, organized, momentum-oriented",
    quality: "careful, skeptical, detail-oriented",
    finance: "measured, analytical, commercially aware",
    sales: "warm, confident, externally fluent",
    support: "patient, clear, service-minded",
    general: "capable, direct, collaborative",
  };

  const normalizedGender = input.avatarGender === "female" || input.avatarGender === "male"
    ? input.avatarGender
    : "androgynous";

  return {
    styleId: input.avatarStyleId?.trim() || styleByFamily[family],
    gender: normalizedGender,
    age: input.avatarAge && input.avatarAge >= 18 ? Math.round(input.avatarAge) : 30 + (stableHash(seed) % 22),
    hairColor: input.avatarHairColor?.trim() || oneOf(["black", "brown", "dark brown", "silver", "auburn"], seed),
    hairLength: input.avatarHairLength?.trim() || oneOf(["short", "medium", "cropped", "shoulder-length"], `${seed}:hair`),
    eyeColor: input.avatarEyeColor?.trim() || oneOf(["brown", "green", "hazel", "blue", "gray"], `${seed}:eyes`),
    vibe: input.avatarVibe?.trim() || vibeByFamily[family],
  };
}

function inferVoice(input: AgentDossierInput, avatar: AgentAvatarIdentity): AgentVoiceIdentity {
  if (input.voiceId?.trim()) {
    return {
      voiceId: input.voiceId.trim(),
      rationale: "Selected explicitly during agent creation.",
    };
  }

  const family = roleFamily(input.role);
  let voiceId: string = VOICE_IDS[family];
  if (avatar.gender === "female" && family === "general") voiceId = "Kore";
  if (avatar.gender === "androgynous" && family === "general") voiceId = "Schedar";

  return {
    voiceId,
    rationale: `Selected for a ${family} role with ${avatar.gender} avatar presentation.`,
  };
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function inferAuthority(input: AgentDossierInput): AgentAuthority {
  const role = input.role.toLowerCase();
  const provided = input.authority ?? {};
  const isLead = /\b(lead|orchestrator|ceo|product)\b/.test(role);
  const isQa = /\b(qa|verification|quality)\b/.test(role);
  const isRelease = /\b(repo|release|steward)\b/.test(role);
  const isLegal = /\b(legal|compliance)\b/.test(role);
  const isFinancial = /\b(financial|audit|auditor|finance)\b/.test(role);
  const isResearch = /\b(research)\b/.test(role);
  const isWriter = /\b(writer|content)\b/.test(role);
  const isUx = /\b(ux|product analyst)\b/.test(role);

  let approvalScope = "No final approval authority; send completed work to the required reviewer.";
  if (isLead) approvalScope = "Product/scope approval and task routing decisions.";
  if (isQa) approvalScope = "QA pass/fail, regression evidence, and acceptance verification.";
  if (isRelease) approvalScope = "Release readiness, repository hygiene, and promotion evidence.";
  if (isLegal) approvalScope = "Legal/compliance review for lending-sensitive work.";
  if (isFinancial) approvalScope = "Financial calculation and assumption accuracy review.";
  if (isWriter) approvalScope = "Content quality review; route legal/financial claims to specialists.";
  if (isResearch) approvalScope = "Research evidence quality; route legal/financial claims to specialists.";
  if (isUx) approvalScope = "UX/product workflow review; route implementation to builders.";

  let handoff = "Send completed implementation to Gator for QA.";
  if (isLead) handoff = "Route implementation to specialists, QA to Gator, and release work to Ralph.";
  if (isQa) handoff = "Send approved code-release needs to Ralph; send rework to the original owner.";
  if (isRelease) handoff = "Require QA pass or explicit Oracle/operator override before release.";
  if (isLegal || isFinancial || isResearch || isWriter || isUx) handoff = "Create follow-up tasks for implementation needs and route them through Oracle or the assigned builder.";

  return {
    canCreateTasks: provided.canCreateTasks ?? true,
    canAssignTasks: provided.canAssignTasks ?? (isLead || isQa || isRelease),
    approvalScope: normalizeText(provided.approvalScope) || approvalScope,
    canRelease: provided.canRelease ?? isRelease,
    canCommitPush: provided.canCommitPush ?? isRelease,
    handoff: normalizeText(provided.handoff) || handoff,
  };
}

export function generateAgentDossier(input: AgentDossierInput): AgentDossier {
  const capabilities = inferCapabilities(input.role, splitCapabilities(input.capabilities));
  const avatar = inferAvatar(input);
  const voice = inferVoice(input, avatar);
  const authority = inferAuthority(input);
  const emoji = normalizeText(input.emoji) || defaultEmoji(input.role);
  const companyWideScope = input.projectSlug === "all-company-projects";
  const projectIdentityLine = companyWideScope
    ? "- Project Scope: All company projects"
    : `- Project: ${input.projectName} (${input.projectSlug})`;
  const projectServiceLine = companyWideScope
    ? "- I serve all company projects unless a task narrows the scope."
    : `- I serve the ${input.projectName} project.`;
  const projectContractLine = companyWideScope
    ? "- Project Scope: All company projects"
    : `- Project: ${input.projectName}`;
  const mission =
    normalizeText(input.mission) ||
    normalizeText(input.reason) ||
    (companyWideScope
      ? `${input.name} owns ${input.role} outcomes across ${input.companyName}.`
      : `${input.name} owns ${input.role} outcomes for ${input.companyName} on ${input.projectName}.`);
  const personality =
    normalizeText(input.personality) ||
    `${input.name} is ${avatar.vibe}; they communicate in clear, practical updates and keep work moving without overstepping their role.`;
  const operatingPrinciples = inferOperatingPrinciples(input.role);
  const decisionRules = inferDecisionRules(input.role);
  const escalationRules = [
    "Escalate when required permissions, credentials, or user decisions are missing.",
    "Escalate when a task conflicts with company policy, project constraints, or the agent role.",
    "Escalate with a specific recommendation and the smallest decision needed to unblock work.",
  ];

  const identityMd = compactLines([
    "# IDENTITY.md - Agent Identity",
    "",
    `- Name: ${input.name}`,
    `- Role: ${input.role}`,
    `- Company: ${input.companyName}`,
    projectIdentityLine,
    `- Reports To: ${input.reportsTo}`,
    `- Default Model: ${normalizeText(input.model) || "Provider default"}`,
    `- Reasoning Effort: ${normalizeText(input.reasoningEffort) || "high"}`,
    `- Speed Preference: ${normalizeText(input.speedPreference) || "fast_1_5x"}`,
    `- Can Create Tasks: ${authority.canCreateTasks ? "Yes" : "No"}`,
    `- Can Assign Tasks: ${authority.canAssignTasks ? "Yes" : "No"}`,
    `- Approval Scope: ${authority.approvalScope}`,
    `- Can Release/Commit/Push: ${authority.canRelease || authority.canCommitPush ? "Yes" : "No"}`,
    `- Workspace Symbol: ${emoji}`,
    `- Avatar Style: ${avatar.styleId}`,
    `- Avatar Presentation: ${avatar.gender}, ${avatar.age}, ${avatar.hairColor} ${avatar.hairLength} hair, ${avatar.eyeColor} eyes`,
    `- Avatar Vibe: ${avatar.vibe}`,
    `- Voice: ${voice.voiceId}`,
    "",
    "## Mission",
    mission,
  ]);

  const soulMd = compactLines([
    "# SOUL.md - Agent Soul",
    "",
    `I am ${input.name}, the ${input.role} for ${input.companyName}.`,
    "",
    "## Core Identity",
    `- I report to ${input.reportsTo}.`,
    projectServiceLine,
    `- I am responsible for moving ${input.role} work from ambiguity to usable output.`,
    "",
    "## Personality",
    personality,
    "",
    "## Capabilities",
    ...capabilities.map((capability) => `- ${capability}`),
    "",
    "## Operating Principles",
    ...operatingPrinciples.map((principle) => `- ${principle}`),
    "",
    "## Decision Rules",
    ...decisionRules.map((rule) => `- ${rule}`),
    "",
    "## Authority",
    `- Create Tasks: ${authority.canCreateTasks ? "Allowed when needed for the assigned outcome." : "Not allowed without operator or lead direction."}`,
    `- Assign Tasks: ${authority.canAssignTasks ? "Allowed within role scope." : "Not allowed; route assignment needs to Oracle, Gator, or Ralph as appropriate."}`,
    `- Approval Scope: ${authority.approvalScope}`,
    `- Release / Commit / Push: ${authority.canRelease || authority.canCommitPush ? "Allowed within release scope after required QA evidence." : "Not allowed; route release work to Ralph."}`,
    `- Required Handoff: ${authority.handoff}`,
    "",
    "## Escalation",
    ...escalationRules.map((rule) => `- ${rule}`),
  ]);

  const agentsMd = compactLines([
    "# AGENTS.md - Working Agreement",
    "",
    "## Role Contract",
    `- Agent: ${input.name}`,
    `- Function: ${input.role}`,
    `- Company: ${input.companyName}`,
    projectContractLine,
    `- Reports To: ${input.reportsTo}`,
    `- Default Model: ${normalizeText(input.model) || "Provider default"}`,
    `- Reasoning Effort: ${normalizeText(input.reasoningEffort) || "high"}`,
    `- Speed Preference: ${normalizeText(input.speedPreference) || "fast_1_5x"}`,
    `- Approval Scope: ${authority.approvalScope}`,
    "",
    "## Authority Rules",
    `- Create tasks: ${authority.canCreateTasks ? "yes" : "no"}.`,
    `- Assign tasks: ${authority.canAssignTasks ? "yes" : "no"}.`,
    `- Release, commit, or push: ${authority.canRelease || authority.canCommitPush ? "yes, within release scope after QA evidence" : "no; route to Ralph"}.`,
    `- Required handoff: ${authority.handoff}`,
    "",
    "## Collaboration Rules",
    "- Accept work that fits the role contract and current project.",
    "- Follow company/project operating policies before assigning, approving, releasing, or changing model lanes.",
    "- Create or update tasks only when the action is necessary to complete the assigned outcome.",
    "- Use task comments for clean operator-facing updates and final answers, not runtime logs or private process notes.",
    "- When finishing assigned work, post one polished Markdown final answer with useful structure and source links when relevant, then move the task to review.",
    "- Keep status changes separate from final answers; avoid noisy status comments like starting, queued, stdout, stderr, or JSON traces.",
    "- Do not silently complete work that has not been verified.",
  ]);

  const heartbeatMd = compactLines([
    "# HEARTBEAT.md - Operating Loop",
    "",
    "## On Every Wake",
    "1. Read active assignments, recent comments, and current blockers.",
    "2. Select the highest-leverage next action within the role.",
    "3. Execute the next action or create a precise handoff if another role is required.",
    "4. Record only useful operator-facing evidence, blockers, and final results.",
    "",
    "## Operator-Facing Comments",
    "- Comments should read like a concise professional answer to the task.",
    "- Use Markdown headings, bold labels, short bullets, and clickable links when they improve scanability.",
    "- Do not include command lines, raw stdout/stderr, JSON telemetry, token details, or internal execution mechanics in comments.",
    "- For research/news tasks, include the relevant links directly in the final comment.",
    "",
    "## Completion Standard",
    "- The task outcome is concrete and visible.",
    "- Acceptance criteria have been checked or the missing verification is named.",
    "- Follow-up work is captured as a task, comment, or escalation.",
  ]);

  const toolsMd = compactLines([
    "# TOOLS.md - Local Tooling Notes",
    "",
    `This file is reserved for ${input.name}'s role-specific commands, references, and credentials notes.`,
    "",
    "## Defaults",
    "- Inspect existing project context before acting.",
    "- Prefer project-local commands, tests, and documentation.",
    "- Treat this directory as your runtime identity workspace.",
    "- Use `./source` for HiveRunner source code when it is present.",
    "- Use the company `projects/` directory for scoped project artifacts.",
    "- Coordinate HiveRunner work through `mc-action` blocks and the task context you receive.",
    "- Do not use legacy external control-plane APIs, legacy bridge endpoints, or retired workspace paths for HiveRunner work.",
    "- Do not assume external access exists; report missing credentials explicitly.",
  ]);

  return {
    name: input.name,
    role: input.role,
    companyName: input.companyName,
    projectName: input.projectName,
    reportsTo: input.reportsTo,
    emoji,
    personality,
    mission,
    capabilities,
    operatingPrinciples,
    decisionRules,
    escalationRules,
    authority,
    avatar,
    voice,
    files: {
      identityMd,
      soulMd,
      agentsMd,
      heartbeatMd,
      toolsMd,
    },
  };
}

function isPlaceholderBootstrap(content: string): boolean {
  const lower = content.toLowerCase();
  return lower.includes("bootstrap") && (lower.includes("hello") || lower.includes("identity"));
}

export function writeAgentDossierFiles(input: {
  agentWorkspacePath: string;
  dossier: AgentDossier;
}) {
  const { agentWorkspacePath, dossier } = input;
  fs.mkdirSync(agentWorkspacePath, { recursive: true });
  fs.writeFileSync(path.join(agentWorkspacePath, "IDENTITY.md"), dossier.files.identityMd, "utf8");
  fs.writeFileSync(path.join(agentWorkspacePath, "SOUL.md"), dossier.files.soulMd, "utf8");
  fs.writeFileSync(path.join(agentWorkspacePath, "AGENTS.md"), dossier.files.agentsMd, "utf8");
  fs.writeFileSync(path.join(agentWorkspacePath, "HEARTBEAT.md"), dossier.files.heartbeatMd, "utf8");
  fs.writeFileSync(path.join(agentWorkspacePath, "TOOLS.md"), dossier.files.toolsMd, "utf8");

  const bootstrapPath = path.join(agentWorkspacePath, "BOOTSTRAP.md");
  if (fs.existsSync(bootstrapPath)) {
    const content = fs.readFileSync(bootstrapPath, "utf8");
    if (isPlaceholderBootstrap(content)) {
      fs.rmSync(bootstrapPath, { force: true });
    }
  }
}

export function evaluateAgentReadiness(input: {
  agentWorkspacePath: string;
  openclawAgentId?: string | null;
  requiresOpenClawAgentId?: boolean;
  voiceId?: string | null;
  avatar?: Partial<AgentAvatarIdentity> | null;
}): AgentReadinessReport {
  const missingFiles = FILE_NAMES.filter((fileName) => !fs.existsSync(path.join(input.agentWorkspacePath, fileName)));
  const missingFields: string[] = [];
  if (input.requiresOpenClawAgentId && !input.openclawAgentId?.trim()) missingFields.push("openclaw_agent_id");
  if (!input.voiceId?.trim()) missingFields.push("voice_id");
  if (!input.avatar?.styleId?.trim()) missingFields.push("avatar_style_id");
  if (!input.avatar?.vibe?.trim()) missingFields.push("avatar_vibe");

  return {
    ready: missingFiles.length === 0 && missingFields.length === 0,
    missingFiles,
    missingFields,
  };
}
