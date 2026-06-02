import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

import packageJson from "../../package.json";
import { resolveHiveRunnerLane, type HiveRunnerLane } from "@/lib/workspaces/root";

export type PromotionMetadata = {
  release_id?: string;
  release_tag?: string;
  release_commit?: string;
  release_branch?: string;
  release_reason?: string;
  promoted_at?: string;
  promoted_by?: string;
  repo_dirty?: string;
  dirty_status_file?: string;
  current_release_state_file?: string;
};

export type AppBuildMetadata = {
  version: string;
  versionLabel: string;
  mode: "dev" | "stable";
  lane: HiveRunnerLane;
  port: string;
  cwd: string;
  buildTag: string | null;
  buildCommit: string | null;
  buildCommitShort: string | null;
  buildTime: string | null;
  displayLabel: string;
  release: {
    releaseId: string | null;
    releaseTag: string | null;
    releaseCommit: string | null;
    releaseCommitShort: string | null;
    releaseBranch: string | null;
    releaseReason: string | null;
    promotedAt: string | null;
    promotedBy: string | null;
    repoDirty: string | null;
  };
  git: {
    commit: string | null;
    commitShort: string | null;
    branch: string | null;
    dirty: boolean | null;
  };
};

type GitMetadata = AppBuildMetadata["git"];

let gitMetadataCache: GitMetadata | undefined;

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function shortCommit(value: string | null): string | null {
  return value ? value.slice(0, 7) : null;
}

function readGitField(args: string[], cwd: string): string | null {
  try {
    return clean(execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 800,
    }));
  } catch {
    return null;
  }
}

function readGitMetadata(cwd = process.cwd()): GitMetadata {
  if (gitMetadataCache) return gitMetadataCache;

  const commit = readGitField(["rev-parse", "HEAD"], cwd);
  const branch = readGitField(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const status = readGitField(["status", "--short"], cwd);
  gitMetadataCache = {
    commit,
    commitShort: shortCommit(commit),
    branch,
    dirty: status == null ? null : status.length > 0,
  };
  return gitMetadataCache;
}

export function readPromotionMetadata(cwd = process.cwd()): PromotionMetadata | null {
  const metadataPath = path.join(cwd, ".promotion-metadata.json");
  try {
    return JSON.parse(fs.readFileSync(metadataPath, "utf8")) as PromotionMetadata;
  } catch {
    return null;
  }
}

export function getAppBuildMetadata(env: NodeJS.ProcessEnv = process.env): AppBuildMetadata {
  const cwd = process.cwd();
  const promotion = readPromotionMetadata(cwd);
  const git = readGitMetadata(cwd);
  const mode = env.NODE_ENV !== "production" ? "dev" : "stable";
  const lane = resolveHiveRunnerLane(env);
  const port = clean(env.PORT) ?? "3010";
  const releaseCommit = clean(promotion?.release_commit) ?? clean(env.RELEASE_COMMIT);
  const releaseTag = clean(promotion?.release_tag) ?? clean(env.RELEASE_TAG);
  const releaseBranch = clean(promotion?.release_branch) ?? clean(env.RELEASE_BRANCH);
  const promotedAt = clean(promotion?.promoted_at) ?? clean(env.RELEASE_PROMOTED_AT);
  const buildCommit = releaseCommit ?? git.commit;
  const buildCommitShort = shortCommit(buildCommit);
  const version = packageJson.version;
  const versionLabel = `v${version}`;

  return {
    version,
    versionLabel,
    mode,
    lane,
    port,
    cwd,
    buildTag: releaseTag,
    buildCommit,
    buildCommitShort,
    buildTime: promotedAt,
    displayLabel: [versionLabel, buildCommitShort].filter(Boolean).join(" · "),
    release: {
      releaseId: clean(promotion?.release_id) ?? clean(env.RELEASE_ID),
      releaseTag,
      releaseCommit,
      releaseCommitShort: shortCommit(releaseCommit),
      releaseBranch,
      releaseReason: clean(promotion?.release_reason) ?? clean(env.RELEASE_REASON),
      promotedAt,
      promotedBy: clean(promotion?.promoted_by) ?? clean(env.RELEASE_PROMOTED_BY),
      repoDirty: clean(promotion?.repo_dirty) ?? clean(env.RELEASE_REPO_DIRTY),
    },
    git,
  };
}
