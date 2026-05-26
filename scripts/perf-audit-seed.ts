import Database from "better-sqlite3";
import { randomUUID } from "crypto";

import { resolveHiveRunnerDataDir } from "../src/lib/runtime-paths";

const DB_PATH = process.env.ORCHESTRATION_DB_PATH
  ? process.env.ORCHESTRATION_DB_PATH
  : `${resolveHiveRunnerDataDir(process.env)}/orchestration.db`;
const db = new Database(DB_PATH);

// Check if perf-audit project already exists
const existing = db.prepare("SELECT id FROM projects WHERE slug = 'perf-audit-100' LIMIT 1").get() as {id: string} | undefined;
if (existing) {
  const count = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE project_id = ?").get(existing.id) as {c: number}).c;
  const agentCount = (db.prepare("SELECT COUNT(*) as c FROM agents WHERE project_id = ?").get(existing.id) as {c: number}).c;
  console.log(`Project already exists: ${existing.id}, tasks: ${count}, agents: ${agentCount}`);
  db.close();
  process.exit(0);
}

const now = new Date().toISOString();
const projectId = randomUUID();

// Create project
db.prepare(`INSERT INTO projects (id, slug, name, description, color, status, owner_user_id, settings_json, created_at, updated_at)
  VALUES (?, 'perf-audit-100', 'Performance Audit — 100+ Tasks', 'Load test: 100+ tasks, 10+ agents', '#7c3aed', 'active', 'tim', '{}', ?, ?)`)
  .run(projectId, now, now);

// Create sprint
const sprintId = randomUUID();
db.prepare(`INSERT INTO sprints (id, project_id, name, goal, status, start_date, created_at, updated_at)
  VALUES (?, ?, 'Sprint 1', 'Load test sprint', 'active', ?, ?, ?)`)
  .run(sprintId, projectId, now, now, now);

// Create 12 agents
const roles = ['Frontend Engineer', 'Backend Engineer', 'ML Engineer', 'DevOps', 'QA Engineer',
  'Product Manager', 'Data Scientist', 'Security Engineer', 'UX Designer', 'Platform Engineer',
  'Site Reliability Engineer', 'Technical Writer'];
const emojis = ['💻','⚙️','🤖','🐳','🧪','📋','📊','🔒','🎨','🏗️','🛡️','📝'];
const agentIds: string[] = [];

const insertAgent = db.prepare(`INSERT INTO agents 
  (id, project_id, name, emoji, role, personality, status, model, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 'professional, focused', 'idle', 'claude-opus-4-6', ?, ?)`);

for (let i = 0; i < 12; i++) {
  const agentId = randomUUID();
  insertAgent.run(agentId, projectId, `Agent-${i+1}`, emojis[i], roles[i], now, now);
  agentIds.push(agentId);
}

// Create 120 tasks across all statuses
const statuses = ['backlog','backlog','backlog','to-do','to-do','in_progress','in_progress','review','done','done','done','done'];
const priorities = ['low','medium','medium','high','critical','high','medium','low','medium','high'];

const insertTask = db.prepare(`INSERT INTO tasks
  (id, project_id, sprint_id, title, description, priority, type, status, column_order, assignee_agent_id, created_by, labels_json, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 'feature', ?, ?, ?, 'perf-audit', '[]', ?, ?)`);

const tx = db.transaction(() => {
  for (let i = 0; i < 120; i++) {
    const taskId = randomUUID();
    const status = statuses[i % statuses.length];
    const priority = priorities[i % priorities.length];
    const assigneeId = agentIds[i % agentIds.length];
    insertTask.run(
      taskId, projectId, sprintId,
      `Task ${i+1}: ${['Implement','Refactor','Test','Review','Deploy','Debug','Profile','Document','Optimize','Migrate'][i%10]} module ${Math.floor(i/10)+1}`,
      `Description for task ${i+1}. This task involves detailed work on the orchestration layer component ${i+1}.`,
      priority, status, i, assigneeId, now, now
    );
  }
});
tx();

console.log(`Created project: ${projectId}`);
console.log("  agents: 12");
console.log("  tasks: 120");
db.close();
