export const BUILT_IN_STARTER_SPRINT_TEMPLATE_IDS = [
  "build-something",
  "pr-review",
  "bug-triage",
  "release-readiness",
  "repo-cleanup",
  "local-app-smoke-test",
  "competitor-research",
] as const;

export type BuiltInStarterSprintTemplateId = (typeof BUILT_IN_STARTER_SPRINT_TEMPLATE_IDS)[number];

export type StarterSprintIntakeQuestionType = "single_select" | "multi_select" | "short_text" | "long_text";

export type StarterSprintIntakeOption = {
  value: string;
  label: string;
  description?: string;
};

export type StarterSprintIntakeQuestion = {
  id: string;
  label: string;
  helpText: string;
  type: StarterSprintIntakeQuestionType;
  required: boolean;
  options?: readonly StarterSprintIntakeOption[];
  defaultValue?: string | readonly string[];
};

export type StarterSprintIntakeSchema = {
  version: 1;
  questions: readonly StarterSprintIntakeQuestion[];
  answerSchema: {
    type: "object";
    required: readonly string[];
    properties: Record<
      string,
      {
        type: "string" | "array";
        enum?: readonly string[];
        items?: { type: "string"; enum?: readonly string[] };
        minItems?: number;
      }
    >;
  };
};

export type StarterSprintCapabilitySlot = {
  id: string;
  label: string;
  description: string;
  suggestedRole: string;
};

export type StarterSprintCapabilitySlots = {
  required: readonly StarterSprintCapabilitySlot[];
  useful: readonly StarterSprintCapabilitySlot[];
  later: readonly StarterSprintCapabilitySlot[];
};

export type StarterSprintDraftTask = {
  id: string;
  title: string;
  type: "feature" | "maintenance" | "research" | "validation";
  priority: "critical" | "high" | "medium";
  description: string;
  dependsOn?: readonly string[];
  suggestedCapabilitySlotIds: readonly string[];
};

export type StarterSprintDraftOutputs = {
  createsBoardTasksImmediately: false;
  goal: {
    title: string;
    objective: string;
  };
  sprint: {
    name: string;
    objective: string;
  };
  taskPlan: readonly StarterSprintDraftTask[];
  activeCrewRecommendation: {
    summary: string;
    requiredCapabilitySlotIds: readonly string[];
    usefulCapabilitySlotIds: readonly string[];
    laterCapabilitySlotIds: readonly string[];
  };
  reviewGate: {
    title: string;
    description: string;
  };
};

export type StarterSprintValidationCriteria = {
  checklist: readonly string[];
  evidence: readonly string[];
  blockedIf: readonly string[];
};

export type BuiltInStarterSprintTemplate = {
  id: BuiltInStarterSprintTemplateId;
  version: "1.0.0";
  templateVersionId: `${BuiltInStarterSprintTemplateId}@1.0.0`;
  source: "built-in";
  lifecycle: "published";
  immutable: true;
  name: string;
  shortName: string;
  summary: string;
  publicDescription: string;
  intake: StarterSprintIntakeSchema;
  capabilitySlots: StarterSprintCapabilitySlots;
  draftOutputs: StarterSprintDraftOutputs;
  validationCriteria: StarterSprintValidationCriteria;
};

function enumValues(options: readonly StarterSprintIntakeOption[]): readonly string[] {
  return options.map((option) => option.value);
}

function singleSelectQuestion(
  id: string,
  label: string,
  helpText: string,
  options: readonly StarterSprintIntakeOption[],
  defaultValue?: string,
): StarterSprintIntakeQuestion {
  return {
    id,
    label,
    helpText,
    type: "single_select",
    required: true,
    options,
    defaultValue: defaultValue ?? options[0]?.value,
  };
}

function shortTextQuestion(id: string, label: string, helpText: string, required = true): StarterSprintIntakeQuestion {
  return {
    id,
    label,
    helpText,
    type: "short_text",
    required,
  };
}

function longTextQuestion(id: string, label: string, helpText: string, required = true): StarterSprintIntakeQuestion {
  return {
    id,
    label,
    helpText,
    type: "long_text",
    required,
  };
}

function multiSelectQuestion(
  id: string,
  label: string,
  helpText: string,
  options: readonly StarterSprintIntakeOption[],
  defaultValue: readonly string[],
  required = true,
): StarterSprintIntakeQuestion {
  return {
    id,
    label,
    helpText,
    type: "multi_select",
    required,
    options,
    defaultValue,
  };
}

function intakeSchema(questions: readonly StarterSprintIntakeQuestion[]): StarterSprintIntakeSchema {
  return {
    version: 1,
    questions,
    answerSchema: {
      type: "object",
      required: questions.filter((question) => question.required).map((question) => question.id),
      properties: Object.fromEntries(
        questions.map((question) => {
          if (question.type === "multi_select") {
            return [
              question.id,
              {
                type: "array",
                items: {
                  type: "string",
                  enum: question.options ? enumValues(question.options) : undefined,
                },
                minItems: question.required ? 1 : undefined,
              },
            ];
          }

          return [
            question.id,
            {
              type: "string",
              enum: question.options ? enumValues(question.options) : undefined,
            },
          ];
        }),
      ),
    },
  };
}

