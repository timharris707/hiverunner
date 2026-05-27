import assert from "node:assert";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { createProject, createProjectAgent, getAgentProfile } from "@/lib/orchestration/service";
import { PATCH as patchAgentProfile } from "@/app/api/orchestration/agents/[id]/profile/route";
import { PATCH as patchCompanyAgent } from "@/app/api/orchestration/companies/[slug]/agents/[agentId]/route";
import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

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
  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-agent-identity-",
  });
  workspaceIsolation.syncDatabase(getOrchestrationDb());

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
    assert.strictEqual(
      reloaded.avatar,
      `/api/orchestration/companies/${company.id}/agents/${agent.slug}/avatar`,
    );
    const storedAvatar = getOrchestrationDb()
      .prepare("SELECT avatar_url FROM agents WHERE id = ?")
      .get(agent.id) as { avatar_url: string | null };
    assert.strictEqual(storedAvatar.avatar_url, "https://example.test/kelvin.png");
    assert.strictEqual(reloaded.avatarStyleId, "cyber-organic");
    assert.strictEqual(reloaded.avatarGender, "female");
    assert.strictEqual(reloaded.avatarAge, 28);
    assert.strictEqual(reloaded.avatarHairColor, "dark brown");
    assert.strictEqual(reloaded.avatarHairLength, "shoulder-length");
    assert.strictEqual(reloaded.avatarEyeColor, "amber");
    assert.strictEqual(reloaded.avatarVibe, "confident, curious, slightly mischievous");
    assert.strictEqual(reloaded.voiceId, "Aoede");
  });

  await test("PATCH syncs profile, model, reporting, avatar, and voice into core files", async () => {
    const manager = createProjectAgent({
      projectId: project.id,
      name: `Manager ${stamp}`,
      emoji: "icon:crown",
      role: "Lead",
      personality: "",
      status: "idle",
      skills: [],
    }).agent;

    const res = await patchCompanyAgent(
      patchRequest({
        name: `Core Kelvin ${stamp}`,
        title: "Senior Runtime Engineer",
        model: "openai-codex/gpt-5.5",
        reportsTo: manager.id,
        avatarStyleId: "technical-operator",
        avatarGender: "androgynous",
        avatarAge: 35,
        avatarHairColor: "black",
        avatarHairLength: "cropped",
        avatarEyeColor: "green",
        voiceId: "Iapetus",
      }) as never,
      { params: Promise.resolve({ slug: company.slug, agentId: agent.id }) },
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json() as { coreFiles?: { synced: boolean; root: string | null } };
    assert.strictEqual(body.coreFiles?.synced, true);
    assert.ok(body.coreFiles?.root, "core file root should be returned");

    const identity = readFileSync(path.join(body.coreFiles.root, "IDENTITY.md"), "utf8");
    assert.match(identity, new RegExp(`- Name: Core Kelvin ${stamp}`));
    assert.match(identity, /- Role: Senior Runtime Engineer/);
    assert.match(identity, new RegExp(`- Reports To: Manager ${stamp}`));
    assert.match(identity, /- Default Model: openai-codex\/gpt-5\.5/);
    assert.match(identity, /- Reasoning Effort: high/);
    assert.match(identity, /- Speed Preference: fast_1_5x/);
    assert.match(identity, /- Avatar Presentation: androgynous, 35, black cropped hair, green eyes/);
    assert.match(identity, /- Voice: Iapetus/);
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
    assert.strictEqual(reloaded.avatarStyleId, "technical-operator");
    assert.strictEqual(reloaded.avatarGender, "androgynous");
    assert.strictEqual(reloaded.avatarAge, 35);
  });

  await test("PATCH rejects out-of-range age", async () => {
    const res = await patchCompanyAgent(
      patchRequest({ avatarAge: 500 }) as never,
      { params: Promise.resolve({ slug: company.slug, agentId: agent.id }) }
    );
    assert.strictEqual(res.status, 400, "age > 120 must be rejected");
    const body = (await res.json()) as { error?: { code?: string } };
    assert.strictEqual(body.error?.code, "avatar_age_invalid");

    // Value should not have changed from the previous successful write (35)
    const reloaded = getAgentProfile({ agentId: agent.id }).agent;
    assert.strictEqual(reloaded.avatarAge, 35);
  });

  await test("PATCH rejects non-string avatarUrl instead of storing object text", async () => {
    const res = await patchCompanyAgent(
      patchRequest({ avatarUrl: { url: "https://example.test/bad.png" } }) as never,
      { params: Promise.resolve({ slug: company.slug, agentId: agent.id }) }
    );
    assert.strictEqual(res.status, 400);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    assert.strictEqual(body.error?.code, "avatar_url_invalid");
    assert.doesNotMatch(body.error?.message ?? "", /\[object Object\]/);

    const storedAvatar = getOrchestrationDb()
      .prepare("SELECT avatar_url FROM agents WHERE id = ?")
      .get(agent.id) as { avatar_url: string | null };
    assert.notStrictEqual(storedAvatar.avatar_url, "[object Object]");
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
    assert.strictEqual(reloaded.avatarStyleId, "technical-operator");
    assert.strictEqual(reloaded.avatarGender, "androgynous");
    assert.strictEqual(reloaded.avatarAge, 35);
  });

  await test("profile PATCH syncs avatar identity and voice into core files", async () => {
    const res = await patchAgentProfile(
      patchRequest({
        name: `Profile Kelvin ${stamp}`,
        avatarStyleId: "profile-operator",
        avatarGender: "male",
        avatarAge: 41,
        avatarHairColor: "silver",
        avatarHairLength: "short",
        avatarEyeColor: "hazel",
        avatarVibe: "steady runtime reviewer",
        voiceId: "Orus",
      }) as never,
      { params: Promise.resolve({ id: agent.id }) },
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json() as { coreFiles?: { synced: boolean; root: string | null } };
    assert.strictEqual(body.coreFiles?.synced, true);
    assert.ok(body.coreFiles?.root, "profile route should sync core files");

    const reloaded = getAgentProfile({ agentId: agent.id }).agent;
    assert.strictEqual(reloaded.voiceId, "Orus");
    assert.strictEqual(reloaded.avatarStyleId, "profile-operator");

    const identity = readFileSync(path.join(body.coreFiles.root, "IDENTITY.md"), "utf8");
    assert.match(identity, new RegExp(`- Name: Profile Kelvin ${stamp}`));
    assert.match(identity, /- Avatar Style: profile-operator/);
    assert.match(identity, /- Avatar Presentation: male, 41, silver short hair, hazel eyes/);
    assert.match(identity, /- Avatar Vibe: steady runtime reviewer/);
    assert.match(identity, /- Voice: Orus/);
  });

  await test("profile PATCH persists runtime config and permissions into core files", async () => {
    const res = await patchAgentProfile(
      patchRequest({
        runtimeConfig: {
          reasoningEffort: "xhigh",
          speedPreference: "normal",
          modelLane: "deep",
        },
        permissions: {
          canCreateAgents: false,
          canAssignTasks: true,
        },
      }) as never,
      { params: Promise.resolve({ id: agent.id }) },
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json() as { coreFiles?: { synced: boolean; root: string | null } };
    assert.strictEqual(body.coreFiles?.synced, true);
    assert.ok(body.coreFiles?.root, "profile route should sync runtime config into core files");

    const row = getOrchestrationDb()
      .prepare("SELECT runtime_config_json, permissions_json FROM agents WHERE id = ?")
      .get(agent.id) as { runtime_config_json: string; permissions_json: string };
    assert.deepStrictEqual(JSON.parse(row.runtime_config_json), {
      reasoningEffort: "xhigh",
      speedPreference: "normal",
      modelLane: "deep",
    });
    assert.deepStrictEqual(JSON.parse(row.permissions_json), {
      canCreateAgents: false,
      canAssignTasks: true,
    });

    const identity = readFileSync(path.join(body.coreFiles.root, "IDENTITY.md"), "utf8");
    assert.match(identity, /- Reasoning Effort: xhigh/);
    assert.match(identity, /- Speed Preference: normal/);
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  workspaceIsolation.dispose();
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
