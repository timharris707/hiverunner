import assert from "node:assert";

import { createSyncTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  BUILT_IN_STARTER_SPRINT_TEMPLATE_IDS,
  BUILT_IN_STARTER_SPRINT_TEMPLATES,
  getBuiltInStarterSprintTemplate,
  isBuiltInStarterSprintTemplateId,
  listBuiltInStarterSprintTemplates,
  type BuiltInStarterSprintTemplate,
} from "@/lib/orchestration/starter-sprint-templates";

const { test, finish } = createSyncTestRunner({ passLabel: "pass", failLabel: "fail" });

console.log("\nStarter Sprint Template Catalog Contract Tests\n");

function collectStrings(value: unknown, path = "catalog"): Array<{ path: string; text: string }> {
  if (typeof value === "string") {
    return [{ path, text: value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectStrings(item, `${path}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => collectStrings(item, `${path}.${key}`));
  }
  return [];
}

function assertCleanPublicCopy(template: BuiltInStarterSprintTemplate) {
  const bannedPatterns = [
    /\bCodex\b/i,
    /\bClaude\b/i,
    /\bGemini\b/i,
    /\bOpenClaw\b/i,
    /\bInsight\b/i,
    /\bprivate\b/i,
    /\bguarantee[sd]?\b/i,
    /\blegal advice\b/i,
    /\bfinancial advice\b/i,
    /\bscore\w*\b/i,
    /\brank\w*\b/i,
    /\bleaderboard\b/i,
    /\bgrade\w*\b/i,
    /\bmodel comparison\b/i,
  ];

  for (const { path, text } of collectStrings(template)) {
    for (const pattern of bannedPatterns) {
      assert.equal(pattern.test(text), false, `${path} contains banned public copy: ${pattern}`);
    }
  }
}

function idsForSlots(template: BuiltInStarterSprintTemplate) {
  return new Set([
    ...template.capabilitySlots.required.map((slot) => slot.id),
    ...template.capabilitySlots.useful.map((slot) => slot.id),
    ...template.capabilitySlots.later.map((slot) => slot.id),
  ]);
}

test("defines the seven initial built-in templates exactly once", () => {
  const ids = BUILT_IN_STARTER_SPRINT_TEMPLATES.map((template) => template.id);
  assert.deepEqual(ids, [...BUILT_IN_STARTER_SPRINT_TEMPLATE_IDS]);
  assert.equal(new Set(ids).size, BUILT_IN_STARTER_SPRINT_TEMPLATE_IDS.length);
  assert.deepEqual(listBuiltInStarterSprintTemplates().map((template) => template.id), ids);

  for (const id of BUILT_IN_STARTER_SPRINT_TEMPLATE_IDS) {
    assert.equal(isBuiltInStarterSprintTemplateId(id), true);
    assert.equal(getBuiltInStarterSprintTemplate(id).id, id);
  }

  assert.equal(isBuiltInStarterSprintTemplateId("model-ranking"), false);
});

test("marks every fixture as an immutable published built-in version", () => {
  for (const template of BUILT_IN_STARTER_SPRINT_TEMPLATES) {
    assert.equal(template.source, "built-in");
    assert.equal(template.lifecycle, "published");
    assert.equal(template.immutable, true);
    assert.equal(template.version, "1.0.0");
    assert.equal(template.templateVersionId, `${template.id}@1.0.0`);
    assert.ok(template.name.length > 0, `${template.id} must have name`);
    assert.ok(template.summary.length > 0, `${template.id} must have summary`);
    assert.ok(template.publicDescription.length > 0, `${template.id} must have public description`);
  }
});

test("every template has an intake schema with aligned questions and answer properties", () => {
  for (const template of BUILT_IN_STARTER_SPRINT_TEMPLATES) {
    assert.equal(template.intake.version, 1);
    assert.ok(template.intake.questions.length > 0, `${template.id} must include intake questions`);
    assert.equal(template.intake.answerSchema.type, "object");

    const questionIds = new Set(template.intake.questions.map((question) => question.id));
    assert.equal(questionIds.size, template.intake.questions.length, `${template.id} question ids must be unique`);
    assert.deepEqual(Object.keys(template.intake.answerSchema.properties), [...questionIds]);

    const requiredIds = template.intake.questions.filter((question) => question.required).map((question) => question.id);
    assert.deepEqual(template.intake.answerSchema.required, requiredIds, `${template.id} required answers must mirror required questions`);

    for (const question of template.intake.questions) {
      const property = template.intake.answerSchema.properties[question.id];
      assert.ok(property, `${template.id}/${question.id} must have schema property`);
      if (question.type === "single_select") {
        assert.ok(question.options && question.options.length >= 2, `${template.id}/${question.id} select must have options`);
        assert.equal(property.type, "string");
        assert.deepEqual(property.enum, question.options.map((option) => option.value));
      }
      if (question.type === "multi_select") {
        assert.ok(question.options && question.options.length >= 2, `${template.id}/${question.id} multi-select must have options`);
        assert.equal(property.type, "array");
        assert.deepEqual(property.items?.enum, question.options.map((option) => option.value));
        assert.equal(property.minItems, question.required ? 1 : undefined);
      }
    }
  }

  assert.ok(getBuiltInStarterSprintTemplate("build-something").intake.questions.length <= 3);
});

test("capability slots include required, useful, and later lanes with valid references", () => {
  for (const template of BUILT_IN_STARTER_SPRINT_TEMPLATES) {
    assert.ok(template.capabilitySlots.required.length > 0, `${template.id} must include required slots`);
    assert.ok(template.capabilitySlots.useful.length > 0, `${template.id} must include useful slots`);
    assert.ok(template.capabilitySlots.later.length > 0, `${template.id} must include later slots`);

    const allSlotIds = idsForSlots(template);
    const expectedSlotCount =
      template.capabilitySlots.required.length + template.capabilitySlots.useful.length + template.capabilitySlots.later.length;
    assert.equal(allSlotIds.size, expectedSlotCount, `${template.id} slot ids must be unique`);

    for (const slot of [
      ...template.capabilitySlots.required,
      ...template.capabilitySlots.useful,
      ...template.capabilitySlots.later,
    ]) {
      assert.ok(slot.label.length > 0, `${template.id}/${slot.id} must have label`);
      assert.ok(slot.description.length > 0, `${template.id}/${slot.id} must have description`);
      assert.ok(slot.suggestedRole.length > 0, `${template.id}/${slot.id} must have suggested role`);
    }

    for (const slotId of template.draftOutputs.activeCrewRecommendation.requiredCapabilitySlotIds) {
      assert.ok(
        template.capabilitySlots.required.some((slot) => slot.id === slotId),
        `${template.id} active crew required slot ${slotId} must reference required slots`,
      );
    }
    for (const slotId of template.draftOutputs.activeCrewRecommendation.usefulCapabilitySlotIds) {
      assert.ok(
        template.capabilitySlots.useful.some((slot) => slot.id === slotId),
        `${template.id} active crew useful slot ${slotId} must reference useful slots`,
      );
    }
    for (const slotId of template.draftOutputs.activeCrewRecommendation.laterCapabilitySlotIds) {
      assert.ok(
        template.capabilitySlots.later.some((slot) => slot.id === slotId),
        `${template.id} active crew later slot ${slotId} must reference later slots`,
      );
    }

    for (const draftTask of template.draftOutputs.taskPlan) {
      for (const slotId of draftTask.suggestedCapabilitySlotIds) {
        assert.ok(allSlotIds.has(slotId), `${template.id}/${draftTask.id} references missing capability slot ${slotId}`);
      }
    }
  }
});

test("draft outputs create reviewable plans before board tasks", () => {
  for (const template of BUILT_IN_STARTER_SPRINT_TEMPLATES) {
    assert.equal(template.draftOutputs.createsBoardTasksImmediately, false);
    assert.ok(template.draftOutputs.goal.title.length > 0, `${template.id} draft goal needs title`);
    assert.ok(template.draftOutputs.goal.objective.length > 0, `${template.id} draft goal needs objective`);
    assert.ok(template.draftOutputs.sprint.name.length > 0, `${template.id} draft sprint needs name`);
    assert.ok(template.draftOutputs.sprint.objective.length > 0, `${template.id} draft sprint needs objective`);
    assert.ok(template.draftOutputs.taskPlan.length >= 3, `${template.id} must include draft task plan`);
    assert.ok(template.draftOutputs.reviewGate.title.length > 0, `${template.id} must include review gate title`);
    assert.ok(template.draftOutputs.reviewGate.description.length > 0, `${template.id} must include review gate description`);

    const draftTaskIds = new Set(template.draftOutputs.taskPlan.map((draftTask) => draftTask.id));
    assert.equal(draftTaskIds.size, template.draftOutputs.taskPlan.length, `${template.id} draft task ids must be unique`);

    for (const draftTask of template.draftOutputs.taskPlan) {
      assert.ok(draftTask.title.length > 0, `${template.id}/${draftTask.id} needs title`);
      assert.ok(draftTask.description.length > 0, `${template.id}/${draftTask.id} needs description`);
      assert.ok(draftTask.suggestedCapabilitySlotIds.length > 0, `${template.id}/${draftTask.id} needs capability slots`);
      for (const dependencyId of draftTask.dependsOn ?? []) {
        assert.ok(draftTaskIds.has(dependencyId), `${template.id}/${draftTask.id} depends on missing draft task ${dependencyId}`);
      }
    }
  }
});

test("validation criteria are present and actionable for every template", () => {
  for (const template of BUILT_IN_STARTER_SPRINT_TEMPLATES) {
    assert.ok(template.validationCriteria.checklist.length >= 3, `${template.id} needs validation checklist`);
    assert.ok(template.validationCriteria.evidence.length >= 2, `${template.id} needs evidence requirements`);
    assert.ok(template.validationCriteria.blockedIf.length >= 2, `${template.id} needs blocked conditions`);

    for (const item of [
      ...template.validationCriteria.checklist,
      ...template.validationCriteria.evidence,
      ...template.validationCriteria.blockedIf,
    ]) {
      assert.ok(item.length > 0, `${template.id} validation item must be non-empty`);
    }
  }
});

test("catalog copy is public-safe and avoids premature evaluator language", () => {
  for (const template of BUILT_IN_STARTER_SPRINT_TEMPLATES) {
    assertCleanPublicCopy(template);
  }
});

finish();