const BUILD_TYPE_OPTIONS = [
  {
    value: "arcade-mini-game",
    label: "Arcade mini game",
    description: "A small playable loop with simple controls and visible win or completion state.",
  },
  {
    value: "first-person-prototype",
    label: "First-person prototype",
    description: "A compact movement or interaction prototype with a clear test path.",
  },
  {
    value: "block-building-toy",
    label: "Block-building toy",
    description: "A lightweight creation surface with a few clear build interactions.",
  },
  {
    value: "interactive-tool",
    label: "Interactive tool",
    description: "A useful single-purpose workflow with inputs, output, and reset behavior.",
  },
  {
    value: "dashboard-widget",
    label: "Dashboard or widget",
    description: "A compact information view with realistic states and reviewable data.",
  },
  {
    value: "product-feature",
    label: "Product feature",
    description: "A small feature inside an existing app or workflow.",
  },
] as const satisfies readonly StarterSprintIntakeOption[];

const AMBITION_OPTIONS = [
  { value: "tiny-proof", label: "Tiny proof", description: "One short path that proves the idea works." },
  { value: "single-screen", label: "Single screen", description: "A cohesive first screen with core behavior." },
  { value: "polished-slice", label: "Polished slice", description: "A small complete slice with stronger fit and finish." },
] as const satisfies readonly StarterSprintIntakeOption[];

const REVIEW_FOCUS_OPTIONS = [
  { value: "correctness", label: "Correctness", description: "Behavior, edge cases, and regression risk." },
  { value: "maintainability", label: "Maintainability", description: "Code clarity, boundaries, and future changes." },
  { value: "product-fit", label: "Product fit", description: "User impact, acceptance path, and copy quality." },
  { value: "release-risk", label: "Release readiness", description: "Checks, rollout notes, and rollback readiness." },
] as const satisfies readonly StarterSprintIntakeOption[];

const URGENCY_OPTIONS = [
  { value: "now-blocking", label: "Blocking active work", description: "The issue prevents current work from moving." },
  { value: "soon", label: "Needs attention soon", description: "The issue affects reliability or user trust." },
  { value: "normal", label: "Normal triage", description: "The issue needs clear ownership and next action." },
] as const satisfies readonly StarterSprintIntakeOption[];

const RELEASE_SCOPE_OPTIONS = [
  { value: "patch", label: "Patch", description: "Focused fix or small improvement." },
  { value: "minor", label: "Minor release", description: "Multiple related changes with a defined acceptance path." },
  { value: "major", label: "Major release", description: "Broad release that needs explicit rollout planning." },
] as const satisfies readonly StarterSprintIntakeOption[];

const CLEANUP_SCOPE_OPTIONS = [
  { value: "dead-code", label: "Dead code", description: "Remove unused files, exports, or paths after impact checks." },
  { value: "duplication", label: "Duplication", description: "Consolidate repeated logic where a shared helper fits." },
  { value: "structure", label: "Structure", description: "Clarify boundaries, file placement, or local naming." },
  { value: "dependency", label: "Dependency hygiene", description: "Tighten package, import, or module relationships." },
] as const satisfies readonly StarterSprintIntakeOption[];

const SMOKE_SURFACE_OPTIONS = [
  { value: "first-run", label: "First-run path", description: "Launch, onboarding, or initial empty-state workflow." },
  { value: "core-workflow", label: "Core workflow", description: "The main path an operator or user repeats." },
  { value: "recent-change", label: "Recent change", description: "A focused path affected by the latest work." },
  { value: "mobile-desktop", label: "Responsive pass", description: "A path checked across mobile and desktop viewports." },
] as const satisfies readonly StarterSprintIntakeOption[];

const RESEARCH_DECISION_OPTIONS = [
  { value: "positioning", label: "Positioning", description: "Understand claims, gaps, and user-facing language." },
  { value: "product-scope", label: "Product scope", description: "Compare features, workflows, and practical gaps." },
  { value: "pricing-packaging", label: "Pricing or packaging", description: "Summarize visible offers and packaging patterns." },
  { value: "go-to-market", label: "Go-to-market", description: "Compare channels, customer segments, and proof points." },
] as const satisfies readonly StarterSprintIntakeOption[];

function task(
  id: string,
  title: string,
  type: StarterSprintDraftTask["type"],
  priority: StarterSprintDraftTask["priority"],
  description: string,
  suggestedCapabilitySlotIds: readonly string[],
  dependsOn?: readonly string[],
): StarterSprintDraftTask {
  return {
    id,
    title,
    type,
    priority,
    description,
    suggestedCapabilitySlotIds,
    ...(dependsOn ? { dependsOn } : {}),
  };
}

