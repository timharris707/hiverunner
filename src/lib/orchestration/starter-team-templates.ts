export const STARTER_TEAM_WORK_TYPE_IDS = [
  "software-product",
  "general-execution",
  "research-strategy",
  "operations-support",
  "content-marketing",
  "blank-custom",
] as const;

export type StarterTeamWorkTypeId = (typeof STARTER_TEAM_WORK_TYPE_IDS)[number];
export type StarterTeamWorkType = StarterTeamWorkTypeId;

export type StarterTeamModelLane = "default" | "fast" | "mini" | "deep";
export type StarterTeamRuntimeProvider = "manual";

export type StarterTeamEditableField =
  | "selected"
  | "name"
  | "role"
  | "summary"
  | "mission"
  | "capabilities"
  | "reportsTo"
  | "modelLane";

export type StarterTeamLeadershipMode =
  | "preserve-ceo"
  | "rename-ceo-to-lead"
  | "blank-custom";

export type StarterTeamProviderKeyRequirement = {
  requiresProviderKeyBeforeSetup: false;
  requiredProviders: readonly [];
  defaultRuntimeProvider: StarterTeamRuntimeProvider;
  modelLane: StarterTeamModelLane;
  setupCopy: string;
};

export type StarterTeamKickoffGoal = {
  title: string;
  description: string;
  priority: "P1";
};

export type StarterTeamRoleIdentity = {
  sourceAgentName: string;
  avatarUrl: string;
  avatarStyleId: string;
  avatarGender: "female" | "male" | "androgynous";
  avatarAge?: number;
  avatarHairColor?: string;
  avatarHairLength?: string;
  avatarEyeColor?: string;
  avatarVibe: string;
  voiceId: string;
  personality: string;
};

export type StarterTeamRoleTemplate = {
  id: string;
  name: string;
  role: string;
  defaultSelected: boolean;
  optional: boolean;
  summary: string;
  mission: string;
  kickoffIntentCopy: string;
  capabilities: readonly string[];
  editableFields: readonly StarterTeamEditableField[];
  reportsTo: "ceo-or-lead" | "owner";
  defaultRuntimeProvider: StarterTeamRuntimeProvider;
  modelLane: StarterTeamModelLane;
  identity?: StarterTeamRoleIdentity;
};

export type StarterTeamRoleCard = StarterTeamRoleTemplate;

export type StarterTeamSelectedRoleCard = Omit<StarterTeamRoleTemplate, "capabilities" | "editableFields"> & {
  capabilities: string[];
  editableFields: StarterTeamEditableField[];
  selected: boolean;
  custom?: boolean;
  runtimeProvider: StarterTeamRuntimeProvider;
  model: string;
};

export type StarterTeamTemplate = {
  id: StarterTeamWorkType;
  workTypeId: StarterTeamWorkTypeId;
  label: string;
  summary: string;
  templateName: string;
  templateShortName: string;
  displayCopy: {
    label: string;
    headline: string;
    body: string;
    selectionHint: string;
  };
  kickoffIntentCopy: string;
  kickoffGoal: StarterTeamKickoffGoal;
  defaultSelectedRoleIds: readonly string[];
  optionalRoleIds: readonly string[];
  editableFields: readonly StarterTeamEditableField[];
  providerKeyRequirement: StarterTeamProviderKeyRequirement;
  leadershipRule: {
    mode: StarterTeamLeadershipMode;
    title: string;
    rule: string;
    preservesExistingCeoOrLead: boolean;
    replacementRoleId: string | null;
  };
  initialProject: {
    name: string | null;
    description: string | null;
  };
  recommendedGoalTitle: string;
  recommendedGoalDescription: string;
  roleCards: readonly StarterTeamRoleTemplate[];
};

export type StarterTeamSetupPayload = {
  workType: StarterTeamWorkTypeId;
  templateName: string;
  starterTeam: {
    workType: StarterTeamWorkTypeId;
    agents: StarterTeamSelectedRoleCard[];
  };
  kickoffGoal: StarterTeamKickoffGoal;
  /**
   * Legacy alias for older callers. New onboarding should use kickoffGoal.
   */
  kickoffTask: StarterTeamKickoffGoal;
  initialProject: {
    name: string | null;
    description: string | null;
  };
};

export const STARTER_TEAM_ROLE_EDITABLE_FIELDS = [
  "selected",
  "name",
  "role",
  "summary",
  "mission",
  "capabilities",
  "reportsTo",
  "modelLane",
] as const satisfies readonly StarterTeamEditableField[];

const NO_PROVIDER_KEY_REQUIRED: StarterTeamProviderKeyRequirement = {
  requiresProviderKeyBeforeSetup: false,
  requiredProviders: [],
  defaultRuntimeProvider: "manual",
  modelLane: "default",
  setupCopy:
    "Setup can finish without connecting runtime provider keys. Selected roles start with manual runtime assignment and can be connected later.",
};

const STARTER_AVATAR_BASE = "/starter-agent-avatars";

type StarterAgentIdentityKey =
  | "castor"
  | "clarity"
  | "corey"
  | "denise"
  | "flash"
  | "frank"
  | "gator"
  | "mannie"
  | "meridian"
  | "oracle"
  | "penny"
  | "prism"
  | "ralph"
  | "samantha"
  | "scout"
  | "swift"
  | "toby"
  | "vega";

