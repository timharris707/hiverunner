import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildHumanReadableCompanyWorkspaceDirectoryName,
  resolveAgentWorkspacePathWithLegacyFallback,
  resolveCanonicalCompanyWorkspaceRoot,
  resolveCompanyWorkspaceRoot,
  resolveLegacyOpenClawAgentWorkspacePath,
  resolvePlannedCanonicalCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";
import { resolveWorkspaceBase } from "@/lib/files/workspace-resolver";
import {
  resolveHiveRunnerLane,
  resolveHiveRunnerWorkspaceRoot,
} from "@/lib/workspaces/root";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error: unknown) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  \u2717 ${name}`);
    console.error(`    ${message}`);
  }
}

function testEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

function run() {
  console.log("\nWorkspace Root Resolution Tests\n");

  test("defaults dev lane from data-dev", () => {
    const env = testEnv({
      HOME: "/Users/test",
      MC_DATA_DIR: "/tmp/hiverunner/data-dev",
    });
    assert.strictEqual(resolveHiveRunnerLane(env), "dev");
    assert.strictEqual(
      resolveHiveRunnerWorkspaceRoot(env),
      "/Users/test/.hiverunner/workspace",
    );
  });

  test("defaults stable lane from production context", () => {
    const env = testEnv({
      HOME: "/Users/test",
      NODE_ENV: "production",
    });
    assert.strictEqual(resolveHiveRunnerLane(env), "stable");
    assert.strictEqual(
      resolveHiveRunnerWorkspaceRoot(env),
      "/Users/test/.hiverunner/workspace",
    );
  });

  test("absent MC_WORKSPACE_ROOT defaults to home HiveRunner workspace", () => {
    const env = testEnv({
      HOME: "/Users/test",
      NODE_ENV: "development",
    });

    assert.strictEqual(
      resolveHiveRunnerWorkspaceRoot(env),
      "/Users/test/.hiverunner/workspace",
    );
  });

  test("canonical company roots use workspace_slug under MC_WORKSPACE_ROOT", () => {
    const env = testEnv({
      HOME: "/Users/test",
      MC_WORKSPACE_ROOT: "/tmp/hiverunner-stable-workspaces",
    });
    assert.strictEqual(
      resolveCanonicalCompanyWorkspaceRoot("company-123", "Acme Labs", env),
      "/tmp/hiverunner-stable-workspaces/companies/acme-labs",
    );
  });

  test("planned human-readable company roots use workspace_slug only", () => {
    const env = testEnv({
      HOME: "/Users/test",
      MC_WORKSPACE_ROOT: "/tmp/hiverunner-stable-workspaces",
    });
    assert.strictEqual(
      buildHumanReadableCompanyWorkspaceDirectoryName("Acme Labs", "company-123"),
      "acme-labs",
    );
    assert.strictEqual(
      resolvePlannedCanonicalCompanyWorkspaceRoot("company-123", "acme-labs", env),
      "/tmp/hiverunner-stable-workspaces/companies/acme-labs",
    );
  });

  test("persisted workspace_root values win over canonical fallback", () => {
    const env = testEnv({
      HOME: "/Users/test",
      MC_WORKSPACE_ROOT: "/tmp/hiverunner-stable-workspaces",
    });
    assert.strictEqual(
      resolveCompanyWorkspaceRoot({
        companyId: "company-123",
        workspaceRoot: "/tmp/legacy-workspaces/acme",
        env,
      }),
      "/tmp/legacy-workspaces/acme",
    );
  });

  test("openclaw-backed companies fall back to the default OpenClaw workspace", () => {
    const env = testEnv({
      HOME: "/Users/test",
      OPENCLAW_DIR: "/tmp/test-openclaw",
      MC_WORKSPACE_ROOT: "/tmp/hiverunner-stable-workspaces",
    });
    assert.strictEqual(
      resolveCompanyWorkspaceRoot({
        companyId: "default-company",
        workspaceRoot: null,
        workspaceSource: "openclaw",
        env,
      }),
      "/tmp/test-openclaw/workspace",
    );
  });

  test("generic workspace alias resolves to HiveRunner workspace root", () => {
    const previousMcWorkspaceRoot = process.env.MC_WORKSPACE_ROOT;
    const previousOpenClawDir = process.env.OPENCLAW_DIR;
    process.env.MC_WORKSPACE_ROOT = "/tmp/hiverunner-file-workspaces";
    process.env.OPENCLAW_DIR = "/tmp/openclaw-should-not-win";

    try {
      assert.strictEqual(resolveWorkspaceBase("workspace"), "/tmp/hiverunner-file-workspaces");
      assert.strictEqual(resolveWorkspaceBase("mission-control"), "/tmp/hiverunner-file-workspaces");
      assert.strictEqual(resolveWorkspaceBase("unknown-workspace-name"), null);
    } finally {
      if (previousMcWorkspaceRoot === undefined) {
        delete process.env.MC_WORKSPACE_ROOT;
      } else {
        process.env.MC_WORKSPACE_ROOT = previousMcWorkspaceRoot;
      }
      if (previousOpenClawDir === undefined) {
        delete process.env.OPENCLAW_DIR;
      } else {
        process.env.OPENCLAW_DIR = previousOpenClawDir;
      }
    }
  });

  test("agent workspace resolution prefers company-scoped paths before legacy OpenClaw workspaces", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hiverunner-workspace-resolution-"));
    const companyRoot = path.join(tempRoot, "company-root");
    const companyAgentRoot = path.join(companyRoot, "agents", "atlas");
    const openclawDir = path.join(tempRoot, "openclaw");
    const legacyAgentRoot = path.join(openclawDir, "workspace-atlas");
    fs.mkdirSync(companyAgentRoot, { recursive: true });
    fs.mkdirSync(legacyAgentRoot, { recursive: true });

    const resolved = resolveAgentWorkspacePathWithLegacyFallback(companyRoot, "atlas", testEnv({
      HOME: tempRoot,
      OPENCLAW_DIR: openclawDir,
    }));

    assert.strictEqual(resolved.path, companyAgentRoot);
    assert.strictEqual(resolved.exists, true);
    assert.strictEqual(resolved.source, "company-convention");
  });

  test("agent workspace resolution prefers recognized legacy subworkspace before workspace-slug alias", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hiverunner-workspace-resolution-"));
    const openclawDir = path.join(tempRoot, "openclaw");
    const openclawWorkspaceRoot = path.join(openclawDir, "workspace");
    const legacySubworkspaceRoot = path.join(openclawWorkspaceRoot, "forge");
    const legacyAliasRoot = path.join(openclawDir, "workspace-forge");
    fs.mkdirSync(path.join(legacySubworkspaceRoot, ".openclaw"), { recursive: true });
    fs.writeFileSync(
      path.join(legacySubworkspaceRoot, ".openclaw", "workspace-state.json"),
      JSON.stringify({ workspaceId: "forge" }),
    );
    fs.writeFileSync(path.join(legacySubworkspaceRoot, "AGENTS.md"), "# Forge");
    fs.mkdirSync(legacyAliasRoot, { recursive: true });

    const resolved = resolveAgentWorkspacePathWithLegacyFallback(null, "forge", testEnv({
      HOME: tempRoot,
      OPENCLAW_DIR: openclawDir,
      OPENCLAW_WORKSPACE_ROOT: openclawWorkspaceRoot,
    }));

    assert.strictEqual(resolved.path, legacySubworkspaceRoot);
    assert.strictEqual(resolved.exists, true);
    assert.strictEqual(resolved.source, "legacy-openclaw-subworkspace");
  });

  test("workspace-slug alias resolves to the preferred legacy subworkspace when present", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hiverunner-workspace-resolution-"));
    const openclawDir = path.join(tempRoot, "openclaw");
    const openclawWorkspaceRoot = path.join(openclawDir, "workspace");
    const legacySubworkspaceRoot = path.join(openclawWorkspaceRoot, "forge");
    const legacyAliasRoot = path.join(openclawDir, "workspace-forge");
    fs.mkdirSync(path.join(legacySubworkspaceRoot, ".openclaw"), { recursive: true });
    fs.writeFileSync(
      path.join(legacySubworkspaceRoot, ".openclaw", "workspace-state.json"),
      JSON.stringify({ workspaceId: "forge" }),
    );
    fs.writeFileSync(path.join(legacySubworkspaceRoot, "IDENTITY.md"), "# Forge");
    fs.mkdirSync(legacyAliasRoot, { recursive: true });

    const preferred = resolveLegacyOpenClawAgentWorkspacePath("forge", testEnv({
      HOME: tempRoot,
      OPENCLAW_DIR: openclawDir,
      OPENCLAW_WORKSPACE_ROOT: openclawWorkspaceRoot,
    }));
    const previousOpenClawDir = process.env.OPENCLAW_DIR;
    const previousOpenClawWorkspaceRoot = process.env.OPENCLAW_WORKSPACE_ROOT;
    process.env.OPENCLAW_DIR = openclawDir;
    process.env.OPENCLAW_WORKSPACE_ROOT = openclawWorkspaceRoot;

    let resolvedAlias: string | null = null;
    try {
      resolvedAlias = resolveWorkspaceBase("workspace-forge");
    } finally {
      if (previousOpenClawDir === undefined) {
        delete process.env.OPENCLAW_DIR;
      } else {
        process.env.OPENCLAW_DIR = previousOpenClawDir;
      }
      if (previousOpenClawWorkspaceRoot === undefined) {
        delete process.env.OPENCLAW_WORKSPACE_ROOT;
      } else {
        process.env.OPENCLAW_WORKSPACE_ROOT = previousOpenClawWorkspaceRoot;
      }
    }

    assert.strictEqual(preferred.path, legacySubworkspaceRoot);
    assert.strictEqual(preferred.source, "legacy-openclaw-subworkspace");
    assert.strictEqual(preferred.aliasPath, legacyAliasRoot);
    assert.strictEqual(resolvedAlias, legacySubworkspaceRoot);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
