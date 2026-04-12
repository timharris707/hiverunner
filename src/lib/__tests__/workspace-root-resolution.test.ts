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
  resolveMissionControlLane,
  resolveMissionControlWorkspaceRoot,
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

function run() {
  console.log("\nWorkspace Root Resolution Tests\n");

  test("defaults dev lane from data-dev", () => {
    const env = {
      HOME: "/Users/test",
      MC_DATA_DIR: "/tmp/mission-control/data-dev",
    };
    assert.strictEqual(resolveMissionControlLane(env), "dev");
    assert.strictEqual(
      resolveMissionControlWorkspaceRoot(env),
      "/Users/test/.mission-control/dev/workspaces",
    );
  });

  test("defaults stable lane from production context", () => {
    const env = {
      HOME: "/Users/test",
      NODE_ENV: "production",
    };
    assert.strictEqual(resolveMissionControlLane(env), "stable");
    assert.strictEqual(
      resolveMissionControlWorkspaceRoot(env),
      "/Users/test/.mission-control/stable/workspaces",
    );
  });

  test("canonical company roots use workspace_slug plus company id under MC_WORKSPACE_ROOT", () => {
    const env = {
      HOME: "/Users/test",
      MC_WORKSPACE_ROOT: "/tmp/mc-stable-workspaces",
    };
    assert.strictEqual(
      resolveCanonicalCompanyWorkspaceRoot("company-123", "Acme Labs", env),
      "/tmp/mc-stable-workspaces/companies/acme-labs--company-123",
    );
  });

  test("planned human-readable company roots use workspace_slug plus id", () => {
    const env = {
      HOME: "/Users/test",
      MC_WORKSPACE_ROOT: "/tmp/mc-stable-workspaces",
    };
    assert.strictEqual(
      buildHumanReadableCompanyWorkspaceDirectoryName("Acme Labs", "company-123"),
      "acme-labs--company-123",
    );
    assert.strictEqual(
      resolvePlannedCanonicalCompanyWorkspaceRoot("company-123", "acme-labs", env),
      "/tmp/mc-stable-workspaces/companies/acme-labs--company-123",
    );
  });

  test("persisted workspace_root values win over canonical fallback", () => {
    const env = {
      HOME: "/Users/test",
      MC_WORKSPACE_ROOT: "/tmp/mc-stable-workspaces",
    };
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
    const env = {
      HOME: "/Users/test",
      OPENCLAW_DIR: "/tmp/test-openclaw",
      MC_WORKSPACE_ROOT: "/tmp/mc-stable-workspaces",
    };
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

  test("agent workspace resolution prefers company-scoped paths before legacy OpenClaw workspaces", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-workspace-resolution-"));
    const companyRoot = path.join(tempRoot, "company-root");
    const companyAgentRoot = path.join(companyRoot, "agents", "atlas");
    const openclawDir = path.join(tempRoot, "openclaw");
    const legacyAgentRoot = path.join(openclawDir, "workspace-atlas");
    fs.mkdirSync(companyAgentRoot, { recursive: true });
    fs.mkdirSync(legacyAgentRoot, { recursive: true });

    const resolved = resolveAgentWorkspacePathWithLegacyFallback(companyRoot, "atlas", {
      HOME: tempRoot,
      OPENCLAW_DIR: openclawDir,
    });

    assert.strictEqual(resolved.path, companyAgentRoot);
    assert.strictEqual(resolved.exists, true);
    assert.strictEqual(resolved.source, "company-convention");
  });

  test("agent workspace resolution prefers recognized legacy subworkspace before workspace-slug alias", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-workspace-resolution-"));
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

    const resolved = resolveAgentWorkspacePathWithLegacyFallback(null, "forge", {
      HOME: tempRoot,
      OPENCLAW_DIR: openclawDir,
      OPENCLAW_WORKSPACE_ROOT: openclawWorkspaceRoot,
    });

    assert.strictEqual(resolved.path, legacySubworkspaceRoot);
    assert.strictEqual(resolved.exists, true);
    assert.strictEqual(resolved.source, "legacy-openclaw-subworkspace");
  });

  test("workspace-slug alias resolves to the preferred legacy subworkspace when present", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-workspace-resolution-"));
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

    const preferred = resolveLegacyOpenClawAgentWorkspacePath("forge", {
      HOME: tempRoot,
      OPENCLAW_DIR: openclawDir,
      OPENCLAW_WORKSPACE_ROOT: openclawWorkspaceRoot,
    });
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