const STARTER_AGENT_IDENTITIES = {
  castor: {
    sourceAgentName: "Castor",
    avatarUrl: `${STARTER_AVATAR_BASE}/castor.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "male",
    avatarAge: 26,
    avatarHairColor: "Black",
    avatarHairLength: "Short",
    avatarEyeColor: "Brown",
    avatarVibe: "Precise, calm, and careful with claims.",
    voiceId: "Enceladus",
    personality: "Careful, compliance-minded, and direct about unsupported claims.",
  },
  clarity: {
    sourceAgentName: "Clarity",
    avatarUrl: `${STARTER_AVATAR_BASE}/clarity.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "female",
    avatarAge: 29,
    avatarHairColor: "Blonde",
    avatarHairLength: "Long",
    avatarEyeColor: "Brown",
    avatarVibe: "Confident reviewer with a steady editorial presence.",
    voiceId: "Sulafat",
    personality: "Warm, steady, and excellent at turning fuzzy process into clear review criteria.",
  },
  corey: {
    sourceAgentName: "Corey",
    avatarUrl: `${STARTER_AVATAR_BASE}/corey.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "male",
    avatarAge: 31,
    avatarHairColor: "Black",
    avatarHairLength: "Short",
    avatarEyeColor: "Brown",
    avatarVibe: "Focused builder with practical engineering judgment.",
    voiceId: "Alnilam",
    personality: "Grounded, implementation-focused, and biased toward small verified changes.",
  },
  denise: {
    sourceAgentName: "Denise",
    avatarUrl: `${STARTER_AVATAR_BASE}/denise.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "female",
    avatarAge: 32,
    avatarHairColor: "Dark Brown",
    avatarHairLength: "Shoulder-length",
    avatarEyeColor: "Green",
    avatarVibe: "Polished integration specialist with calm boundary discipline.",
    voiceId: "Callirrhoe",
    personality: "Easy-going, practical, and careful around service boundaries and failure modes.",
  },
  flash: {
    sourceAgentName: "Flash",
    avatarUrl: `${STARTER_AVATAR_BASE}/flash.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "male",
    avatarAge: 23,
    avatarHairColor: "Red",
    avatarHairLength: "Short",
    avatarEyeColor: "Brown",
    avatarVibe: "Fast-moving scout with visible urgency and focus.",
    voiceId: "Achird",
    personality: "Friendly, quick, and useful for broad scans that should not become deep research.",
  },
  frank: {
    sourceAgentName: "Frank",
    avatarUrl: `${STARTER_AVATAR_BASE}/frank.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "male",
    avatarAge: 46,
    avatarHairColor: "Brown",
    avatarHairLength: "Short",
    avatarEyeColor: "Brown",
    avatarVibe: "Measured analyst with sober judgment.",
    voiceId: "Algieba",
    personality: "Smooth, even, and reliable when numbers, assumptions, or tradeoffs need review.",
  },
  gator: {
    sourceAgentName: "Gator",
    avatarUrl: `${STARTER_AVATAR_BASE}/gator.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "male",
    avatarAge: 38,
    avatarHairColor: "Black",
    avatarHairLength: "Short",
    avatarEyeColor: "Brown",
    avatarVibe: "Demanding quality lead with a strong release gate presence.",
    voiceId: "Umbriel",
    personality: "Laid-back in tone, but strict about evidence, acceptance criteria, and regressions.",
  },
  mannie: {
    sourceAgentName: "Mannie",
    avatarUrl: `${STARTER_AVATAR_BASE}/mannie.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "male",
    avatarAge: 34,
    avatarHairColor: "Black",
    avatarHairLength: "Short",
    avatarEyeColor: "Brown",
    avatarVibe: "Organized back-end operator with steady delivery energy.",
    voiceId: "Zubenelgenubi",
    personality: "Casual, practical, and useful for coordinating operational and back-end details.",
  },
  meridian: {
    sourceAgentName: "Meridian",
    avatarUrl: `${STARTER_AVATAR_BASE}/meridian.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "female",
    avatarAge: 35,
    avatarHairColor: "Black",
    avatarHairLength: "Shoulder-length",
    avatarEyeColor: "Brown",
    avatarVibe: "Strategic architect with calm synthesis and depth.",
    voiceId: "Despina",
    personality: "Smooth, thoughtful, and strong at turning research into architecture-level decisions.",
  },
  oracle: {
    sourceAgentName: "Oracle",
    avatarUrl: `${STARTER_AVATAR_BASE}/oracle.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "male",
    avatarAge: 48,
    avatarHairColor: "Bald",
    avatarHairLength: "Short",
    avatarEyeColor: "Brown",
    avatarVibe: "Confident lead operator with crisp product judgment.",
    voiceId: "Algenib",
    personality: "Direct, strategic, and strong at decomposing goals into accountable work.",
  },
  penny: {
    sourceAgentName: "Penny",
    avatarUrl: `${STARTER_AVATAR_BASE}/penny.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "female",
    avatarAge: 27,
    avatarHairColor: "Auburn",
    avatarHairLength: "Long",
    avatarEyeColor: "Brown",
    avatarVibe: "Soft-spoken triage partner with practical support instincts.",
    voiceId: "Achernar",
    personality: "Gentle, considered, and useful for support triage and customer-facing wording.",
  },
  prism: {
    sourceAgentName: "Prism",
    avatarUrl: `${STARTER_AVATAR_BASE}/prism.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "female",
    avatarAge: 30,
    avatarHairColor: "Purple",
    avatarHairLength: "Medium",
    avatarEyeColor: "Brown",
    avatarVibe: "Vibrant editor with strong structure and clarity instincts.",
    voiceId: "Leda",
    personality: "Bright, a little eager, and strong at making copy clear without sanding away personality.",
  },
  ralph: {
    sourceAgentName: "Ralph",
    avatarUrl: `${STARTER_AVATAR_BASE}/ralph.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "male",
    avatarAge: 33,
    avatarHairColor: "Brown",
    avatarHairLength: "Short",
    avatarEyeColor: "Brown",
    avatarVibe: "Cheerful release steward with practical repo discipline.",
    voiceId: "Rasalgethi",
    personality: "Briefing-room precise, but approachable about scope, release notes, and validation.",
  },
  samantha: {
    sourceAgentName: "Samantha",
    avatarUrl: `${STARTER_AVATAR_BASE}/samantha.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "female",
    avatarAge: 29,
    avatarHairColor: "Black",
    avatarHairLength: "Very long",
    avatarEyeColor: "Brown",
    avatarVibe: "Composed front-end builder with polished product instincts.",
    voiceId: "Zephyr",
    personality: "Crisp, energetic, and strong at turning product direction into UI implementation.",
  },
  scout: {
    sourceAgentName: "Scout",
    avatarUrl: `${STARTER_AVATAR_BASE}/scout.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "male",
    avatarAge: 25,
    avatarHairColor: "Brown",
    avatarHairLength: "Medium",
    avatarEyeColor: "Blue",
    avatarVibe: "Studious researcher with a sharp, curious edge.",
    voiceId: "Iapetus",
    personality: "Documentary-clear, source-oriented, and careful about uncertainty.",
  },
  swift: {
    sourceAgentName: "Swift",
    avatarUrl: `${STARTER_AVATAR_BASE}/swift.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "female",
    avatarAge: 26,
    avatarHairColor: "Brown",
    avatarHairLength: "Short",
    avatarEyeColor: "Blue",
    avatarVibe: "Fast execution partner with crisp follow-through.",
    voiceId: "Laomedeia",
    personality: "Warm, engaged, and useful for turning repeated work into visible progress.",
  },
  toby: {
    sourceAgentName: "Toby",
    avatarUrl: `${STARTER_AVATAR_BASE}/toby.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "male",
    avatarAge: 34,
    avatarHairColor: "Black",
    avatarHairLength: "Short",
    avatarEyeColor: "Brown",
    avatarVibe: "Friendly product analyst with strong UX instincts.",
    voiceId: "Sadaltager",
    personality: "Practical, candid, and good at translating vague user needs into acceptance criteria.",
  },
  vega: {
    sourceAgentName: "Vega",
    avatarUrl: `${STARTER_AVATAR_BASE}/vega.webp`,
    avatarStyleId: "anime-studio",
    avatarGender: "female",
    avatarAge: 28,
    avatarHairColor: "Red",
    avatarHairLength: "Long",
    avatarEyeColor: "Red",
    avatarVibe: "Fiery visual systems lead with ambitious taste.",
    voiceId: "Aoede",
    personality: "Tasteful, exacting, visually ambitious, and allergic to generic product surfaces.",
  },
} as const satisfies Record<StarterAgentIdentityKey, StarterTeamRoleIdentity>;

function starterIdentity(key: StarterAgentIdentityKey): StarterTeamRoleIdentity {
  return STARTER_AGENT_IDENTITIES[key];
}

export const STARTER_TEAM_TEMPLATES = [
  {
    id: "software-product",
    workTypeId: "software-product",
    label: "Software/Product",
    summary: "A compact team for product planning, implementation, review, and release quality.",
    templateName: "Software/Product Studio",
    templateShortName: "Software Studio",
    displayCopy: {
      label: "Software/Product",
      headline: "Plan, build, review, and ship product work.",
      body: "Start with a compact product delivery team for implementation, product judgment, and release quality.",
      selectionHint: "Best when the first workspace will own software, product, or technical delivery.",
    },
    kickoffIntentCopy:
      "Use this team to turn the workspace mission into scoped product work, implementation tasks, review loops, and release-ready handoffs.",
    kickoffGoal: {
      title: "Ship the first product milestone",
      description:
        "Define the user outcome, implementation path, validation plan, and review checklist for the first product milestone.",
      priority: "P1",
    },
    recommendedGoalTitle: "Ship the first product milestone",
    recommendedGoalDescription:
      "Define the user outcome, implementation path, validation plan, and review checklist for the first product milestone.",
    defaultSelectedRoleIds: [
      "software-implementation-engineer",
      "software-product-ux-analyst",
      "software-qa-reviewer",
      "software-research-analyst",
      "software-creative-director",
    ],
    optionalRoleIds: ["software-release-coordinator", "software-integrations-engineer", "software-frontend-engineer"],
    editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
    providerKeyRequirement: NO_PROVIDER_KEY_REQUIRED,
    leadershipRule: {
      mode: "preserve-ceo",
      title: "Preserve CEO/lead",
      rule: "Keep the existing CEO or lead as the accountable owner. Starter roles report to that lead unless the operator edits reporting.",
      preservesExistingCeoOrLead: true,
      replacementRoleId: null,
    },
    initialProject: {
      name: "Product Studio",
      description: "First project for product planning, implementation, review, and release coordination.",
    },
    roleCards: [
      {
        id: "software-implementation-engineer",
        name: "Corey",
        role: "Implementation Engineer",
        defaultSelected: true,
        optional: false,
        summary: "Builds scoped product changes and keeps code changes focused.",
        mission: "Implement the first product tasks with clear ownership, tests, and practical handoff notes.",
        kickoffIntentCopy: "Own implementation tasks that move the first product project from plan to working code.",
        capabilities: ["Implement scoped features", "Fix focused bugs", "Add targeted tests", "Prepare engineering handoffs"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("corey"),
      },
      {
        id: "software-product-ux-analyst",
        name: "Toby",
        role: "Product and UX Analyst",
        defaultSelected: true,
        optional: false,
        summary: "Clarifies user flows, acceptance criteria, and product tradeoffs.",
        mission: "Convert broad direction into usable flows, crisp acceptance criteria, and reviewable product decisions.",
        kickoffIntentCopy: "Shape the first project into clear user outcomes and product acceptance criteria.",
        capabilities: ["Draft acceptance criteria", "Review UX flows", "Identify product risks", "Write concise handoff notes"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("toby"),
      },
      {
        id: "software-qa-reviewer",
        name: "Gator",
        role: "QA Reviewer",
        defaultSelected: true,
        optional: false,
        summary: "Verifies behavior against the agreed acceptance path.",
        mission: "Run focused validation, record evidence, and surface release-blocking issues clearly.",
        kickoffIntentCopy: "Validate the first product changes against the operator-visible acceptance path.",
        capabilities: ["Run focused tests", "Check acceptance criteria", "Document blockers", "Verify regression risk"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("gator"),
      },
      {
        id: "software-release-coordinator",
        name: "Ralph",
        role: "Release Coordinator",
        defaultSelected: false,
        optional: true,
        summary: "Keeps scope, validation, rollback, and final handoff aligned.",
        mission: "Coordinate final readiness, confirm validation evidence, and prepare a practical release handoff.",
        kickoffIntentCopy: "Track final readiness for the first product project and keep release notes grounded in evidence.",
        capabilities: ["Check scope boundaries", "Collect validation evidence", "Prepare release notes", "Confirm rollback notes"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("ralph"),
      },
      {
        id: "software-research-analyst",
        name: "Scout",
        role: "Research Analyst",
        defaultSelected: true,
        optional: false,
        summary: "Answers focused technical or market questions before build work starts.",
        mission: "Gather source-backed context and summarize practical tradeoffs for the product team.",
        kickoffIntentCopy: "Research open questions that could change the first project scope or sequencing.",
        capabilities: ["Research current options", "Compare tradeoffs", "Summarize references", "Flag uncertain assumptions"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("scout"),
      },
      {
        id: "software-integrations-engineer",
        name: "Denise",
        role: "Integrations Engineer",
        defaultSelected: false,
        optional: true,
        summary: "Handles API, service, and data integration details.",
        mission: "Own integration tasks that need careful boundary, credential, and failure-mode handling.",
        kickoffIntentCopy: "Support the first project where external services, APIs, or data contracts are involved.",
        capabilities: ["Map integration contracts", "Implement API wiring", "Review failure modes", "Document setup needs"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("denise"),
      },
      {
        id: "software-creative-director",
        name: "Vega",
        role: "Brand and Visual Systems Director",
        defaultSelected: true,
        optional: false,
        summary: "Protects the product's visual quality, voice, and presentation.",
        mission: "Make product surfaces, launch copy, and visual direction feel polished, specific, and intentional.",
        kickoffIntentCopy: "Shape the first product milestone so its UX, copy, and visual presentation feel first-class.",
        capabilities: ["Review visual quality", "Draft creative direction", "Tighten product copy", "Protect design consistency"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "deep",
        identity: starterIdentity("vega"),
      },
      {
        id: "software-frontend-engineer",
        name: "Samantha",
        role: "Front End Engineer",
        defaultSelected: false,
        optional: true,
        summary: "Turns approved product direction into polished interface changes.",
        mission: "Build responsive UI changes with clear states, careful layout, and practical handoff notes.",
        kickoffIntentCopy: "Support the first product project where interface implementation is needed.",
        capabilities: ["Implement UI changes", "Check responsive behavior", "Refine interaction states", "Document front-end handoffs"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("samantha"),
      },
    ],
  },
  {
    id: "general-execution",
    workTypeId: "general-execution",
    label: "General Execution",
    summary: "A small operator team with one lead plus a builder and reviewer.",
    templateName: "Solo Operator Copilot",
    templateShortName: "Solo Copilot",
    displayCopy: {
      label: "General Execution",
      headline: "Keep the team small while still covering build and review.",
      body: "Use a light setup for an accountable lead, one practical builder, and one reviewer.",
      selectionHint: "Best when you want a compact team instead of the full studio.",
    },
    kickoffIntentCopy:
      "Use this setup to preserve one accountable lead, create a practical first plan, and move work through small visible tasks with a builder and reviewer.",
    kickoffGoal: {
      title: "Complete the first execution outcome",
      description:
        "Turn the company mission into a focused outcome with immediate priorities, next actions, and the first review checkpoint.",
      priority: "P1",
    },
    recommendedGoalTitle: "Complete the first execution outcome",
    recommendedGoalDescription:
      "Turn the company mission into a focused outcome with immediate priorities, next actions, and the first review checkpoint.",
    defaultSelectedRoleIds: ["solo-builder", "solo-reviewer"],
    optionalRoleIds: ["solo-operator-copilot"],
    editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
    providerKeyRequirement: NO_PROVIDER_KEY_REQUIRED,
    leadershipRule: {
      mode: "rename-ceo-to-lead",
      title: "Single-lead setup",
      rule: "Keep the existing CEO or lead as the accountable operator. Add only a compact builder and reviewer unless the operator edits the team.",
      preservesExistingCeoOrLead: true,
      replacementRoleId: null,
    },
    initialProject: {
      name: "Operations",
      description: "Default project for the operator's first plan, active tasks, and follow-through.",
    },
    roleCards: [
      {
        id: "solo-operator-copilot",
        name: "Oracle",
        role: "Operator Copilot",
        defaultSelected: false,
        optional: true,
        summary: "Adds a lightweight execution partner when the operator wants one extra role.",
        mission: "Help the lead break down work, maintain the task list, and prepare concise progress updates.",
        kickoffIntentCopy: "Support the lead with task organization, follow-up, and operator-facing summaries.",
        capabilities: ["Break down ambiguous work", "Track next actions", "Draft concise updates", "Flag stale tasks"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("oracle"),
      },
      {
        id: "solo-builder",
        name: "Corey",
        role: "Builder",
        defaultSelected: true,
        optional: false,
        summary: "Turns the lead's plan into practical implementation work.",
        mission: "Take scoped tasks from the lead and produce working, reviewable outputs.",
        kickoffIntentCopy: "Build the first small execution item from the launch plan.",
        capabilities: ["Implement scoped work", "Keep changes small", "Report blockers", "Prepare handoffs"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("corey"),
      },
      {
        id: "solo-reviewer",
        name: "Gator",
        role: "Reviewer",
        defaultSelected: true,
        optional: false,
        summary: "Checks that completed work matches the requested outcome.",
        mission: "Review the first execution outputs for completeness, clarity, and practical evidence.",
        kickoffIntentCopy: "Review the first small execution item before the lead treats it as done.",
        capabilities: ["Review evidence", "Check acceptance criteria", "Flag gaps", "Confirm completion"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("gator"),
      },
    ],
  },
  {
    id: "research-strategy",
    workTypeId: "research-strategy",
    label: "Research/Strategy",
    summary: "A desk for source-backed research, synthesis, and decision-ready recommendations.",
    templateName: "Research & Strategy Desk",
    templateShortName: "Research Desk",
    displayCopy: {
      label: "Research/Strategy",
      headline: "Gather evidence and turn it into decisions.",
      body: "Start with a desk for source-backed research, synthesis, and strategic recommendations.",
      selectionHint: "Best when the first workspace needs discovery, options analysis, or planning.",
    },
    kickoffIntentCopy:
      "Use this desk to gather evidence, compare options, synthesize recommendations, and preserve decision context.",
    kickoffGoal: {
      title: "Answer the first strategic question",
      description:
        "Define the first research outcome, evidence needed, decision criteria, and recommendation format for the research desk.",
      priority: "P1",
    },
    defaultSelectedRoleIds: ["research-source-analyst", "research-strategy-synthesizer", "research-review-editor", "research-operator-briefing-lead"],
    optionalRoleIds: ["research-data-analyst"],
    editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
    providerKeyRequirement: NO_PROVIDER_KEY_REQUIRED,
    leadershipRule: {
      mode: "preserve-ceo",
      title: "Preserve CEO/lead",
      rule: "Keep the existing CEO or lead as the decision owner. Research roles provide evidence and recommendations; they do not replace the owner by default.",
      preservesExistingCeoOrLead: true,
      replacementRoleId: null,
    },
    initialProject: {
      name: "Research Desk",
      description: "First project for research questions, option comparison, synthesis, and decision records.",
    },
    recommendedGoalTitle: "Answer the first strategic question",
    recommendedGoalDescription:
      "Define the first research outcome, evidence needed, decision criteria, and recommendation format for the research desk.",
    roleCards: [
      {
        id: "research-source-analyst",
        name: "Scout",
        role: "Source Analyst",
        defaultSelected: true,
        optional: false,
        summary: "Finds and evaluates sources relevant to the first research question.",
        mission: "Gather current, useful references and separate evidence from assumptions.",
        kickoffIntentCopy: "Collect sources and factual context for the first strategic question.",
        capabilities: ["Find relevant sources", "Check recency", "Compare evidence quality", "Summarize citations"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("scout"),
      },
      {
        id: "research-strategy-synthesizer",
        name: "Meridian",
        role: "Strategy Synthesizer",
        defaultSelected: true,
        optional: false,
        summary: "Turns research into options, tradeoffs, and recommended next steps.",
        mission: "Synthesize findings into practical strategy, decision criteria, and next actions.",
        kickoffIntentCopy: "Convert research findings into a clear recommendation and action path.",
        capabilities: ["Synthesize tradeoffs", "Define decision criteria", "Map risks", "Recommend next steps"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "deep",
        identity: starterIdentity("meridian"),
      },
      {
        id: "research-review-editor",
        name: "Prism",
        role: "Review Editor",
        defaultSelected: true,
        optional: false,
        summary: "Checks clarity, neutrality, and completeness before findings are shared.",
        mission: "Refine research outputs so claims are clear, qualified, and operator-ready.",
        kickoffIntentCopy: "Review the first research brief for clear claims, useful structure, and public-safe wording.",
        capabilities: ["Edit research briefs", "Check claim wording", "Improve structure", "Prepare operator summaries"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("prism"),
      },
      {
        id: "research-data-analyst",
        name: "Frank",
        role: "Data Analyst",
        defaultSelected: false,
        optional: true,
        summary: "Reviews quantitative evidence and basic assumptions.",
        mission: "Check numeric evidence, summarize uncertainty, and identify data gaps.",
        kickoffIntentCopy: "Review any quantitative inputs that influence the first recommendation.",
        capabilities: ["Check calculations", "Summarize metrics", "Flag data gaps", "Document assumptions"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("frank"),
      },
      {
        id: "research-operator-briefing-lead",
        name: "Oracle",
        role: "Briefing Lead",
        defaultSelected: true,
        optional: false,
        summary: "Packages findings into a decision-ready operator brief.",
        mission: "Prepare concise briefings that make status, tradeoffs, and asks easy to review.",
        kickoffIntentCopy: "Package the first research outcome into a clean briefing for the operator.",
        capabilities: ["Write briefings", "Track open questions", "Summarize decisions", "Prepare follow-up tasks"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("oracle"),
      },
    ],
  },
  {
    id: "operations-support",
    workTypeId: "operations-support",
    label: "Operations/Support",
    summary: "A practical team for queues, support workflows, process notes, and quality checks.",
    templateName: "Operations/Support Team",
    templateShortName: "Ops Support",
    displayCopy: {
      label: "Operations/Support",
      headline: "Triage requests, document process, and keep work moving.",
      body: "Start with a practical operations team for queues, support workflows, process notes, and quality checks.",
      selectionHint: "Best when the first workspace needs repeatable support or internal operations.",
    },
    kickoffIntentCopy:
      "Use this team to organize incoming work, define support flows, document repeatable process, and check follow-through.",
    kickoffGoal: {
      title: "Stabilize the first operations queue",
      description:
        "Define the initial intake categories, triage rules, owners, escalation points, and completion checks for the operations/support team.",
      priority: "P1",
    },
    defaultSelectedRoleIds: ["ops-coordinator", "support-triage-specialist", "ops-process-analyst", "ops-quality-reviewer"],
    optionalRoleIds: ["ops-automation-planner", "ops-knowledge-base-editor"],
    editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
    providerKeyRequirement: NO_PROVIDER_KEY_REQUIRED,
    leadershipRule: {
      mode: "preserve-ceo",
      title: "Preserve CEO/lead",
      rule: "Keep the existing CEO or lead accountable for priorities and escalations. Operations roles coordinate execution under that lead.",
      preservesExistingCeoOrLead: true,
      replacementRoleId: null,
    },
    initialProject: {
      name: "Operations Desk",
      description: "First project for queues, support workflows, operating notes, and escalation tracking.",
    },
    recommendedGoalTitle: "Stabilize the first operations queue",
    recommendedGoalDescription:
      "Define the initial intake categories, triage rules, owners, escalation points, and completion checks for the operations/support team.",
    roleCards: [
      {
        id: "ops-coordinator",
        name: "Mannie",
        role: "Operations Coordinator",
        defaultSelected: true,
        optional: false,
        summary: "Coordinates active work, ownership, and follow-up.",
        mission: "Keep the first operations project organized with clear owners, priorities, and next steps.",
        kickoffIntentCopy: "Set up the first operations queue and keep work moving across roles.",
        capabilities: ["Organize queues", "Assign follow-ups", "Track status", "Prepare operating updates"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("mannie"),
      },
      {
        id: "support-triage-specialist",
        name: "Penny",
        role: "Support Triage Specialist",
        defaultSelected: true,
        optional: false,
        summary: "Classifies incoming requests and routes them to the right next action.",
        mission: "Turn new requests into clear priority, category, owner, and response-path decisions.",
        kickoffIntentCopy: "Define the first triage flow and classify initial support or operations requests.",
        capabilities: ["Classify requests", "Set priority", "Route follow-ups", "Draft concise responses"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "fast",
        identity: starterIdentity("penny"),
      },
      {
        id: "ops-process-analyst",
        name: "Clarity",
        role: "Process Analyst",
        defaultSelected: true,
        optional: false,
        summary: "Documents repeatable workflows and identifies handoff gaps.",
        mission: "Clarify the operating process so repeated work is consistent and easy to audit.",
        kickoffIntentCopy: "Document the first support or operations workflow and its decision points.",
        capabilities: ["Map workflows", "Find handoff gaps", "Draft process notes", "Define checklists"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("clarity"),
      },
      {
        id: "ops-quality-reviewer",
        name: "Gator",
        role: "Quality Reviewer",
        defaultSelected: true,
        optional: false,
        summary: "Checks that support and operations outcomes match expectations.",
        mission: "Review resolved work for completeness, accuracy, and clear next steps.",
        kickoffIntentCopy: "Verify the first operations workflow and support outputs against the acceptance checks.",
        capabilities: ["Review completed work", "Check response quality", "Flag missing steps", "Confirm closure criteria"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("gator"),
      },
      {
        id: "ops-automation-planner",
        name: "Swift",
        role: "Automation Planner",
        defaultSelected: false,
        optional: true,
        summary: "Identifies small automation opportunities after the workflow is understood.",
        mission: "Propose low-risk automation for repeated steps without expanding setup scope.",
        kickoffIntentCopy: "Look for simple automation opportunities in the first operations workflow.",
        capabilities: ["Spot repeated steps", "Draft automation plans", "Estimate effort", "Flag manual fallback needs"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("swift"),
      },
      {
        id: "ops-knowledge-base-editor",
        name: "Prism",
        role: "Knowledge Base Editor",
        defaultSelected: false,
        optional: true,
        summary: "Turns support answers and workflows into reusable internal notes.",
        mission: "Convert resolved support patterns into clear, reusable knowledge base entries.",
        kickoffIntentCopy: "Prepare reusable support notes from the first workflow and resolved requests.",
        capabilities: ["Write help notes", "Edit process docs", "Standardize response copy", "Maintain FAQ entries"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("prism"),
      },
    ],
  },
  {
    id: "content-marketing",
    workTypeId: "content-marketing",
    label: "Content/Marketing",
    summary: "A team for positioning, drafting, campaign coordination, and copy review.",
    templateName: "Content/Marketing Team",
    templateShortName: "Content Team",
    displayCopy: {
      label: "Content/Marketing",
      headline: "Plan, draft, review, and publish clear messaging.",
      body: "Start with a content team for positioning, drafting, campaign coordination, and copy review.",
      selectionHint: "Best when the first workspace will create public or operator-facing content.",
    },
    kickoffIntentCopy:
      "Use this team to clarify audience, draft useful content, review claims, and prepare a practical publishing plan.",
    kickoffGoal: {
      title: "Publish the first content plan",
      description:
        "Define the audience, message, first content pieces, review path, publishing steps, and basic measurement plan for the content team.",
      priority: "P1",
    },
    defaultSelectedRoleIds: ["content-creative-director", "content-writer-editor", "content-copy-reviewer", "content-researcher"],
    optionalRoleIds: ["content-strategist", "content-campaign-coordinator", "content-distribution-analyst"],
    editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
    providerKeyRequirement: NO_PROVIDER_KEY_REQUIRED,
    leadershipRule: {
      mode: "preserve-ceo",
      title: "Preserve CEO/lead",
      rule: "Keep the existing CEO or lead as the final owner for messaging direction and approvals. Content roles draft and review under that owner.",
      preservesExistingCeoOrLead: true,
      replacementRoleId: null,
    },
    initialProject: {
      name: "Content Studio",
      description: "First project for positioning, drafts, review, campaign coordination, and publishing handoff.",
    },
    recommendedGoalTitle: "Publish the first content plan",
    recommendedGoalDescription:
      "Define the audience, message, first content pieces, review path, publishing steps, and basic measurement plan for the content team.",
    roleCards: [
      {
        id: "content-creative-director",
        name: "Vega",
        role: "Creative Director",
        defaultSelected: true,
        optional: false,
        summary: "Shapes the visual and creative direction for public-facing work.",
        mission: "Turn the workspace mission into a distinctive creative direction with clear taste, visual standards, and review criteria.",
        kickoffIntentCopy: "Define the first creative direction and visual quality bar for the content plan.",
        capabilities: ["Set creative direction", "Define visual standards", "Review brand fit", "Sharpen presentation"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "deep",
        identity: starterIdentity("vega"),
      },
      {
        id: "content-strategist",
        name: "Oracle",
        role: "Content Strategist",
        defaultSelected: false,
        optional: true,
        summary: "Defines audience, message, and content priorities.",
        mission: "Turn the workspace mission into clear positioning, content themes, and first campaign priorities.",
        kickoffIntentCopy: "Define the first content plan, target audience, and message priorities.",
        capabilities: ["Define positioning", "Prioritize content themes", "Plan campaign structure", "Clarify audience needs"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("oracle"),
      },
      {
        id: "content-writer-editor",
        name: "Prism",
        role: "Writer and Editor",
        defaultSelected: true,
        optional: false,
        summary: "Drafts and edits clear, neutral, useful copy.",
        mission: "Create concise drafts and refine them for clarity, tone, and public-safe claims.",
        kickoffIntentCopy: "Draft the first content pieces and refine them for clear operator-ready review.",
        capabilities: ["Draft content", "Edit copy", "Improve structure", "Check tone"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("prism"),
      },
      {
        id: "content-campaign-coordinator",
        name: "Samantha",
        role: "Campaign Coordinator",
        defaultSelected: false,
        optional: true,
        summary: "Coordinates content tasks, publishing steps, and campaign handoffs.",
        mission: "Keep campaign work organized across drafts, reviews, publishing steps, and follow-up tasks.",
        kickoffIntentCopy: "Create the first campaign task list and keep drafting, review, and publishing steps aligned.",
        capabilities: ["Organize campaign tasks", "Track publishing steps", "Coordinate handoffs", "Prepare status updates"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("samantha"),
      },
      {
        id: "content-copy-reviewer",
        name: "Castor",
        role: "Copy Review Specialist",
        defaultSelected: true,
        optional: false,
        summary: "Checks copy for clarity, unsupported claims, and approval readiness.",
        mission: "Review content for neutral language, claim discipline, and clear approval notes.",
        kickoffIntentCopy: "Review the first content drafts for clear claims, neutral wording, and approval readiness.",
        capabilities: ["Review claims", "Flag unclear wording", "Check approval notes", "Suggest safer alternatives"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("castor"),
      },
      {
        id: "content-researcher",
        name: "Scout",
        role: "Content Researcher",
        defaultSelected: true,
        optional: false,
        summary: "Finds audience, topic, and reference context for better content.",
        mission: "Gather useful context before drafting so content is accurate and grounded.",
        kickoffIntentCopy: "Research the first content topic and prepare source notes for drafting.",
        capabilities: ["Research topic context", "Find useful references", "Summarize audience questions", "Flag claim gaps"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "default",
        identity: starterIdentity("scout"),
      },
      {
        id: "content-distribution-analyst",
        name: "Flash",
        role: "Distribution Analyst",
        defaultSelected: false,
        optional: true,
        summary: "Suggests practical distribution and measurement options.",
        mission: "Map where content should go, what to measure, and what follow-up is useful.",
        kickoffIntentCopy: "Recommend distribution steps and basic measurement for the first content plan.",
        capabilities: ["Map distribution options", "Define simple metrics", "Compare channels", "Prepare follow-up tasks"],
        editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
        reportsTo: "ceo-or-lead",
        defaultRuntimeProvider: "manual",
        modelLane: "fast",
        identity: starterIdentity("flash"),
      },
    ],
  },
  {
    id: "blank-custom",
    workTypeId: "blank-custom",
    label: "Blank/custom",
    summary: "No recommended teammates; define custom roles later.",
    templateName: "Blank/custom",
    templateShortName: "Blank",
    displayCopy: {
      label: "Blank/custom",
      headline: "Start empty and define your own team.",
      body: "Skip recommendations and create only the company owner, lead, project, and first goal.",
      selectionHint: "Best when you already know the exact roles you want or want no starter roles.",
    },
    kickoffIntentCopy:
      "Use this setup when the operator wants to define custom roles later. Create no recommended teammates by default.",
    kickoffGoal: {
      title: "Define the first workspace outcome",
      description:
        "Clarify the first outcome, who owns it, what decisions are needed, and what should be reviewed before creating custom roles.",
      priority: "P1",
    },
    defaultSelectedRoleIds: [],
    optionalRoleIds: [],
    editableFields: STARTER_TEAM_ROLE_EDITABLE_FIELDS,
    providerKeyRequirement: NO_PROVIDER_KEY_REQUIRED,
    leadershipRule: {
      mode: "blank-custom",
      title: "Preserve current leadership",
      rule: "Do not replace the CEO or lead and do not add starter role cards during setup.",
      preservesExistingCeoOrLead: true,
      replacementRoleId: null,
    },
    initialProject: {
      name: null,
      description: null,
    },
    recommendedGoalTitle: "Define the first workspace outcome",
    recommendedGoalDescription:
      "Clarify the first outcome, who owns it, what decisions are needed, and what should be reviewed before creating custom roles.",
    roleCards: [],
  },
] as const satisfies readonly StarterTeamTemplate[];

export function isStarterTeamWorkTypeId(value: string): value is StarterTeamWorkTypeId {
  return (STARTER_TEAM_WORK_TYPE_IDS as readonly string[]).includes(value);
}

export function getStarterTeamTemplate(workTypeId: StarterTeamWorkTypeId): StarterTeamTemplate {
  const template = STARTER_TEAM_TEMPLATES.find((item) => item.workTypeId === workTypeId);
  if (!template) {
    throw new Error(`Unknown starter team work type: ${workTypeId}`);
  }
  return template;
}

export function getDefaultStarterTeamRoleCards(workTypeId: StarterTeamWorkTypeId): StarterTeamSelectedRoleCard[] {
  const template = getStarterTeamTemplate(workTypeId);
  const selected = new Set(template.defaultSelectedRoleIds);
  return cloneStarterTeamRoles(workTypeId).filter((role) => selected.has(role.id));
}

export function cloneStarterTeamRoles(workTypeId: StarterTeamWorkTypeId): StarterTeamSelectedRoleCard[] {
  const template = getStarterTeamTemplate(workTypeId);
  return template.roleCards.map((role): StarterTeamSelectedRoleCard => ({
    ...role,
    capabilities: [...role.capabilities],
    editableFields: [...role.editableFields],
    identity: role.identity ? { ...role.identity } : undefined,
    selected: role.defaultSelected,
    runtimeProvider: role.defaultRuntimeProvider,
    model: "",
  }));
}

export function buildStarterTeamSetupPayload(workTypeId: StarterTeamWorkTypeId): StarterTeamSetupPayload {
  const template = getStarterTeamTemplate(workTypeId);
  const kickoffGoal = {
    ...template.kickoffGoal,
  };
  return {
    workType: template.workTypeId,
    templateName: template.templateName,
    starterTeam: {
      workType: template.workTypeId,
      agents: cloneStarterTeamRoles(workTypeId),
    },
    kickoffGoal,
    kickoffTask: {
      ...kickoffGoal,
    },
    initialProject: {
      ...template.initialProject,
    },
  };
}

export type SelectedStarterTeamAgent = {
  name: string;
  role: string;
  mission: string | null;
  capabilities: string[];
  personality?: string | null;
  avatarUrl?: string | null;
  avatarStyleId?: string | null;
  avatarGender?: string | null;
  avatarAge?: number | null;
  avatarHairColor?: string | null;
  avatarHairLength?: string | null;
  avatarEyeColor?: string | null;
  avatarVibe?: string | null;
  voiceId?: string | null;
};

function readStarterString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStarterCapabilities(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, 8);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 8);
  }
  return [];
}

export function readSelectedStarterAgents(
  starterTeam: unknown,
  options: { ceoName?: string } = {},
): SelectedStarterTeamAgent[] {
  if (typeof starterTeam !== "object" || starterTeam === null) return [];
  const record = starterTeam as Record<string, unknown>;
  const workType = readStarterString(record.workType);
  if (workType && !isStarterTeamWorkTypeId(workType)) {
    throw new Error(`Unknown starter team work type: ${workType}`);
  }
  const workTypeId = workType && isStarterTeamWorkTypeId(workType) ? workType : null;
  if (workTypeId === "blank-custom") {
    return [];
  }
  const template = workTypeId ? getStarterTeamTemplate(workTypeId) : null;
  const roleIdentityById = new Map(
    template?.roleCards.map((role) => [role.id, role.identity ? { ...role.identity } : null]) ?? [],
  );
  const agents = record.agents;
  if (!Array.isArray(agents)) return [];

  const ceoName = options.ceoName?.trim().toLowerCase() || null;
  const seenNames = new Set<string>();
  return agents
    .filter((agent): agent is Record<string, unknown> => typeof agent === "object" && agent !== null)
    .filter((agent) => agent.selected !== false)
    .map((agent) => {
      const id = readStarterString(agent.id);
      const identity = id ? roleIdentityById.get(id) ?? null : null;
      return {
        name: readStarterString(agent.name) ?? "",
        role: readStarterString(agent.role) ?? "",
        mission: readStarterString(agent.mission),
        capabilities: readStarterCapabilities(agent.capabilities),
        personality: identity?.personality ?? null,
        avatarUrl: identity?.avatarUrl ?? null,
        avatarStyleId: identity?.avatarStyleId ?? null,
        avatarGender: identity?.avatarGender ?? null,
        avatarAge: identity?.avatarAge ?? null,
        avatarHairColor: identity?.avatarHairColor ?? null,
        avatarHairLength: identity?.avatarHairLength ?? null,
        avatarEyeColor: identity?.avatarEyeColor ?? null,
        avatarVibe: identity?.avatarVibe ?? null,
        voiceId: identity?.voiceId ?? null,
      };
    })
    .filter((agent) => agent.name && agent.role)
    .filter((agent) => {
      const normalizedName = agent.name.toLowerCase();
      if (ceoName && normalizedName === ceoName) return false;
      if (seenNames.has(normalizedName)) return false;
      seenNames.add(normalizedName);
      return true;
    })
    .slice(0, 12);
}
