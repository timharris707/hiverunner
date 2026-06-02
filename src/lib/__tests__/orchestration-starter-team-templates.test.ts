import assert from "node:assert";

import {
  STARTER_TEAM_TEMPLATES,
  STARTER_TEAM_WORK_TYPE_IDS,
  buildStarterTeamSetupPayload,
  cloneStarterTeamRoles,
  getDefaultStarterTeamRoleCards,
  getStarterTeamTemplate,
  isStarterTeamWorkTypeId,
  readSelectedStarterAgents,
} from "@/lib/orchestration/starter-team-templates";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  pass ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  fail ${name}`);
    console.error(`    ${message}`);
  }
}

function assertNoBannedPublicCopy(text: string, label: string) {
  const bannedPatterns = [
    /\bCodex\b/i,
    /\bClaude\b/i,
    /\bGemini\b/i,
    /\bOpenClaw\b/i,
    /\bprivate\b/i,
    /\bguarantee[sd]?\b/i,
    /\blegal advice\b/i,
    /\bfinancial advice\b/i,
  ];

  for (const pattern of bannedPatterns) {
    assert.equal(pattern.test(text), false, `${label} contains banned public copy: ${pattern}`);
  }
}

console.log("\nStarter Team Template Contract Tests\n");

test("covers every approved work type exactly once", () => {
  const ids = STARTER_TEAM_TEMPLATES.map((template) => template.workTypeId);
  assert.deepEqual(ids, [...STARTER_TEAM_WORK_TYPE_IDS]);
  assert.equal(new Set(ids).size, STARTER_TEAM_WORK_TYPE_IDS.length);

  for (const id of STARTER_TEAM_WORK_TYPE_IDS) {
    assert.equal(isStarterTeamWorkTypeId(id), true);
    assert.equal(getStarterTeamTemplate(id).workTypeId, id);
  }

  assert.equal(isStarterTeamWorkTypeId("sales-team"), false);
});

test("default selections match the template role cards", () => {
  for (const template of STARTER_TEAM_TEMPLATES) {
    const roleIds = new Set(template.roleCards.map((role) => role.id));

    for (const id of [...template.defaultSelectedRoleIds, ...template.optionalRoleIds]) {
      assert.equal(roleIds.has(id), true, `${template.workTypeId} references missing role ${id}`);
    }

    for (const role of template.roleCards) {
      assert.equal(
        template.defaultSelectedRoleIds.includes(role.id),
        role.defaultSelected,
        `${role.id} defaultSelected must match template.defaultSelectedRoleIds`,
      );
      assert.equal(
        template.optionalRoleIds.includes(role.id),
        role.optional,
        `${role.id} optional must match template.optionalRoleIds`,
      );
    }

    const defaultRoles = getDefaultStarterTeamRoleCards(template.workTypeId);
    assert.deepEqual(
      defaultRoles.map((role) => role.id),
      [...template.defaultSelectedRoleIds],
      `${template.workTypeId} default helper must preserve template order`,
    );

    const clonedRoles = cloneStarterTeamRoles(template.workTypeId);
    assert.deepEqual(
      clonedRoles.filter((role) => role.selected).map((role) => role.id),
      [...template.defaultSelectedRoleIds],
      `${template.workTypeId} clone helper must preserve default selection`,
    );
    assert.equal(clonedRoles.every((role) => role.runtimeProvider === "manual"), true);
    assert.equal(clonedRoles.every((role) => role.model === ""), true);
    assert.equal(
      clonedRoles.every((role) => !role.identity || role.identity.avatarUrl.startsWith("/starter-agent-avatars/")),
      true,
      `${template.workTypeId} bundled avatar URLs must use the starter asset path`,
    );
  }
});

test("public display and role copy stays neutral and vendor-free", () => {
  for (const template of STARTER_TEAM_TEMPLATES) {
    assertNoBannedPublicCopy(template.templateName, `${template.workTypeId} templateName`);
    assertNoBannedPublicCopy(template.templateShortName, `${template.workTypeId} templateShortName`);
    assertNoBannedPublicCopy(Object.values(template.displayCopy).join(" "), `${template.workTypeId} displayCopy`);
    assertNoBannedPublicCopy(template.kickoffIntentCopy, `${template.workTypeId} kickoffIntentCopy`);
    assertNoBannedPublicCopy(template.kickoffTask.title, `${template.workTypeId} kickoffTask.title`);
    assertNoBannedPublicCopy(template.kickoffTask.description, `${template.workTypeId} kickoffTask.description`);
    assertNoBannedPublicCopy(template.leadershipRule.rule, `${template.workTypeId} leadershipRule.rule`);
    assertNoBannedPublicCopy(template.providerKeyRequirement.setupCopy, `${template.workTypeId} setupCopy`);

    for (const role of template.roleCards) {
      assertNoBannedPublicCopy(
        [
          role.name,
          role.role,
          role.summary,
          role.mission,
          role.kickoffIntentCopy,
          ...role.capabilities,
          role.identity?.avatarVibe ?? "",
          role.identity?.personality ?? "",
        ].join(" "),
        role.id,
      );
    }
  }
});

test("selected starter roles include bundled avatars and voices", () => {
  for (const template of STARTER_TEAM_TEMPLATES) {
    if (template.workTypeId === "blank-custom") continue;

    const selectedRoles = cloneStarterTeamRoles(template.workTypeId).filter((role) => role.selected);
    assert.ok(selectedRoles.length > 0, `${template.workTypeId} should recommend starter roles`);

    for (const role of selectedRoles) {
      assert.ok(role.identity, `${template.workTypeId}/${role.id} should include starter identity metadata`);
      assert.ok(role.identity.avatarUrl.endsWith(".webp"), `${role.id} should reference a bundled webp avatar`);
      assert.ok(role.identity.voiceId, `${role.id} should include a default voice ID`);
      assert.ok(role.identity.personality, `${role.id} should include public-safe personality guidance`);
    }
  }
});

test("work type maps to a provisioning payload", () => {
  for (const template of STARTER_TEAM_TEMPLATES) {
    const payload = buildStarterTeamSetupPayload(template.workTypeId);

    assert.equal(payload.workType, template.workTypeId);
    assert.equal(payload.templateName, template.templateName);
    assert.deepEqual(payload.kickoffTask, template.kickoffTask);
    assert.deepEqual(payload.initialProject, template.initialProject);
    assert.equal(payload.starterTeam.workType, template.workTypeId);
    assert.deepEqual(
      payload.starterTeam.agents.map((agent) => agent.id),
      template.roleCards.map((role) => role.id),
      `${template.workTypeId} provisioning payload must preserve role order`,
    );
    assert.deepEqual(
      payload.starterTeam.agents.filter((agent) => agent.selected).map((agent) => agent.id),
      [...template.defaultSelectedRoleIds],
      `${template.workTypeId} provisioning payload must preserve selected defaults`,
    );

    if (payload.starterTeam.agents.length > 0) {
      const original = cloneStarterTeamRoles(template.workTypeId);
      payload.starterTeam.agents[0]!.capabilities.push("temporary-test-value");
      assert.equal(original[0]?.capabilities.includes("temporary-test-value"), false);
    }
  }
});

test("setup payload reader keeps selected agents and de-dupes preserved leadership", () => {
  const selected = readSelectedStarterAgents(
    {
      workType: "software-product",
      agents: [
        {
          id: "software-implementation-engineer",
          name: "Corey",
          role: "Implementation Engineer",
          mission: "Build scoped changes.",
          capabilities: "Implementation, Tests",
          selected: true,
          runtimeProvider: "openclaw",
          model: "openai/gpt-5.4",
          avatarUrl: "https://attacker.example/not-used.png",
          voiceId: "NotAStarterVoice",
        },
        {
          name: "Corey",
          role: "Duplicate Engineer",
          selected: true,
        },
        {
          name: "Nova",
          role: "Replacement Lead",
          selected: true,
        },
        {
          name: "Gator",
          role: "QA Reviewer",
          selected: false,
        },
      ],
    },
    { ceoName: "Nova" },
  );

  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.name, "Corey");
  assert.equal(selected[0]?.role, "Implementation Engineer");
  assert.equal(selected[0]?.mission, "Build scoped changes.");
  assert.deepEqual(selected[0]?.capabilities, ["Implementation", "Tests"]);
  assert.equal(selected[0]?.avatarUrl, "/starter-agent-avatars/corey.webp");
  assert.equal(selected[0]?.voiceId, "Alnilam");
  assert.ok(selected[0]?.personality?.includes("implementation"));
  assert.notEqual(selected[0]?.avatarUrl, "https://attacker.example/not-used.png");
  assert.notEqual(selected[0]?.voiceId, "NotAStarterVoice");
});

test("setup payload reader ignores selected agents for blank/custom", () => {
  const selected = readSelectedStarterAgents({
    workType: "blank-custom",
    agents: [
      {
        name: "Custom Builder",
        role: "Custom Role",
        mission: "Should not be provisioned during blank setup.",
        capabilities: ["Build"],
        selected: true,
      },
    ],
  });

  assert.deepEqual(selected, []);
});

test("setup payload reader rejects unknown work types", () => {
  assert.throws(
    () => readSelectedStarterAgents({ workType: "sales-team", agents: [] }),
    /Unknown starter team work type: sales-team/,
  );
});

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}

console.log(`\n${passed} passed`);