export const BUILT_IN_STARTER_SPRINT_TEMPLATES = [
  {
    id: "build-something",
    version: "1.0.0",
    templateVersionId: "build-something@1.0.0",
    source: "built-in",
    lifecycle: "published",
    immutable: true,
    name: "Build Something",
    shortName: "Build",
    summary: "Turn a constrained creative brief into a small reviewable build sprint.",
    publicDescription:
      "Start with a focused build type, answer a few scoping questions, and review a draft plan before any board tasks are created.",
    intake: intakeSchema([
      singleSelectQuestion("buildType", "Build type", "Choose the kind of small project to draft.", BUILD_TYPE_OPTIONS),
      shortTextQuestion("vibeOrConstraint", "Vibe or constraint", "Name the style, constraint, audience, or must-have interaction."),
      singleSelectQuestion("ambitionLevel", "Ambition level", "Choose how much finish this first slice should target.", AMBITION_OPTIONS, "single-screen"),
    ]),
    capabilitySlots: {
      required: [
        {
          id: "builder",
          label: "Implementation",
          description: "Build the scoped prototype or feature with focused changes and a clear handoff.",
          suggestedRole: "Implementation Engineer",
        },
        {
          id: "product-shaping",
          label: "Product shaping",
          description: "Turn the intake answers into acceptance criteria and a practical first path.",
          suggestedRole: "Product Analyst",
        },
        {
          id: "verification",
          label: "Verification",
          description: "Check the finished path against the draft criteria and capture evidence.",
          suggestedRole: "QA Reviewer",
        },
      ],
      useful: [
        {
          id: "visual-polish",
          label: "Visual and copy polish",
          description: "Improve presentation, interaction states, and on-screen language.",
          suggestedRole: "Visual Product Specialist",
        },
        {
          id: "frontend-specialist",
          label: "Interface implementation",
          description: "Handle responsive UI details when the build is interface-heavy.",
          suggestedRole: "Front End Engineer",
        },
      ],
      later: [
        {
          id: "release-notes",
          label: "Release handoff",
          description: "Prepare a concise handoff if the prototype becomes part of a larger release.",
          suggestedRole: "Release Coordinator",
        },
      ],
    },
    draftOutputs: {
      createsBoardTasksImmediately: false,
      goal: {
        title: "Build a small reviewable project",
        objective: "Create a scoped prototype or feature that can be tested, reviewed, and iterated.",
      },
      sprint: {
        name: "Build Something Sprint",
        objective: "Shape, build, verify, and review the selected small project.",
      },
      taskPlan: [
        task("shape-brief", "Shape the build brief", "feature", "high", "Convert intake answers into acceptance criteria, scope boundaries, and a visible completion path.", ["product-shaping"]),
        task("implement-slice", "Implement the scoped slice", "feature", "high", "Build the agreed small project while keeping changes focused and reviewable.", ["builder", "frontend-specialist"], ["shape-brief"]),
        task("verify-path", "Verify the acceptance path", "validation", "high", "Run the agreed checks, capture evidence, and list any remaining issues.", ["verification"], ["implement-slice"]),
        task("review-polish", "Review polish and handoff", "validation", "medium", "Review the finished slice for presentation, copy, and next-step clarity.", ["visual-polish", "release-notes"], ["verify-path"]),
      ],
      activeCrewRecommendation: {
        summary: "Start with implementation, product shaping, and verification. Add visual or interface help when the chosen build type needs it.",
        requiredCapabilitySlotIds: ["builder", "product-shaping", "verification"],
        usefulCapabilitySlotIds: ["visual-polish", "frontend-specialist"],
        laterCapabilitySlotIds: ["release-notes"],
      },
      reviewGate: {
        title: "Review draft before creating tasks",
        description: "Confirm the build type, scope, acceptance criteria, and validation path before starting board work.",
      },
    },
    validationCriteria: {
      checklist: [
        "The draft names the selected build type and one clear user-visible outcome.",
        "The task plan includes shaping, implementation, verification, and review work.",
        "The acceptance path can be tested without relying on future scope.",
        "The Active Crew recommendation maps to required, useful, and later capability slots.",
      ],
      evidence: ["Working path evidence or screenshots", "Focused test or manual verification notes", "Concise handoff with remaining issues"],
      blockedIf: ["The brief is too broad for a first sprint", "The validation path is missing", "Board tasks would be created before draft approval"],
    },
  },
  {
    id: "pr-review",
    version: "1.0.0",
    templateVersionId: "pr-review@1.0.0",
    source: "built-in",
    lifecycle: "published",
    immutable: true,
    name: "PR Review",
    shortName: "PR Review",
    summary: "Review a proposed code change for behavior, maintainability, and release risk.",
    publicDescription:
      "Draft a focused review plan from the change context, selected review areas, and expected validation evidence.",
    intake: intakeSchema([
      shortTextQuestion("changeLocation", "Change location", "Provide the branch, patch, pull request, or local path to review."),
      multiSelectQuestion("reviewFocus", "Review focus", "Choose the review angles that matter for this change.", REVIEW_FOCUS_OPTIONS, ["correctness", "maintainability"]),
      longTextQuestion("operatorContext", "Operator context", "Add acceptance criteria, known concerns, or areas that should stay out of scope.", false),
    ]),
    capabilitySlots: {
      required: [
        {
          id: "code-review",
          label: "Code review",
          description: "Inspect the changed code for correctness, boundaries, and maintainability.",
          suggestedRole: "Implementation Reviewer",
        },
        {
          id: "validation-review",
          label: "Validation review",
          description: "Check that tests, manual evidence, or reproduction notes match the change.",
          suggestedRole: "QA Reviewer",
        },
      ],
      useful: [
        {
          id: "product-review",
          label: "Product review",
          description: "Review user impact, copy, and acceptance criteria when product behavior changes.",
          suggestedRole: "Product Analyst",
        },
        {
          id: "release-review",
          label: "Release review",
          description: "Check rollout notes, migration risks, and rollback readiness.",
          suggestedRole: "Release Coordinator",
        },
      ],
      later: [
        {
          id: "test-hardening",
          label: "Test hardening",
          description: "Create follow-up coverage when the review exposes a repeatable gap.",
          suggestedRole: "QA Engineer",
        },
      ],
    },
    draftOutputs: {
      createsBoardTasksImmediately: false,
      goal: {
        title: "Review a proposed code change",
        objective: "Produce an actionable review with findings, evidence, and a clear disposition recommendation.",
      },
      sprint: {
        name: "PR Review Sprint",
        objective: "Inspect the change, verify the relevant path, and prepare review notes.",
      },
      taskPlan: [
        task("orient-change", "Orient on the change", "maintenance", "high", "Read the change context, surrounding code, and acceptance criteria before reviewing details.", ["code-review"]),
        task("inspect-behavior", "Inspect behavior and boundaries", "maintenance", "high", "Identify concrete defects, regressions, missing validation, or unclear ownership.", ["code-review", "product-review"], ["orient-change"]),
        task("check-validation", "Check validation evidence", "validation", "high", "Run or review the focused checks needed for the selected review focus.", ["validation-review"], ["orient-change"]),
        task("prepare-review-notes", "Prepare review notes", "validation", "medium", "Write concise findings, residual risk, and any follow-up work that should be tracked.", ["release-review", "test-hardening"], ["inspect-behavior", "check-validation"]),
      ],
      activeCrewRecommendation: {
        summary: "Start with code review and validation review. Add product or release review when the change affects user behavior or rollout.",
        requiredCapabilitySlotIds: ["code-review", "validation-review"],
        usefulCapabilitySlotIds: ["product-review", "release-review"],
        laterCapabilitySlotIds: ["test-hardening"],
      },
      reviewGate: {
        title: "Approve review plan",
        description: "Confirm review focus and validation expectations before assigning review work.",
      },
    },
    validationCriteria: {
      checklist: [
        "The draft names the reviewed change location and selected review focus.",
        "The review task plan separates code inspection from validation checks.",
        "Findings must cite concrete files, behavior, or evidence.",
        "The output avoids generic approval language without supporting evidence.",
      ],
      evidence: ["Review notes with actionable findings", "Validation commands or manual checks used", "Residual risk and follow-up list"],
      blockedIf: ["The change location is unavailable", "No review focus is selected", "The draft would treat review as a board task before approval"],
    },
  },
  {
    id: "bug-triage",
    version: "1.0.0",
    templateVersionId: "bug-triage@1.0.0",
    source: "built-in",
    lifecycle: "published",
    immutable: true,
    name: "Bug Triage",
    shortName: "Bug Triage",
    summary: "Reproduce a reported issue, isolate likely cause, and prepare a repair plan.",
    publicDescription:
      "Turn a symptom report into a focused triage sprint with reproduction steps, impact notes, and a reviewable next action.",
    intake: intakeSchema([
      longTextQuestion("symptom", "Symptom", "Describe what is wrong and where it appears."),
      longTextQuestion("expectedBehavior", "Expected behavior", "Describe what should happen instead."),
      singleSelectQuestion("urgency", "Urgency", "Choose how the issue affects current work.", URGENCY_OPTIONS, "normal"),
      shortTextQuestion("knownContext", "Known context", "Add a local URL, route, file, or recent change if known.", false),
    ]),
    capabilitySlots: {
      required: [
        {
          id: "reproduction",
          label: "Reproduction",
          description: "Create the smallest reliable path that demonstrates the issue.",
          suggestedRole: "QA Reviewer",
        },
        {
          id: "debugging",
          label: "Debugging",
          description: "Inspect relevant code and state to isolate the likely cause.",
          suggestedRole: "Implementation Engineer",
        },
      ],
      useful: [
        {
          id: "product-impact",
          label: "Product impact",
          description: "Explain user impact, affected flows, and expected behavior.",
          suggestedRole: "Product Analyst",
        },
        {
          id: "support-copy",
          label: "Support summary",
          description: "Prepare operator-facing wording for status, workaround, or known limitation.",
          suggestedRole: "Support Specialist",
        },
      ],
      later: [
        {
          id: "regression-coverage",
          label: "Regression coverage",
          description: "Add or propose coverage that guards the repaired path.",
          suggestedRole: "QA Engineer",
        },
      ],
    },
    draftOutputs: {
      createsBoardTasksImmediately: false,
      goal: {
        title: "Triage a reported bug",
        objective: "Confirm the issue, isolate likely cause, and prepare a focused repair plan.",
      },
      sprint: {
        name: "Bug Triage Sprint",
        objective: "Reproduce, diagnose, and document the issue before repair work starts.",
      },
      taskPlan: [
        task("reproduce-issue", "Reproduce the issue", "validation", "high", "Capture the smallest reliable reproduction path and expected behavior.", ["reproduction", "product-impact"]),
        task("isolate-cause", "Isolate likely cause", "maintenance", "high", "Inspect related code, state, and recent changes to identify the likely cause.", ["debugging"], ["reproduce-issue"]),
        task("draft-repair-plan", "Draft the repair plan", "maintenance", "high", "Propose a scoped fix, validation checks, and rollback or workaround notes when relevant.", ["debugging", "regression-coverage"], ["isolate-cause"]),
        task("prepare-status-note", "Prepare status note", "validation", "medium", "Summarize impact, reproduction, likely cause, and next action for the operator.", ["support-copy"], ["draft-repair-plan"]),
      ],
      activeCrewRecommendation: {
        summary: "Start with reproduction and debugging. Add product impact or support wording when users or operators need clear status.",
        requiredCapabilitySlotIds: ["reproduction", "debugging"],
        usefulCapabilitySlotIds: ["product-impact", "support-copy"],
        laterCapabilitySlotIds: ["regression-coverage"],
      },
      reviewGate: {
        title: "Confirm triage scope",
        description: "Approve the symptom, expected behavior, and reproduction target before assigning triage work.",
      },
    },
    validationCriteria: {
      checklist: [
        "The draft includes symptom, expected behavior, and a reproduction target.",
        "The task plan separates reproduction from diagnosis and repair planning.",
        "The output identifies what is known, what is uncertain, and the next action.",
        "Regression coverage is proposed when the issue can recur.",
      ],
      evidence: ["Reproduction notes", "Relevant files or flows inspected", "Repair plan with validation checks"],
      blockedIf: ["The symptom is too vague to reproduce", "Expected behavior is missing", "The draft skips triage and jumps straight to broad repair work"],
    },
  },
  {
    id: "release-readiness",
    version: "1.0.0",
    templateVersionId: "release-readiness@1.0.0",
    source: "built-in",
    lifecycle: "published",
    immutable: true,
    name: "Release Readiness",
    shortName: "Release",
    summary: "Check a release candidate against validation, scope, handoff, and rollback expectations.",
    publicDescription:
      "Create a readiness plan for a release candidate before promotion, including required checks and operator-facing handoff notes.",
    intake: intakeSchema([
      shortTextQuestion("releaseTarget", "Release target", "Name the branch, build, package, or local release candidate."),
      singleSelectQuestion("releaseScope", "Release scope", "Choose the size of the release candidate.", RELEASE_SCOPE_OPTIONS, "patch"),
      longTextQuestion("includedChanges", "Included changes", "Summarize the changes that should be covered by readiness checks."),
      longTextQuestion("knownRisks", "Known risks", "List migrations, external dependencies, rollout concerns, or rollback notes.", false),
    ]),
    capabilitySlots: {
      required: [
        {
          id: "release-coordination",
          label: "Release coordination",
          description: "Own the readiness checklist, handoff, and final release package.",
          suggestedRole: "Release Coordinator",
        },
        {
          id: "quality-verification",
          label: "Quality verification",
          description: "Run focused checks against the release candidate and record evidence.",
          suggestedRole: "QA Reviewer",
        },
        {
          id: "repo-stewardship",
          label: "Repo stewardship",
          description: "Check build state, changed files, and rollback readiness.",
          suggestedRole: "Repo Steward",
        },
      ],
      useful: [
        {
          id: "product-signoff",
          label: "Product signoff",
          description: "Confirm the release matches user-facing acceptance criteria.",
          suggestedRole: "Product Analyst",
        },
        {
          id: "copy-handoff",
          label: "Handoff copy",
          description: "Prepare concise release notes and known-issue wording.",
          suggestedRole: "Writer",
        },
      ],
      later: [
        {
          id: "post-release-monitoring",
          label: "Post-release follow-up",
          description: "Define follow-up checks after the release lands.",
          suggestedRole: "Operations Specialist",
        },
      ],
    },
    draftOutputs: {
      createsBoardTasksImmediately: false,
      goal: {
        title: "Prepare a release candidate for review",
        objective: "Confirm the release candidate is ready for operator approval and promotion.",
      },
      sprint: {
        name: "Release Readiness Sprint",
        objective: "Validate the release candidate, prepare handoff notes, and surface blockers.",
      },
      taskPlan: [
        task("scope-release", "Scope the release candidate", "maintenance", "high", "Confirm included changes, boundaries, dependencies, and rollback expectations.", ["release-coordination", "repo-stewardship"]),
        task("run-readiness-checks", "Run readiness checks", "validation", "critical", "Run required build, lint, test, browser, or manual checks for the release candidate.", ["quality-verification"], ["scope-release"]),
        task("review-product-fit", "Review product fit", "validation", "high", "Confirm user-facing behavior and acceptance criteria for included changes.", ["product-signoff"], ["scope-release"]),
        task("prepare-release-package", "Prepare release package", "maintenance", "high", "Summarize checks, blockers, residual risk, rollback notes, and follow-up monitoring.", ["release-coordination", "copy-handoff", "post-release-monitoring"], ["run-readiness-checks", "review-product-fit"]),
      ],
      activeCrewRecommendation: {
        summary: "Start with release coordination, quality verification, and repo stewardship. Add product and copy review for user-facing releases.",
        requiredCapabilitySlotIds: ["release-coordination", "quality-verification", "repo-stewardship"],
        usefulCapabilitySlotIds: ["product-signoff", "copy-handoff"],
        laterCapabilitySlotIds: ["post-release-monitoring"],
      },
      reviewGate: {
        title: "Approve readiness checklist",
        description: "Confirm release target, required checks, and known risks before readiness work starts.",
      },
    },
    validationCriteria: {
      checklist: [
        "The draft names the release target and included changes.",
        "Required checks are explicit and tied to the release scope.",
        "Release notes, blockers, rollback notes, and follow-up checks are included.",
        "Promotion only follows operator review of the readiness package.",
      ],
      evidence: ["Readiness checklist results", "Release notes or handoff package", "Rollback and follow-up notes"],
      blockedIf: ["The release target is unclear", "Required checks are missing", "The draft implies promotion before review"],
    },
  },
  {
    id: "repo-cleanup",
    version: "1.0.0",
    templateVersionId: "repo-cleanup@1.0.0",
    source: "built-in",
    lifecycle: "published",
    immutable: true,
    name: "Repo Cleanup",
    shortName: "Cleanup",
    summary: "Plan and verify a small repository hygiene pass without broad refactors.",
    publicDescription:
      "Draft a cleanup sprint that identifies a bounded target, checks impact, applies focused changes, and validates the result.",
    intake: intakeSchema([
      singleSelectQuestion("cleanupScope", "Cleanup scope", "Choose the cleanup area for this sprint.", CLEANUP_SCOPE_OPTIONS, "dead-code"),
      shortTextQuestion("targetArea", "Target area", "Name the files, folder, package, route, or behavior to inspect."),
      longTextQuestion("boundaries", "Boundaries", "List what should stay out of scope or must not change.", false),
      longTextQuestion("requiredChecks", "Required checks", "List any tests, builds, or review evidence expected for this cleanup.", false),
    ]),
    capabilitySlots: {
      required: [
        {
          id: "repo-orientation",
          label: "Repo orientation",
          description: "Map imports, callers, tests, and ownership boundaries before cleanup.",
          suggestedRole: "Repo Steward",
        },
        {
          id: "implementation-cleanup",
          label: "Cleanup implementation",
          description: "Apply focused changes that preserve behavior and stay inside the approved boundary.",
          suggestedRole: "Implementation Engineer",
        },
        {
          id: "cleanup-verification",
          label: "Cleanup verification",
          description: "Run targeted checks and confirm no unexpected behavior changed.",
          suggestedRole: "QA Reviewer",
        },
      ],
      useful: [
        {
          id: "architecture-review",
          label: "Architecture review",
          description: "Review boundary-sensitive cleanup before changes are applied.",
          suggestedRole: "Architecture Specialist",
        },
        {
          id: "product-regression-check",
          label: "Product regression check",
          description: "Check affected user-visible paths when cleanup touches product surfaces.",
          suggestedRole: "Product Analyst",
        },
      ],
      later: [
        {
          id: "hygiene-roadmap",
          label: "Hygiene follow-up",
          description: "Record recurring cleanup opportunities for future sprints.",
          suggestedRole: "Repo Steward",
        },
      ],
    },
    draftOutputs: {
      createsBoardTasksImmediately: false,
      goal: {
        title: "Clean up a bounded repository area",
        objective: "Improve repository hygiene in a scoped area while preserving behavior.",
      },
      sprint: {
        name: "Repo Cleanup Sprint",
        objective: "Orient on impact, make focused cleanup changes, and verify the affected path.",
      },
      taskPlan: [
        task("map-impact", "Map cleanup impact", "research", "high", "Identify imports, callers, tests, affected behavior, and boundaries before editing.", ["repo-orientation", "architecture-review"]),
        task("apply-cleanup", "Apply focused cleanup", "maintenance", "high", "Make the approved cleanup changes without expanding into unrelated refactors.", ["implementation-cleanup"], ["map-impact"]),
        task("verify-cleanup", "Verify cleanup", "validation", "high", "Run targeted checks and inspect any affected product paths.", ["cleanup-verification", "product-regression-check"], ["apply-cleanup"]),
        task("capture-follow-up", "Capture follow-up hygiene", "maintenance", "medium", "Record deferred cleanup opportunities without expanding the current sprint.", ["hygiene-roadmap"], ["verify-cleanup"]),
      ],
      activeCrewRecommendation: {
        summary: "Start with repo orientation, implementation cleanup, and verification. Add architecture review when the target has broad imports or shared contracts.",
        requiredCapabilitySlotIds: ["repo-orientation", "implementation-cleanup", "cleanup-verification"],
        usefulCapabilitySlotIds: ["architecture-review", "product-regression-check"],
        laterCapabilitySlotIds: ["hygiene-roadmap"],
      },
      reviewGate: {
        title: "Approve cleanup boundary",
        description: "Confirm target area, scope boundaries, and checks before cleanup tasks are created.",
      },
    },
    validationCriteria: {
      checklist: [
        "The draft names the cleanup target and explicit boundaries.",
        "Impact mapping happens before implementation.",
        "Verification checks are tied to the affected area.",
        "Deferred opportunities are captured separately instead of widening the sprint.",
      ],
      evidence: ["Impact notes", "Focused diff summary", "Targeted validation evidence"],
      blockedIf: ["The cleanup target is too broad", "No validation path is available", "The draft removes or changes behavior without review"],
    },
  },
  {
    id: "local-app-smoke-test",
    version: "1.0.0",
    templateVersionId: "local-app-smoke-test@1.0.0",
    source: "built-in",
    lifecycle: "published",
    immutable: true,
    name: "Local App Smoke Test",
    shortName: "Smoke Test",
    summary: "Exercise a local app path and capture concise evidence about what works or fails.",
    publicDescription:
      "Draft a local verification sprint for a known route or workflow, including setup, browser checks, and evidence capture.",
    intake: intakeSchema([
      shortTextQuestion("localTarget", "Local target", "Provide the local URL, route, or command that starts the app path."),
      singleSelectQuestion("surface", "Surface", "Choose the smoke-test surface.", SMOKE_SURFACE_OPTIONS, "core-workflow"),
      longTextQuestion("acceptancePath", "Acceptance path", "Describe the workflow steps or visible states to verify."),
      longTextQuestion("setupNotes", "Setup notes", "Add local-only credentials, fixtures, or environment notes if needed.", false),
    ]),
    capabilitySlots: {
      required: [
        {
          id: "local-setup",
          label: "Local setup",
          description: "Start the app or confirm the target route is available in a local lane.",
          suggestedRole: "Implementation Engineer",
        },
        {
          id: "browser-verification",
          label: "Browser verification",
          description: "Exercise the workflow through the browser and capture evidence.",
          suggestedRole: "QA Reviewer",
        },
      ],
      useful: [
        {
          id: "product-path-review",
          label: "Product path review",
          description: "Check whether the visible flow matches the intended user experience.",
          suggestedRole: "Product Analyst",
        },
        {
          id: "visual-review",
          label: "Visual review",
          description: "Check layout, responsive behavior, and obvious presentation issues.",
          suggestedRole: "Visual QA Specialist",
        },
      ],
      later: [
        {
          id: "automation-follow-up",
          label: "Automation follow-up",
          description: "Propose a durable smoke test when the path should be checked repeatedly.",
          suggestedRole: "QA Engineer",
        },
      ],
    },
    draftOutputs: {
      createsBoardTasksImmediately: false,
      goal: {
        title: "Smoke test a local app path",
        objective: "Verify a local workflow and capture evidence for any failures or regressions.",
      },
      sprint: {
        name: "Local App Smoke Test Sprint",
        objective: "Start the local target, exercise the acceptance path, and report results.",
      },
      taskPlan: [
        task("prepare-local-target", "Prepare local target", "maintenance", "high", "Confirm the app, route, fixtures, and local-only setup notes needed for the path.", ["local-setup"]),
        task("run-browser-pass", "Run browser smoke pass", "validation", "high", "Exercise the acceptance path in a browser and capture screenshots, trace, or concise notes.", ["browser-verification", "visual-review"], ["prepare-local-target"]),
        task("review-product-path", "Review product path", "validation", "medium", "Check visible states, copy, and user-flow coherence against the acceptance path.", ["product-path-review"], ["run-browser-pass"]),
        task("summarize-smoke-results", "Summarize smoke results", "validation", "high", "Report pass/fail details, evidence, blockers, and automation follow-up when useful.", ["browser-verification", "automation-follow-up"], ["run-browser-pass", "review-product-path"]),
      ],
      activeCrewRecommendation: {
        summary: "Start with local setup and browser verification. Add product or visual review when the path is user-facing.",
        requiredCapabilitySlotIds: ["local-setup", "browser-verification"],
        usefulCapabilitySlotIds: ["product-path-review", "visual-review"],
        laterCapabilitySlotIds: ["automation-follow-up"],
      },
      reviewGate: {
        title: "Approve smoke-test path",
        description: "Confirm the local target, setup notes, and acceptance path before creating verification work.",
      },
    },
    validationCriteria: {
      checklist: [
        "The draft names a local target and acceptance path.",
        "Setup notes are scoped to local verification only.",
        "Browser evidence is required for the smoke pass.",
        "Failures include reproduction notes and next action.",
      ],
      evidence: ["Browser screenshots, trace, video, or concise manual notes", "Setup notes used", "Smoke result summary"],
      blockedIf: ["The local target cannot be identified", "The acceptance path is missing", "Required setup is unavailable"],
    },
  },
  {
    id: "competitor-research",
    version: "1.0.0",
    templateVersionId: "competitor-research@1.0.0",
    source: "built-in",
    lifecycle: "published",
    immutable: true,
    name: "Competitor Research",
    shortName: "Research",
    summary: "Compare competitors or alternatives and produce a decision-ready brief.",
    publicDescription:
      "Draft a research sprint that gathers current sources, compares visible patterns, and turns findings into practical next steps.",
    intake: intakeSchema([
      longTextQuestion("competitors", "Competitors or alternatives", "Name the companies, products, categories, or examples to compare."),
      singleSelectQuestion("decisionArea", "Decision area", "Choose what the research should inform.", RESEARCH_DECISION_OPTIONS, "product-scope"),
      shortTextQuestion("targetAudience", "Target audience", "Name the user, buyer, or stakeholder the comparison should center on.", false),
      longTextQuestion("sourceConstraints", "Source constraints", "List required sources, exclusions, geography, or recency expectations.", false),
    ]),
    capabilitySlots: {
      required: [
        {
          id: "source-research",
          label: "Source research",
          description: "Find and cite current public sources for each competitor or alternative.",
          suggestedRole: "Research Specialist",
        },
        {
          id: "synthesis",
          label: "Synthesis",
          description: "Turn source notes into clear tradeoffs, patterns, and recommended next steps.",
          suggestedRole: "Strategy Specialist",
        },
      ],
      useful: [
        {
          id: "product-analysis",
          label: "Product analysis",
          description: "Compare workflows, features, positioning, and user-facing claims.",
          suggestedRole: "Product Analyst",
        },
        {
          id: "editorial-review",
          label: "Editorial review",
          description: "Tighten the brief so facts, assumptions, and recommendations are easy to scan.",
          suggestedRole: "Writer",
        },
      ],
      later: [
        {
          id: "claim-review",
          label: "Claim review",
          description: "Review sensitive claims or regulated-language concerns before external use.",
          suggestedRole: "Compliance Reviewer",
        },
      ],
    },
    draftOutputs: {
      createsBoardTasksImmediately: false,
      goal: {
        title: "Research competitors and alternatives",
        objective: "Produce a source-backed comparison that supports a specific product or strategy decision.",
      },
      sprint: {
        name: "Competitor Research Sprint",
        objective: "Gather sources, compare patterns, synthesize tradeoffs, and prepare a brief.",
      },
      taskPlan: [
        task("frame-research", "Frame research question", "research", "high", "Clarify the decision area, competitors, audience, source constraints, and output format.", ["synthesis", "product-analysis"]),
        task("gather-sources", "Gather current sources", "research", "high", "Collect source-backed notes for each competitor or alternative.", ["source-research"], ["frame-research"]),
        task("compare-patterns", "Compare patterns", "research", "high", "Compare product scope, positioning, packaging, proof points, and gaps relevant to the decision area.", ["source-research", "product-analysis"], ["gather-sources"]),
        task("write-research-brief", "Write research brief", "research", "high", "Prepare concise findings, assumptions, tradeoffs, and recommended next steps with citations.", ["synthesis", "editorial-review", "claim-review"], ["compare-patterns"]),
      ],
      activeCrewRecommendation: {
        summary: "Start with source research and synthesis. Add product analysis and editorial review when the brief will shape product or external-facing decisions.",
        requiredCapabilitySlotIds: ["source-research", "synthesis"],
        usefulCapabilitySlotIds: ["product-analysis", "editorial-review"],
        laterCapabilitySlotIds: ["claim-review"],
      },
      reviewGate: {
        title: "Approve research frame",
        description: "Confirm competitors, decision area, source constraints, and output format before assigning research work.",
      },
    },
    validationCriteria: {
      checklist: [
        "The draft names the competitors or alternatives and the decision area.",
        "Source gathering and synthesis are separate tasks.",
        "The final brief must cite sources and distinguish facts from assumptions.",
        "Recommendations are tied to the stated decision area.",
      ],
      evidence: ["Source list with links or citations", "Comparison notes", "Final research brief with assumptions and next steps"],
      blockedIf: ["Competitors or alternatives are not named", "The decision area is unclear", "The brief would rely on uncited claims"],
    },
  },
] as const satisfies readonly BuiltInStarterSprintTemplate[];

export function isBuiltInStarterSprintTemplateId(value: string): value is BuiltInStarterSprintTemplateId {
  return BUILT_IN_STARTER_SPRINT_TEMPLATE_IDS.includes(value as BuiltInStarterSprintTemplateId);
}

export function listBuiltInStarterSprintTemplates(): readonly BuiltInStarterSprintTemplate[] {
  return BUILT_IN_STARTER_SPRINT_TEMPLATES;
}

export function getBuiltInStarterSprintTemplate(id: BuiltInStarterSprintTemplateId): BuiltInStarterSprintTemplate {
  const template = BUILT_IN_STARTER_SPRINT_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) {
    throw new Error(`Unknown built-in starter sprint template: ${id}`);
  }
  return template;
}
