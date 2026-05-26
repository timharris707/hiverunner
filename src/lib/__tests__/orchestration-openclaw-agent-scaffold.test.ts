import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureOpenClawAgentScaffold } from "@/lib/orchestration/openclaw-agent-scaffold";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  \u2717 ${name}`);
    console.error(`    ${message}`);
  }
}

console.log("\nOpenClaw Agent Scaffold Contract Test\n");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-openclaw-agent-scaffold-"));
process.env.OPENCLAW_DIR = tempRoot;

try {
  test("creates agent directory with agent.json, SOUL.md, and memory/", () => {
    const result = ensureOpenClawAgentScaffold({
      openclawAgentId: "forge-scaffold-contract",
      name: "Forge",
      role: "Backend Engineer",
      personality: "Pragmatic and rigorous",
      projectName: "HiveRunner Orchestration Layer",
      projectSlug: "mission-control-orchestration-layer",
      model: "gpt-5.3-codex",
      skills: ["backend", "sqlite", "orchestration"],
    });

    assert.strictEqual(result.createdAgentJson, true);
    assert.strictEqual(result.createdSoul, true);

    const agentJsonPath = path.join(result.agentDir, "agent.json");
    const soulPath = path.join(result.agentDir, "SOUL.md");
    const memoryDir = path.join(result.agentDir, "memory");

    assert.ok(fs.existsSync(agentJsonPath), "expected agent.json to exist");
    assert.ok(fs.existsSync(soulPath), "expected SOUL.md to exist");
    assert.ok(fs.existsSync(memoryDir), "expected memory directory to exist");

    const config = JSON.parse(fs.readFileSync(agentJsonPath, "utf8")) as {
      id: string;
      model: string;
      project: { slug: string };
    };
    assert.strictEqual(config.id, "forge-scaffold-contract");
    assert.strictEqual(config.model, "gpt-5.3-codex");
    assert.strictEqual(config.project.slug, "mission-control-orchestration-layer");

    const soul = fs.readFileSync(soulPath, "utf8");
    assert.match(soul, /# Identity/);
    assert.match(soul, /Name: Forge/);
  });

  test("is idempotent and does not overwrite existing scaffold files", () => {
    const result = ensureOpenClawAgentScaffold({
      openclawAgentId: "forge-scaffold-contract",
      name: "Forge Changed",
      role: "Different Role",
      personality: "Changed",
      projectName: "Changed Project",
      projectSlug: "changed-project",
      model: "gpt-5.4",
      skills: [],
    });

    assert.strictEqual(result.createdAgentJson, false);
    assert.strictEqual(result.createdSoul, false);

    const config = JSON.parse(
      fs.readFileSync(path.join(result.agentDir, "agent.json"), "utf8")
    ) as { name: string; role: string };
    assert.strictEqual(config.name, "Forge");
    assert.strictEqual(config.role, "Backend Engineer");
  });
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);

