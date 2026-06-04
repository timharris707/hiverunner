import type Database from "better-sqlite3";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { createProject } from "@/lib/orchestration/service";
import {
  createIsolatedOrchestrationWorkspace,
  resetSqliteDatabaseFiles,
} from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

type ProjectFixture = ReturnType<typeof createProject>["project"];

type AgentProjectFixtureOptions = {
  color: string;
  companyId: string;
  emoji: string;
  projectNamePrefix: string;
  workspacePrefix: string;
};

type AgentProjectFixture = {
  db: Database.Database;
  project: ProjectFixture;
  stamp: string;
};

export async function withIsolatedAgentProjectFixture(
  options: AgentProjectFixtureOptions,
  run: (fixture: AgentProjectFixture) => Promise<void> | void,
): Promise<void> {
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: options.workspacePrefix,
  });

  try {
    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const project = createProject({
      companyId: options.companyId,
      name: `${options.projectNamePrefix} ${stamp}`,
      description: "fixture",
      color: options.color,
      emoji: options.emoji,
      status: "active",
    }).project;

    await run({ db, project, stamp });
  } finally {
    workspaceIsolation.dispose();
  }
}
