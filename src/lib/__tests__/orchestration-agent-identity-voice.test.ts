import assert from "node:assert";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { createProject, createProjectAgent, getAgentProfile } from "@/lib/orchestration/service";
import { PATCH as patchCompanyAgent } from "@/app/api/orchestration/companies/[slug]/agents/[agentId]/route";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/orchestration/patch", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function run() {
  console.log("\nAgent Avatar Identity + Voice Persistence Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const company = createCompany({
    name: `Identity Co ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;

  const project = createProject({
    companyId: company.id,
    name: `Identity Project ${stamp}`,
    description: "fixture",
    color: "#22d3ee",
    emoji: "\ud83e\uddd1",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: `Kelvin ${stamp}`,
    emoji: "\ud83e\udd16",
    role: "Engineer",
    personality: "",
    status: "idle",
    skills: [],
  }).agent;

  await test("PATCH persists all avatar identity + voice fields", async () => {
    const res = await patchCompanyAgent(
      patchRequest({
        avatarUrl: "https://example.test/kelvin.png",
        avatarStyleId: "cyber-organic",
        avatarGender: "female",
        avatarAge: 28,
        avatarHairColor: "dark brown",
        avatarHairLength: "shoulder-length",
        avatarEyeColor: "amber",
        avatarVibe: "confident, curious, slightly mischievous",
        voiceId: "Aoede",
      }) as never,
      { params: Promise.resolve({ slug: company.slug, agentId: agent.id }) }
    );
    assert.strictEqual(res.status, 200, `PATCH should succeed, got ${res.status}`);

    const reloaded = getAgentProfile({ agentId: agent.id }).agent;
    assert.strictEqual(reloaded.avatar, "https://example.test/kelvin.png");
    assert.strictEqual(reloaded.avatarStyleId, "cyber-organic");
    assert.strictEqual(reloaded.avatarGender, "female");
    assert.strictEqual(reloaded.avatarAge, 28);
    assert.strictEqual(reloaded.avatarHairColor, "dark brown");
    assert.strictEqual(reloaded.avatarHairLength, "shoulder-length");
    assert.strictEqual(reloaded.avatarEyeColor, "amber");
    assert.strictEqual(reloaded.avatarVibe, "confident, curious, slightly mischievous");
    assert.strictEqual(reloaded.voiceId, "Aoede");
  });

  await test("PATCH with empty string or null clears individual fields", async () => {
    const res = await patchCompanyAgent(
      patchRequest({
        avatarHairColor: "",
        avatarVibe: null,
        voiceId: null,
      }) as never,
      { params: Promise.resolve({ slug: company.slug, agentId: agent.id }) }
    );
    assert.strictEqual(res.status, 200);

    const reloaded = getAgentProfile({ agentId: agent.id }).agent;
    assert.strictEqual(reloaded.avatarHairColor, undefined, "hair color should clear");
    assert.strictEqual(reloaded.avatarVibe, undefined, "vibe should clear");
    assert.strictEqual(reloaded.voiceId, undefined, "voiceId should clear");
    // Untouched fields should stay
    assert.strictEqual(reloaded.avatarStyleId, "cyber-organic");
    assert.strictEqual(reloaded.avatarGender, "female");
    assert.strictEqual(reloaded.avatarAge, 28);
  });

  await test("PATCH rejects out-of-range age", async () => {
    const res = await patchCompanyAgent(
      patchRequest({ avatarAge: 500 }) as never,
      { params: Promise.resolve({ slug: company.slug, agentId: agent.id }) }
    );
    assert.strictEqual(res.status, 400, "age > 120 must be rejected");
    const body = (await res.json()) as { error?: { code?: string } };
    assert.strictEqual(body.error?.code, "avatar_age_invalid");

    // Value should not have changed from the previous successful write (28)
    const reloaded = getAgentProfile({ agentId: agent.id }).agent;
    assert.strictEqual(reloaded.avatarAge, 28);
  });

  await test("PATCH rejects non-numeric age", async () => {
    const res = await patchCompanyAgent(
      patchRequest({ avatarAge: "old" }) as never,
      { params: Promise.resolve({ slug: company.slug, agentId: agent.id }) }
    );
    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error?: { code?: string } };
    assert.strictEqual(body.error?.code, "avatar_age_invalid");
  });

  await test("PATCH leaves untouched fields alone when only one field is sent", async () => {
    await patchCompanyAgent(
      patchRequest({ voiceId: "Kore" }) as never,
      { params: Promise.resolve({ slug: company.slug, agentId: agent.id }) }
    );
    const reloaded = getAgentProfile({ agentId: agent.id }).agent;
    assert.strictEqual(reloaded.voiceId, "Kore");
    assert.strictEqual(reloaded.avatarStyleId, "cyber-organic");
    assert.strictEqual(reloaded.avatarGender, "female");
    assert.strictEqual(reloaded.avatarAge, 28);
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
