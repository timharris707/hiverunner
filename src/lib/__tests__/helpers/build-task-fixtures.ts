import assert from "node:assert";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { readTasks } from "@/lib/build-queue";
import { getDb } from "@/lib/tasks-db";

export type BuildTaskFixture = {
  id: string;
  title: string;
  project: string;
  status: string;
  updated: string;
  [key: string]: unknown;
};

type BuildTaskFixtureOptions = {
  idPrefix: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  overrides?: Record<string, unknown>;
  priority?: string;
  project?: string;
  status?: string;
  type?: string;
};

type UpsertableTaskFixture = Record<string, unknown> & {
  id: string;
  status: string;
  created?: string;
  project?: string;
  updated?: string;
};

export function makeBuildTaskFixture(options: BuildTaskFixtureOptions): BuildTaskFixture {
  ensureHiverunnerProjectDirectory();

  const id = `${options.idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const timestamp = new Date().toISOString();

  return {
    id,
    title: options.title,
    description: options.description,
    project: options.project ?? "mission-control",
    status: options.status ?? "in-progress",
    priority: options.priority ?? "P1",
    type: options.type ?? "feature",
    acceptance_criteria: options.acceptanceCriteria,
    created: timestamp,
    updated: timestamp,
    ...options.overrides,
  };
}

function ensureHiverunnerProjectDirectory() {
  mkdirSync(path.join(process.cwd(), "projects", "hiverunner"), { recursive: true });
}

export function upsertBuildTaskFixture(task: UpsertableTaskFixture) {
  const db = getDb();
  const updated = task.updated || task.created || new Date().toISOString();

  db.prepare(`
    INSERT INTO tasks (id, data, status, project, updated)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      data = excluded.data,
      status = excluded.status,
      project = excluded.project,
      updated = excluded.updated
  `).run(task.id, JSON.stringify({ ...task, updated }), task.status, task.project || null, updated);
}

export function deleteBuildTaskFixtures(ids: string[]) {
  if (ids.length === 0) return;

  const db = getDb();
  const deleteTask = db.prepare("DELETE FROM tasks WHERE id = ?");
  const deleteTransitions = db.prepare("DELETE FROM task_transitions WHERE task_id = ?");

  for (const id of ids) {
    deleteTransitions.run(id);
    deleteTask.run(id);
  }
}

export function getBuildTaskFixture(id: string): BuildTaskFixture {
  const task = (readTasks() as BuildTaskFixture[]).find((entry) => entry.id === id);
  assert.ok(task, `expected task ${id} to exist`);
  return task;
}
