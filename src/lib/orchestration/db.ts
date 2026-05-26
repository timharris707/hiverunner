import { createHash, randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { MC_DATA_DIR } from "../data-dir";
import {
  resolveHiveRunnerWorkspaceRoot,
  resolveOpenClawWorkspaceRoot,
} from "@/lib/workspaces/root";

type Migration = {
  version: number;
  name: string;
  sql: string;
  compatibleChecksums?: readonly string[];
};

const DEFAULT_COMPANY_ID = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
const DEFAULT_COMPANY_SLUG = "hiverunner-workspace";
const DEFAULT_COMPANY_CODE = "HIVE";
const DEFAULT_COMPANY_NAME = "HiveRunner Workspace";
const DEFAULT_COMPANY_DESCRIPTION = "Workspace for agents, tasks, memory, and runs.";
const DEFAULT_LOCAL_OWNER_ID = "local-owner";
const DEFAULT_LOCAL_OWNER_NAME = "Local Owner";
const DEFAULT_LOCAL_OWNER_EMAIL = "owner@localhost.local";
const DEFAULT_OPENCLAW_WORKSPACE_ROOT = resolveOpenClawWorkspaceRoot();
const DEFAULT_MC_WORKSPACE_ROOT = resolveHiveRunnerWorkspaceRoot();

const SQLITE_BUSY_TIMEOUT_MS = 5000;

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_orchestration_schema",
    compatibleChecksums: [
      // Legacy checksum from early initialized DBs before non-semantic v1 SQL edits.
      "24e5dfcd9269ac7fe8c4ec5256204194dcca1cd84552f934469d5bd6cd2a4a18",
    ],
    sql: `
      CREATE TABLE projects (
        id              TEXT PRIMARY KEY,
        slug            TEXT NOT NULL UNIQUE,
        name            TEXT NOT NULL,
        description     TEXT NOT NULL DEFAULT '',
        color           TEXT NOT NULL DEFAULT '#0ea5e9',
        status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
        owner_user_id   TEXT,
        settings_json   TEXT NOT NULL DEFAULT '{}',
        created_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        archived_at     TEXT
      );

      CREATE TABLE avatar_themes (
        id                  TEXT PRIMARY KEY,
        project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name                TEXT NOT NULL,
        prompt_template     TEXT NOT NULL,
        style_keywords_json TEXT NOT NULL DEFAULT '[]',
        sample_url          TEXT,
        is_default          INTEGER NOT NULL DEFAULT 1 CHECK (is_default IN (0, 1)),
        created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        UNIQUE(project_id, name)
      );

      CREATE TABLE sprints (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        goal            TEXT NOT NULL DEFAULT '',
        status          TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','active','completed')),
        start_date      TEXT NOT NULL,
        end_date        TEXT,
        completed_at    TEXT,
        created_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        UNIQUE(project_id, name)
      );

      CREATE TABLE agents (
        id                  TEXT PRIMARY KEY,
        project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name                TEXT NOT NULL,
        emoji               TEXT,
        role                TEXT NOT NULL,
        personality         TEXT NOT NULL DEFAULT '',
        avatar_url          TEXT,
        status              TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','working','paused','offline','error')),
        current_task_id     TEXT,
        model               TEXT,
        openclaw_agent_id   TEXT UNIQUE,
        paperclip_agent_id  TEXT UNIQUE,
        reporting_to        TEXT REFERENCES agents(id) ON DELETE SET NULL,
        skills_json         TEXT NOT NULL DEFAULT '[]',
        tasks_completed     INTEGER NOT NULL DEFAULT 0,
        total_runtime_minutes INTEGER NOT NULL DEFAULT 0,
        last_heartbeat      TEXT,
        created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        archived_at         TEXT,
        UNIQUE(project_id, name)
      );

      CREATE TABLE tasks (
        id                  TEXT PRIMARY KEY,
        project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        sprint_id           TEXT REFERENCES sprints(id) ON DELETE SET NULL,
        parent_task_id      TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        title               TEXT NOT NULL,
        description         TEXT NOT NULL DEFAULT '',
        priority            TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
        type                TEXT NOT NULL DEFAULT 'feature' CHECK (type IN ('feature','bug','research','infrastructure','directive')),
        status              TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog','on_deck','in_progress','review','done','blocked')),
        column_order        INTEGER NOT NULL DEFAULT 0,
        assignee_agent_id   TEXT REFERENCES agents(id) ON DELETE SET NULL,
        assigned_at         TEXT,
        created_by          TEXT NOT NULL,
        labels_json         TEXT NOT NULL DEFAULT '[]',
        depends_on_json     TEXT NOT NULL DEFAULT '[]',
        started_at          TEXT,
        completed_at        TEXT,
        review_notes        TEXT,
        blocked_reason      TEXT,
        paperclip_issue_id  TEXT,
        execution_mode      TEXT NOT NULL DEFAULT 'manual' CHECK (execution_mode IN ('paperclip','openclaw','manual')),
        execution_session_id TEXT,
        created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        archived_at         TEXT
      );

      CREATE TABLE comments (
        id              TEXT PRIMARY KEY,
        task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        author_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        author_user_id  TEXT,
        body            TEXT NOT NULL,
        type            TEXT NOT NULL DEFAULT 'comment' CHECK (type IN ('comment','status_update','code_link','review','blocker')),
        created_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at      TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE TABLE task_events (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id        TEXT REFERENCES agents(id) ON DELETE SET NULL,
        user_id         TEXT,
        event_type      TEXT NOT NULL,
        from_status     TEXT,
        to_status       TEXT,
        metadata_json   TEXT NOT NULL DEFAULT '{}',
        created_at      TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE TABLE status_transition_rules (
        from_status         TEXT NOT NULL,
        to_status           TEXT NOT NULL,
        requires_assignee   INTEGER NOT NULL DEFAULT 0 CHECK (requires_assignee IN (0,1)),
        requires_review     INTEGER NOT NULL DEFAULT 0 CHECK (requires_review IN (0,1)),
        is_terminal         INTEGER NOT NULL DEFAULT 0 CHECK (is_terminal IN (0,1)),
        PRIMARY KEY (from_status, to_status)
      );

      INSERT INTO status_transition_rules (from_status, to_status, requires_assignee, requires_review, is_terminal) VALUES
        ('backlog', 'on_deck', 0, 0, 0),
        ('backlog', 'blocked', 0, 0, 1),
        ('on_deck', 'backlog', 0, 0, 0),
        ('on_deck', 'in_progress', 1, 0, 0),
        ('on_deck', 'blocked', 0, 0, 1),
        ('in_progress', 'review', 0, 0, 0),
        ('in_progress', 'blocked', 0, 0, 1),
        ('in_progress', 'on_deck', 0, 0, 0),
        ('review', 'done', 0, 1, 1),
        ('review', 'in_progress', 0, 1, 0),
        ('review', 'blocked', 0, 0, 1),
        ('blocked', 'on_deck', 0, 0, 0),
        ('blocked', 'in_progress', 1, 0, 0),
        ('done', 'review', 0, 0, 0);
    `,
  },
  {
    version: 2,
    name: "indexes_and_default_themes_constraint",
    sql: `
      CREATE INDEX idx_projects_status ON projects(status);
      CREATE INDEX idx_projects_updated_at ON projects(updated_at DESC);

      CREATE INDEX idx_avatar_themes_project_id ON avatar_themes(project_id);
      CREATE UNIQUE INDEX idx_avatar_themes_single_default
        ON avatar_themes(project_id)
        WHERE is_default = 1;

      CREATE INDEX idx_agents_project_status ON agents(project_id, status);
      CREATE INDEX idx_agents_project_name ON agents(project_id, name);

      CREATE INDEX idx_sprints_project_status ON sprints(project_id, status);

      CREATE INDEX idx_tasks_project_status_order ON tasks(project_id, status, column_order ASC, created_at ASC);
      CREATE INDEX idx_tasks_project_updated ON tasks(project_id, updated_at DESC);
      CREATE INDEX idx_tasks_assignee_status ON tasks(assignee_agent_id, status);
      CREATE INDEX idx_tasks_sprint_id ON tasks(sprint_id);
      CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id);

      CREATE INDEX idx_comments_task_created_at ON comments(task_id, created_at ASC);
      CREATE INDEX idx_task_events_project_created_at ON task_events(project_id, created_at DESC);
      CREATE INDEX idx_task_events_task_created_at ON task_events(task_id, created_at DESC);
    `,
  },
  {
    version: 3,
    name: "companies_schema_and_project_link",
    compatibleChecksums: [
      // Legacy checksum from pre-cleanup DB state.
      "46dd2645b3138d8abe580a2023e84dc690471d455c0c17dd25f44d80dc9b660c",
      // Public-share bootstrap before neutral default company labels.
      "a921c76bfecb83095806ac496cce907ecef16c82ca455c8c3c7332dcfe15a99f",
      // Live dev DB checksum before the public-share bootstrap neutralization.
      "1195037abe381ed4d06d5cb28279614c976489e2b8484ceb15fc503e1f89f615",
    ],
    sql: `
      CREATE TABLE companies (
        id                      TEXT PRIMARY KEY,
        slug                    TEXT NOT NULL UNIQUE,
        name                    TEXT NOT NULL,
        description             TEXT NOT NULL DEFAULT '',
        status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
        theme_name              TEXT NOT NULL DEFAULT 'Corporate Noir',
        theme_prompt_template   TEXT NOT NULL DEFAULT 'dark premium portrait, cohesive team style',
        theme_keywords_json     TEXT NOT NULL DEFAULT '[]',
        theme_sample_url        TEXT,
        created_at              TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at              TEXT NOT NULL DEFAULT (${NOW_SQL}),
        archived_at             TEXT
      );

      ALTER TABLE projects ADD COLUMN company_id TEXT REFERENCES companies(id) ON DELETE SET NULL;
      CREATE INDEX idx_projects_company_id ON projects(company_id);

      INSERT OR IGNORE INTO companies
        (id, slug, name, description, status, theme_name, theme_prompt_template, theme_keywords_json, created_at, updated_at)
      VALUES
        (
          '${DEFAULT_COMPANY_ID}',
          '${DEFAULT_COMPANY_SLUG}',
          '${DEFAULT_COMPANY_NAME}',
          '${DEFAULT_COMPANY_DESCRIPTION}',
          'active',
          'HiveRunner Default',
          'clean professional avatar, neutral local workspace style',
          '["professional","neutral","workspace"]',
          ${NOW_SQL},
          ${NOW_SQL}
        );

      UPDATE projects
      SET company_id = '${DEFAULT_COMPANY_ID}'
      WHERE company_id IS NULL;
    `,
  },
  {
    version: 4,
    name: "comment_source_external_ref_for_bridge_sync",
    sql: `
      ALTER TABLE comments ADD COLUMN source TEXT NOT NULL DEFAULT 'mission_control';
      ALTER TABLE comments ADD COLUMN external_ref TEXT;

      CREATE INDEX idx_comments_task_source_created_at
        ON comments(task_id, source, created_at ASC);

      CREATE UNIQUE INDEX idx_comments_task_source_external_ref
        ON comments(task_id, source, external_ref)
        WHERE external_ref IS NOT NULL;
    `,
  },
  {
    version: 6,
    name: "fix_status_transition_rules_v2",
    sql: `
      -- Add direct in_progress → done transition (spec says "no review confirmation" path must exist)
      INSERT OR IGNORE INTO status_transition_rules (from_status, to_status, requires_assignee, requires_review, is_terminal)
        VALUES ('in_progress', 'done', 0, 0, 1);

      -- Fix review → done: remove requires_review constraint since UI has no mechanism to provide notes
      UPDATE status_transition_rules
        SET requires_review = 0
        WHERE from_status = 'review' AND to_status = 'done';

      -- Fix review → in_progress: same — UI cannot submit review notes on this transition
      UPDATE status_transition_rules
        SET requires_review = 0
        WHERE from_status = 'review' AND to_status = 'in_progress';
    `,
  },
  {
    version: 7,
    name: "agents_company_scope_and_optional_home_project",
    sql: `
      PRAGMA foreign_keys = OFF;

      DROP INDEX IF EXISTS idx_agents_project_status;
      DROP INDEX IF EXISTS idx_agents_project_name;

      CREATE TABLE agents_new (
        id                    TEXT PRIMARY KEY,
        company_id            TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        project_id            TEXT REFERENCES projects(id) ON DELETE SET NULL,
        name                  TEXT NOT NULL,
        emoji                 TEXT,
        role                  TEXT NOT NULL,
        personality           TEXT NOT NULL DEFAULT '',
        avatar_url            TEXT,
        status                TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','working','paused','offline','error')),
        current_task_id       TEXT,
        model                 TEXT,
        openclaw_agent_id     TEXT UNIQUE,
        paperclip_agent_id    TEXT UNIQUE,
        reporting_to          TEXT REFERENCES agents_new(id) ON DELETE SET NULL,
        skills_json           TEXT NOT NULL DEFAULT '[]',
        tasks_completed       INTEGER NOT NULL DEFAULT 0,
        total_runtime_minutes INTEGER NOT NULL DEFAULT 0,
        last_heartbeat        TEXT,
        created_at            TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at            TEXT NOT NULL DEFAULT (${NOW_SQL}),
        archived_at           TEXT
      );

      INSERT INTO agents_new (
        id,
        company_id,
        project_id,
        name,
        emoji,
        role,
        personality,
        avatar_url,
        status,
        current_task_id,
        model,
        openclaw_agent_id,
        paperclip_agent_id,
        reporting_to,
        skills_json,
        tasks_completed,
        total_runtime_minutes,
        last_heartbeat,
        created_at,
        updated_at,
        archived_at
      )
      SELECT
        a.id,
        COALESCE(p.company_id, '${DEFAULT_COMPANY_ID}') AS company_id,
        a.project_id,
        a.name,
        a.emoji,
        a.role,
        a.personality,
        a.avatar_url,
        a.status,
        a.current_task_id,
        a.model,
        a.openclaw_agent_id,
        a.paperclip_agent_id,
        a.reporting_to,
        a.skills_json,
        a.tasks_completed,
        a.total_runtime_minutes,
        a.last_heartbeat,
        a.created_at,
        a.updated_at,
        a.archived_at
      FROM agents a
      LEFT JOIN projects p ON p.id = a.project_id;

      DROP TABLE agents;
      ALTER TABLE agents_new RENAME TO agents;

      CREATE INDEX idx_agents_company_status ON agents(company_id, status);
      CREATE INDEX idx_agents_company_name ON agents(company_id, name);
      CREATE INDEX idx_agents_project_status ON agents(project_id, status);
      CREATE INDEX idx_agents_project_name ON agents(project_id, name);

      PRAGMA foreign_keys = ON;
    `,
  },
  {
    version: 8,
    name: "execution_runs_first_class_lifecycle_records",
    sql: `
      CREATE TABLE execution_runs (
        id                TEXT PRIMARY KEY,
        task_id           TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id          TEXT REFERENCES agents(id) ON DELETE SET NULL,
        provider          TEXT NOT NULL CHECK (provider IN ('openclaw','paperclip')),
        session_id        TEXT,
        status            TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
        started_at        TEXT,
        completed_at      TEXT,
        error_message     TEXT,
        token_usage_json  TEXT NOT NULL DEFAULT '{}',
        duration_ms       INTEGER,
        idempotency_key   TEXT,
        created_at        TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at        TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX idx_execution_runs_task_created_at
        ON execution_runs(task_id, created_at DESC);

      CREATE INDEX idx_execution_runs_task_status
        ON execution_runs(task_id, status);

      CREATE INDEX idx_execution_runs_provider_status
        ON execution_runs(provider, status);

      CREATE UNIQUE INDEX idx_execution_runs_idempotency_key
        ON execution_runs(idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `,
  },
  {
    version: 9,
    name: "tasks_add_maintenance_type",
    sql: `
      PRAGMA foreign_keys = OFF;

      CREATE TABLE tasks_new (
        id                  TEXT PRIMARY KEY,
        project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        sprint_id           TEXT REFERENCES sprints(id) ON DELETE SET NULL,
        parent_task_id      TEXT REFERENCES tasks_new(id) ON DELETE SET NULL,
        title               TEXT NOT NULL,
        description         TEXT NOT NULL DEFAULT '',
        priority            TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
        type                TEXT NOT NULL DEFAULT 'feature' CHECK (type IN ('feature','bug','maintenance','research','infrastructure','directive')),
        status              TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog','on_deck','in_progress','review','done','blocked')),
        column_order        INTEGER NOT NULL DEFAULT 0,
        assignee_agent_id   TEXT REFERENCES agents(id) ON DELETE SET NULL,
        assigned_at         TEXT,
        created_by          TEXT NOT NULL,
        labels_json         TEXT NOT NULL DEFAULT '[]',
        depends_on_json     TEXT NOT NULL DEFAULT '[]',
        started_at          TEXT,
        completed_at        TEXT,
        review_notes        TEXT,
        blocked_reason      TEXT,
        paperclip_issue_id  TEXT,
        execution_mode      TEXT NOT NULL DEFAULT 'manual' CHECK (execution_mode IN ('paperclip','openclaw','manual')),
        execution_session_id TEXT,
        created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        archived_at         TEXT
      );

      INSERT INTO tasks_new (
        id, project_id, sprint_id, parent_task_id, title, description, priority, type, status,
        column_order, assignee_agent_id, assigned_at, created_by, labels_json, depends_on_json, started_at,
        completed_at, review_notes, blocked_reason, paperclip_issue_id, execution_mode, execution_session_id,
        created_at, updated_at, archived_at
      )
      SELECT
        id, project_id, sprint_id, parent_task_id, title, description, priority, type, status,
        column_order, assignee_agent_id, assigned_at, created_by, labels_json, depends_on_json, started_at,
        completed_at, review_notes, blocked_reason, paperclip_issue_id, execution_mode, execution_session_id,
        created_at, updated_at, archived_at
      FROM tasks;

      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;

      CREATE INDEX idx_tasks_project_status_order ON tasks(project_id, status, column_order ASC, created_at ASC);
      CREATE INDEX idx_tasks_project_updated ON tasks(project_id, updated_at DESC);
      CREATE INDEX idx_tasks_assignee_status ON tasks(assignee_agent_id, status);
      CREATE INDEX idx_tasks_sprint_id ON tasks(sprint_id);
      CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id);

      PRAGMA foreign_keys = ON;
    `,
  },
  {
    version: 10,
    name: "tasks_add_source_review_takeaway_ids",
    sql: `
      ALTER TABLE tasks ADD COLUMN source_review_id TEXT;
      ALTER TABLE tasks ADD COLUMN source_takeaway_id TEXT;

      CREATE INDEX idx_tasks_source_review_id
        ON tasks(source_review_id)
        WHERE source_review_id IS NOT NULL;

      CREATE INDEX idx_tasks_source_takeaway_id
        ON tasks(source_takeaway_id)
        WHERE source_takeaway_id IS NOT NULL;
    `,
  },
  {
    version: 11,
    name: "ideas_reviews_takeaways_store",
    sql: `
      CREATE TABLE IF NOT EXISTS ideas_reviews (
        id                TEXT PRIMARY KEY,
        type              TEXT NOT NULL DEFAULT 'manual',
        url               TEXT NOT NULL DEFAULT '',
        title             TEXT NOT NULL DEFAULT '',
        channel           TEXT NOT NULL DEFAULT '',
        thumbnail         TEXT NOT NULL DEFAULT '',
        duration          TEXT NOT NULL DEFAULT '',
        reviewed_at       TEXT,
        submitted_by      TEXT NOT NULL DEFAULT '',
        status            TEXT NOT NULL DEFAULT 'active',
        summary           TEXT NOT NULL DEFAULT '',
        assessment        TEXT NOT NULL DEFAULT '',
        rating            REAL NOT NULL DEFAULT 0,
        screenshot_count  INTEGER,
        extra_json        TEXT NOT NULL DEFAULT '{}',
        created_at        TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at        TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE TABLE IF NOT EXISTS ideas_takeaways (
        id                TEXT PRIMARY KEY,
        review_id         TEXT NOT NULL REFERENCES ideas_reviews(id) ON DELETE CASCADE,
        sort_order        INTEGER NOT NULL DEFAULT 0,
        title             TEXT NOT NULL DEFAULT '',
        description       TEXT NOT NULL DEFAULT '',
        video_timestamp   TEXT NOT NULL DEFAULT '',
        video_url         TEXT NOT NULL DEFAULT '',
        video_context     TEXT NOT NULL DEFAULT '',
        priority          TEXT NOT NULL DEFAULT '',
        effort            TEXT NOT NULL DEFAULT '',
        assigned_to       TEXT NOT NULL DEFAULT '',
        status            TEXT NOT NULL DEFAULT 'idea',
        notes             TEXT NOT NULL DEFAULT '',
        github_issue      TEXT NOT NULL DEFAULT '',
        extra_json        TEXT NOT NULL DEFAULT '{}',
        created_at        TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at        TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX IF NOT EXISTS idx_ideas_reviews_status_reviewed_at
        ON ideas_reviews(status, reviewed_at DESC, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_ideas_takeaways_review_sort
        ON ideas_takeaways(review_id, sort_order ASC, created_at ASC);

      CREATE INDEX IF NOT EXISTS idx_ideas_takeaways_status
        ON ideas_takeaways(status);

      CREATE TABLE IF NOT EXISTS ideas_meta (
        key         TEXT PRIMARY KEY,
        value_json  TEXT NOT NULL,
        updated_at  TEXT NOT NULL DEFAULT (${NOW_SQL})
      );
    `,
  },
  {
    version: 12,
    name: "archive_test_debug_junk_data",
    compatibleChecksums: [
      "1450d2f3b2676fc3205227803605b10fbcd795d1e7428afcb112a9ed751d1fb8",
    ],
    sql: `
      -- Soft-archive all non-production companies (test, debug, agent-test, cp-test, etc.)
      UPDATE companies
      SET status = 'archived',
          archived_at = ${NOW_SQL},
          updated_at = ${NOW_SQL}
      WHERE id != '${DEFAULT_COMPANY_ID}'
        AND archived_at IS NULL
        AND (
          slug LIKE 'agent-test-%'
          OR slug LIKE 'cp-test-%'
          OR slug LIKE 'debug-%'
          OR slug LIKE 'test-%'
          OR name LIKE '[AGENT-TEST]%'
          OR name LIKE '[CP-TEST]%'
          OR name LIKE '[TEST-VIGIL]%'
          OR name LIKE '[DEBUG]%'
          OR name LIKE 'Test Company%'
        );

      -- Soft-archive all non-production projects linked to those companies
      UPDATE projects
      SET status = 'archived',
          archived_at = ${NOW_SQL},
          updated_at = ${NOW_SQL}
      WHERE archived_at IS NULL
        AND company_id IN (
          SELECT id FROM companies
          WHERE id != '${DEFAULT_COMPANY_ID}' AND archived_at IS NOT NULL
        );

      -- Soft-archive junk agents: Duplicate Agent, Forge QA, Guard Agent, Error Agent,
      -- Cross Project Agent, Test Agent, numbered Agent-N, Graduation Test, [CP-TEST], Forge Prime
      UPDATE agents
      SET archived_at = ${NOW_SQL},
          updated_at = ${NOW_SQL}
      WHERE archived_at IS NULL
        AND (
          name LIKE 'Duplicate Agent%'
          OR name LIKE 'Forge QA%'
          OR name LIKE 'Guard Agent%'
          OR name LIKE 'Error Agent%'
          OR name LIKE 'Cross Project Agent%'
          OR name LIKE 'Test Agent%'
          OR name LIKE '[CP-TEST]%'
          OR name LIKE '[AGENT-TEST]%'
          OR name LIKE 'Graduation Test%'
          OR name LIKE 'Forge Prime%'
          OR name GLOB 'Agent-[0-9]*'
        );

      -- Also archive agents belonging to archived non-production companies
      UPDATE agents
      SET archived_at = ${NOW_SQL},
          updated_at = ${NOW_SQL}
      WHERE archived_at IS NULL
        AND company_id IN (
          SELECT id FROM companies
          WHERE id != '${DEFAULT_COMPANY_ID}' AND archived_at IS NOT NULL
      );
    `,
  },
  {
    version: 13,
    name: "companies_workspace_binding_contract",
    sql: `
      ALTER TABLE companies ADD COLUMN workspace_root TEXT;
      ALTER TABLE companies ADD COLUMN workspace_source TEXT NOT NULL DEFAULT 'manual'
        CHECK (workspace_source IN ('openclaw','provisioned','imported','manual'));

      CREATE UNIQUE INDEX idx_companies_workspace_root_unique
        ON companies(workspace_root)
        WHERE workspace_root IS NOT NULL AND TRIM(workspace_root) <> '';

      UPDATE companies
      SET
        workspace_root = CASE
          WHEN id = '${DEFAULT_COMPANY_ID}' THEN '${DEFAULT_OPENCLAW_WORKSPACE_ROOT}'
          WHEN workspace_root IS NULL OR TRIM(workspace_root) = '' THEN '${DEFAULT_OPENCLAW_WORKSPACE_ROOT}/companies/' || slug
          ELSE workspace_root
        END,
        workspace_source = CASE
          WHEN id = '${DEFAULT_COMPANY_ID}' THEN 'openclaw'
          WHEN workspace_source IS NULL OR TRIM(workspace_source) = '' OR workspace_source = 'manual' THEN 'provisioned'
          ELSE workspace_source
        END,
        updated_at = ${NOW_SQL}
      WHERE
        workspace_root IS NULL
        OR TRIM(workspace_root) = ''
        OR workspace_source IS NULL
        OR TRIM(workspace_source) = ''
        OR id = '${DEFAULT_COMPANY_ID}';
    `,
  },
  {
    version: 14,
    name: "avatar_themes_company_scope",
    sql: `
      PRAGMA foreign_keys = OFF;

      DROP INDEX IF EXISTS idx_avatar_themes_project_id;
      DROP INDEX IF EXISTS idx_avatar_themes_single_default;

      CREATE TABLE avatar_themes_new (
        id                  TEXT PRIMARY KEY,
        company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name                TEXT NOT NULL,
        prompt_template     TEXT NOT NULL,
        style_keywords_json TEXT NOT NULL DEFAULT '[]',
        sample_url          TEXT,
        is_default          INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        UNIQUE(company_id, name)
      );

      INSERT OR IGNORE INTO avatar_themes_new (
        id,
        company_id,
        name,
        prompt_template,
        style_keywords_json,
        sample_url,
        is_default,
        created_at,
        updated_at
      )
      SELECT
        at.id,
        COALESCE(p.company_id, '${DEFAULT_COMPANY_ID}') AS company_id,
        at.name,
        at.prompt_template,
        at.style_keywords_json,
        at.sample_url,
        0,
        at.created_at,
        at.updated_at
      FROM avatar_themes at
      LEFT JOIN projects p ON p.id = at.project_id;

      DROP TABLE avatar_themes;
      ALTER TABLE avatar_themes_new RENAME TO avatar_themes;

      CREATE INDEX idx_avatar_themes_company_id ON avatar_themes(company_id);
      CREATE UNIQUE INDEX idx_avatar_themes_single_default
        ON avatar_themes(company_id)
        WHERE is_default = 1;

      PRAGMA foreign_keys = ON;
    `,
  },
  {
    version: 15,
    name: "companies_add_company_code",
    compatibleChecksums: [
      // Public-share bootstrap before neutral default company code.
      "6ec060035c8f72cdaf5f58cde574fc2bdfc3e2592424e8a4177b33c5a024b378",
      // Live dev DB checksum before the public-share bootstrap neutralization.
      "5448f16c449239a69abd8a18525716c42ee3b39c636fd41fc0734f15cbfca3fe",
    ],
    sql: `
      ALTER TABLE companies ADD COLUMN company_code TEXT;

      UPDATE companies
      SET company_code = CASE
        WHEN id = '${DEFAULT_COMPANY_ID}' THEN '${DEFAULT_COMPANY_CODE}'
        ELSE UPPER(SUBSTR(REPLACE(REPLACE(REPLACE(name, ' ', ''), '-', ''), '_', ''), 1, 3))
      END
      WHERE company_code IS NULL OR TRIM(company_code) = '';

      CREATE UNIQUE INDEX idx_companies_company_code_unique
        ON companies(company_code)
        WHERE company_code IS NOT NULL AND TRIM(company_code) <> '';
    `,
  },
  {
    version: 16,
    name: "agents_add_slug",
    sql: `
      ALTER TABLE agents ADD COLUMN slug TEXT;

      UPDATE agents
      SET slug = LOWER(
        REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(name),
          ' ', '-'), '_', '-'), '.', '-'), '''', ''), '"', '')
      )
      WHERE slug IS NULL OR TRIM(slug) = '';

      CREATE UNIQUE INDEX idx_agents_company_slug_unique
        ON agents(company_id, slug)
        WHERE slug IS NOT NULL AND TRIM(slug) <> '';
    `,
  },
  {
    version: 24,
    name: "tasks_add_task_key",
    sql: `
      -- Add a company-scoped sequential number and human-readable key (e.g. NEV-42)
      ALTER TABLE tasks ADD COLUMN task_number INTEGER;
      ALTER TABLE tasks ADD COLUMN task_key TEXT;

      -- Backfill: assign company-scoped sequential numbers ordered by created_at
      -- We use a CTE to compute a row number across ALL tasks for the same company
      WITH ranked AS (
        SELECT
          t.id AS task_id,
          ROW_NUMBER() OVER (
            PARTITION BY p.company_id
            ORDER BY t.created_at ASC, t.id ASC
          ) AS rn
        FROM tasks t
        INNER JOIN projects p ON p.id = t.project_id
      )
      UPDATE tasks
      SET task_number = (SELECT rn FROM ranked WHERE ranked.task_id = tasks.id);

      -- Backfill: generate human-readable keys using the company code
      UPDATE tasks
      SET task_key = (
        SELECT COALESCE(c.company_code, UPPER(SUBSTR(REPLACE(REPLACE(REPLACE(c.name, ' ', ''), '-', ''), '_', ''), 1, 3)))
          || '-' || tasks.task_number
        FROM projects p
        INNER JOIN companies c ON c.id = p.company_id
        WHERE p.id = tasks.project_id
      )
      WHERE task_number IS NOT NULL;

      CREATE UNIQUE INDEX idx_tasks_task_key
        ON tasks(task_key)
        WHERE task_key IS NOT NULL AND TRIM(task_key) <> '';
    `,
  },
  {
    version: 25,
    name: "inbox_read_state_canonical_event_ids",
    sql: `
      CREATE TABLE IF NOT EXISTS inbox_read_state (
        id          TEXT PRIMARY KEY,
        company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        user_id     TEXT NOT NULL,
        event_id    TEXT NOT NULL,
        read_at     TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_read_state_company_user_event
        ON inbox_read_state(company_id, user_id, event_id);

      -- Clear stale read-state entries that used hashed UUIDs as event_id.
      -- The canonical format is now the raw composite key ('task:uuid' / 'execution:uuid').
      -- Entries with hashed UUIDs will never match the feed CTE's composite keys.
      DELETE FROM inbox_read_state
      WHERE event_id NOT LIKE 'task:%' AND event_id NOT LIKE 'execution:%';
    `,
    // Legacy checksum from initial DB initialization (pre-Turbopack build context).
    compatibleChecksums: [
      "5f37d971bb1bda4882c518a36053a9ac7e13c8fb5f2ecb9b0cb8b246b3539e75",
      "2a8b1c080e38c93a8e0661e977771eb5f768147068133e93f4aa3797799955ea",
    ],
  },
  {
    version: 26,
    name: "sprint_parent_id_and_owner",
    sql: `
      ALTER TABLE sprints ADD COLUMN parent_id TEXT REFERENCES sprints(id) ON DELETE SET NULL;
      ALTER TABLE sprints ADD COLUMN owner TEXT DEFAULT NULL;
      CREATE INDEX IF NOT EXISTS idx_sprints_parent_id ON sprints(parent_id);
    `,
  },
  {
    version: 27,
    name: "routines_and_routine_runs",
    sql: `
      CREATE TABLE IF NOT EXISTS routines (
        id                  TEXT PRIMARY KEY,
        company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        project_id          TEXT REFERENCES projects(id) ON DELETE SET NULL,
        assignee_agent_id   TEXT REFERENCES agents(id) ON DELETE SET NULL,
        title               TEXT NOT NULL,
        description         TEXT NOT NULL DEFAULT '',
        priority            TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
        status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
        concurrency_policy  TEXT NOT NULL DEFAULT 'coalesce_if_active' CHECK (concurrency_policy IN ('coalesce_if_active','always_enqueue','skip_if_active')),
        catch_up_policy     TEXT NOT NULL DEFAULT 'skip_missed' CHECK (catch_up_policy IN ('skip_missed','enqueue_missed_with_cap')),
        created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at          TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE TABLE IF NOT EXISTS routine_runs (
        id              TEXT PRIMARY KEY,
        routine_id      TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
        company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','schedule','webhook','api')),
        status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
        triggered_at    TEXT NOT NULL DEFAULT (${NOW_SQL}),
        completed_at    TEXT,
        failure_reason  TEXT,
        created_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at      TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX IF NOT EXISTS idx_routines_company_status ON routines(company_id, status);
      CREATE INDEX IF NOT EXISTS idx_routines_company_project ON routines(company_id, project_id);
      CREATE INDEX IF NOT EXISTS idx_routine_runs_routine ON routine_runs(routine_id, created_at DESC);
    `,
  },
  {
    version: 28,
    name: "approvals",
    sql: `
      CREATE TABLE IF NOT EXISTS approvals (
        id                      TEXT PRIMARY KEY,
        company_id              TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        type                    TEXT NOT NULL CHECK (type IN ('hire_agent')),
        status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
        requested_by_agent_id   TEXT REFERENCES agents(id) ON DELETE SET NULL,
        payload_json            TEXT NOT NULL DEFAULT '{}',
        decision_note           TEXT,
        decided_by_user_id      TEXT,
        decided_at              TEXT,
        linked_task_id          TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        created_at              TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at              TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX IF NOT EXISTS idx_approvals_company_status ON approvals(company_id, status);
      CREATE INDEX IF NOT EXISTS idx_approvals_company_type ON approvals(company_id, type);
      CREATE INDEX IF NOT EXISTS idx_approvals_linked_task ON approvals(linked_task_id);
    `,
  },
  {
    version: 29,
    name: "approval_comments_and_expanded_types",
    compatibleChecksums: [
      "4a21837797737c369483c12e941065afc8670834d6167f696b9ea7b94cd7388b",
    ],
    sql: `
      CREATE TABLE IF NOT EXISTS approval_comments (
        id                  TEXT PRIMARY KEY,
        company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        approval_id         TEXT NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
        author_agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
        author_user_id      TEXT,
        body                TEXT NOT NULL,
        created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at          TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX IF NOT EXISTS idx_approval_comments_approval ON approval_comments(approval_id, created_at);

      -- Recreate approvals table with expanded CHECK constraints
      CREATE TABLE IF NOT EXISTS approvals_new (
        id                      TEXT PRIMARY KEY,
        company_id              TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        type                    TEXT NOT NULL CHECK (type IN ('hire_agent','approve_ceo_strategy','budget_override_required')),
        status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','revision_requested','approved','rejected','cancelled')),
        requested_by_agent_id   TEXT REFERENCES agents(id) ON DELETE SET NULL,
        payload_json            TEXT NOT NULL DEFAULT '{}',
        decision_note           TEXT,
        decided_by_user_id      TEXT,
        decided_at              TEXT,
        linked_task_id          TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        created_at              TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at              TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      INSERT OR IGNORE INTO approvals_new SELECT * FROM approvals;
      DROP TABLE approvals;
      ALTER TABLE approvals_new RENAME TO approvals;

      CREATE INDEX IF NOT EXISTS idx_approvals_company_status ON approvals(company_id, status);
      CREATE INDEX IF NOT EXISTS idx_approvals_company_type ON approvals(company_id, type);
      CREATE INDEX IF NOT EXISTS idx_approvals_linked_task ON approvals(linked_task_id);
    `,
  },
  {
    version: 30,
    name: "fix_approvals_check_constraints",
    compatibleChecksums: ["manual"],
    sql: `
      -- This migration was applied manually to fix CHECK constraints.
      -- The approvals table now allows revision_requested status and additional types.
      -- No-op if already applied.
      SELECT 1;
    `,
  },
  {
    version: 31,
    name: "engine_wakeup_requests_task_sessions_runtime_state",
    sql: `
      -- Agent wakeup request queue
      CREATE TABLE IF NOT EXISTS agent_wakeup_requests (
        id                    TEXT PRIMARY KEY,
        agent_id              TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        company_id            TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        source                TEXT NOT NULL CHECK (source IN ('timer','issue_assigned','routine','explicit','api','kickoff')),
        reason                TEXT,
        trigger_detail        TEXT,
        payload_json          TEXT NOT NULL DEFAULT '{}',
        status                TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','finished','failed')),
        coalesced_count       INTEGER NOT NULL DEFAULT 0,
        idempotency_key       TEXT,
        run_id                TEXT,
        requested_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        claimed_at            TEXT,
        finished_at           TEXT,
        requested_by_actor_type TEXT,
        requested_by_actor_id   TEXT,
        created_at            TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at            TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX IF NOT EXISTS idx_wakeup_requests_agent_status
        ON agent_wakeup_requests(agent_id, status);
      CREATE INDEX IF NOT EXISTS idx_wakeup_requests_company
        ON agent_wakeup_requests(company_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_wakeup_requests_idempotency
        ON agent_wakeup_requests(idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      -- Agent task sessions (persistent session state per task per agent)
      CREATE TABLE IF NOT EXISTS agent_task_sessions (
        id                    TEXT PRIMARY KEY,
        agent_id              TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        company_id            TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        adapter_type          TEXT NOT NULL DEFAULT 'openclaw',
        task_key              TEXT NOT NULL,
        session_params_json   TEXT NOT NULL DEFAULT '{}',
        session_display_id    TEXT,
        last_run_id           TEXT,
        last_error            TEXT,
        created_at            TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at            TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_task_sessions_unique
        ON agent_task_sessions(company_id, agent_id, adapter_type, task_key);
      CREATE INDEX IF NOT EXISTS idx_task_sessions_agent
        ON agent_task_sessions(agent_id);

      -- Agent runtime state (last known cumulative state per agent)
      CREATE TABLE IF NOT EXISTS agent_runtime_state (
        agent_id              TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
        company_id            TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        adapter_type          TEXT NOT NULL DEFAULT 'openclaw',
        session_id            TEXT,
        state_json            TEXT NOT NULL DEFAULT '{}',
        last_run_id           TEXT,
        last_run_status       TEXT,
        total_input_tokens    INTEGER NOT NULL DEFAULT 0,
        total_output_tokens   INTEGER NOT NULL DEFAULT 0,
        total_cost_cents      REAL NOT NULL DEFAULT 0,
        last_error            TEXT,
        created_at            TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at            TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      -- Heartbeat runs (execution records for agent wakeups)
      CREATE TABLE IF NOT EXISTS heartbeat_runs (
        id                    TEXT PRIMARY KEY,
        agent_id              TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        company_id            TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        invocation_source     TEXT NOT NULL CHECK (invocation_source IN ('on_demand','timer','issue_assigned','wakeup_request','kickoff')),
        trigger_detail        TEXT,
        status                TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled','timed_out')),
        started_at            TEXT,
        finished_at           TEXT,
        wakeup_request_id     TEXT REFERENCES agent_wakeup_requests(id) ON DELETE SET NULL,
        session_id_before     TEXT,
        session_id_after      TEXT,
        usage_json            TEXT NOT NULL DEFAULT '{}',
        result_json           TEXT NOT NULL DEFAULT '{}',
        exit_code             INTEGER,
        error                 TEXT,
        context_snapshot_json TEXT NOT NULL DEFAULT '{}',
        created_at            TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at            TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX IF NOT EXISTS idx_heartbeat_runs_agent_status
        ON heartbeat_runs(agent_id, status);
      CREATE INDEX IF NOT EXISTS idx_heartbeat_runs_company
        ON heartbeat_runs(company_id, created_at DESC);

      -- Add adapter/runtime config fields to agents
      ALTER TABLE agents ADD COLUMN adapter_type TEXT NOT NULL DEFAULT 'openclaw';
      ALTER TABLE agents ADD COLUMN adapter_config_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE agents ADD COLUMN runtime_config_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE agents ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE agents ADD COLUMN capabilities TEXT NOT NULL DEFAULT '';
      ALTER TABLE agents ADD COLUMN instructions_mode TEXT NOT NULL DEFAULT 'managed'
        CHECK (instructions_mode IN ('managed','external'));
    `,
  },
  {
    version: 32,
    name: "heartbeat_run_events",
    sql: `
      -- In-flight execution events emitted DURING a heartbeat run.
      -- Provides real-time action-by-action visibility for the dashboard.
      CREATE TABLE IF NOT EXISTS heartbeat_run_events (
        id         TEXT PRIMARY KEY,
        run_id     TEXT NOT NULL REFERENCES heartbeat_runs(id) ON DELETE CASCADE,
        agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        detail     TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (${NOW_SQL})
      );
      CREATE INDEX IF NOT EXISTS idx_hre_run_id
        ON heartbeat_run_events(run_id, created_at);
    `,
  },
  {
    version: 33,
    name: "provider_switch_audit",
    sql: `
      -- Audit columns for provider switching (Phase 2).
      -- provider_changed_at: when adapter_type was last changed (null = never switched)
      -- previous_adapter_type: what adapter_type was before the most recent switch (null = never switched)
      ALTER TABLE agents ADD COLUMN provider_changed_at TEXT;
      ALTER TABLE agents ADD COLUMN previous_adapter_type TEXT;
    `,
  },
  {
    version: 34,
    name: "execution_runs_add_codex_provider",
    sql: `
      -- Expand execution_runs.provider CHECK constraint to include 'codex'.
      -- SQLite cannot ALTER CHECK constraints, so we recreate the table.
      PRAGMA foreign_keys = OFF;

      CREATE TABLE execution_runs_new (
        id                TEXT PRIMARY KEY,
        task_id           TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id          TEXT REFERENCES agents(id) ON DELETE SET NULL,
        provider          TEXT NOT NULL CHECK (provider IN ('openclaw','paperclip','codex')),
        session_id        TEXT,
        status            TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
        started_at        TEXT,
        completed_at      TEXT,
        error_message     TEXT,
        token_usage_json  TEXT NOT NULL DEFAULT '{}',
        duration_ms       INTEGER,
        idempotency_key   TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO execution_runs_new SELECT * FROM execution_runs;
      DROP TABLE execution_runs;
      ALTER TABLE execution_runs_new RENAME TO execution_runs;

      CREATE INDEX idx_execution_runs_task_created_at
        ON execution_runs(task_id, created_at DESC);
      CREATE INDEX idx_execution_runs_task_status
        ON execution_runs(task_id, status);
      CREATE INDEX idx_execution_runs_provider_status
        ON execution_runs(provider, status);
      CREATE UNIQUE INDEX idx_execution_runs_idempotency_key
        ON execution_runs(idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      PRAGMA foreign_keys = ON;
    `,
  },
  {
    version: 35,
    name: "execution_runs_nullable_task_id",
    sql: `
      -- Make execution_runs.task_id nullable.
      --
      -- Architecturally, not all execution runs originate from orchestration tasks.
      -- Factory Codex builds (build-queue.ts) are real execution runs but operate
      -- on factory tasks (TASK-*) that have no orchestration DB counterpart.
      -- Nullable task_id allows these legitimate execution runs to be stored
      -- without fabricating an orchestration task relationship.
      --
      -- When task_id IS NOT NULL, the FK to tasks(id) still enforces integrity.
      -- When task_id IS NULL, the run is a provider execution without task context.

      PRAGMA foreign_keys = OFF;

      CREATE TABLE execution_runs_new (
        id                TEXT PRIMARY KEY,
        task_id           TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id          TEXT REFERENCES agents(id) ON DELETE SET NULL,
        provider          TEXT NOT NULL CHECK (provider IN ('openclaw','paperclip','codex')),
        session_id        TEXT,
        status            TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
        started_at        TEXT,
        completed_at      TEXT,
        error_message     TEXT,
        token_usage_json  TEXT NOT NULL DEFAULT '{}',
        duration_ms       INTEGER,
        idempotency_key   TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO execution_runs_new SELECT * FROM execution_runs;
      DROP TABLE execution_runs;
      ALTER TABLE execution_runs_new RENAME TO execution_runs;

      CREATE INDEX idx_execution_runs_task_created_at
        ON execution_runs(task_id, created_at DESC);
      CREATE INDEX idx_execution_runs_task_status
        ON execution_runs(task_id, status);
      CREATE INDEX idx_execution_runs_provider_status
        ON execution_runs(provider, status);
      CREATE UNIQUE INDEX idx_execution_runs_idempotency_key
        ON execution_runs(idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      PRAGMA foreign_keys = ON;
    `,
  },
  {
    version: 36,
    name: "inbox_read_state_archived_at",
    sql: `
      ALTER TABLE inbox_read_state ADD COLUMN archived_at TEXT;
    `,
  },
  {
    version: 37,
    name: "execution_runs_add_anthropic_provider",
    sql: `
      -- Expand execution_runs.provider CHECK constraint to include 'anthropic'.
      -- SQLite cannot ALTER CHECK constraints, so we recreate the table.
      PRAGMA foreign_keys = OFF;

      CREATE TABLE execution_runs_new (
        id                TEXT PRIMARY KEY,
        task_id           TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id          TEXT REFERENCES agents(id) ON DELETE SET NULL,
        provider          TEXT NOT NULL CHECK (provider IN ('openclaw','paperclip','codex','anthropic')),
        session_id        TEXT,
        status            TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
        started_at        TEXT,
        completed_at      TEXT,
        error_message     TEXT,
        token_usage_json  TEXT NOT NULL DEFAULT '{}',
        duration_ms       INTEGER,
        idempotency_key   TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO execution_runs_new SELECT * FROM execution_runs;
      DROP TABLE execution_runs;
      ALTER TABLE execution_runs_new RENAME TO execution_runs;

      CREATE INDEX idx_execution_runs_task_created_at
        ON execution_runs(task_id, created_at DESC);
      CREATE INDEX idx_execution_runs_task_status
        ON execution_runs(task_id, status);
      CREATE INDEX idx_execution_runs_provider_status
        ON execution_runs(provider, status);
      CREATE UNIQUE INDEX idx_execution_runs_idempotency_key
        ON execution_runs(idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      PRAGMA foreign_keys = ON;
    `,
  },
  {
    version: 38,
    name: "company_slug_aliases",
    compatibleChecksums: [
      // Public-share bootstrap before legacy aliases were gated to legacy DBs.
      "86254c00b80cbbfcae36fca98224345c65d291689c7c079532c83b8acfa88515",
      // Live dev DB checksum before the public-share bootstrap neutralization.
      "4b4e613d3cdc2122921520b6cda70668b39964d475d442201a17bad7ddfb4ed3",
    ],
    sql: `
      CREATE TABLE company_slug_aliases (
        company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        slug_alias  TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (${NOW_SQL}),
        PRIMARY KEY (slug_alias)
      );

      CREATE INDEX idx_company_slug_aliases_company_id
        ON company_slug_aliases(company_id);

      -- Seed the known legacy alias: weather-edge was the old slug for NeverIdle Core.
      INSERT OR IGNORE INTO company_slug_aliases (company_id, slug_alias)
      SELECT id, 'weather-edge'
      FROM companies
      WHERE id = '${DEFAULT_COMPANY_ID}'
        AND slug = 'neveridle-core';
    `,
  },
  {
    version: 39,
    name: "project_slug_aliases",
    sql: `
      CREATE TABLE project_slug_aliases (
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        slug_alias  TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (${NOW_SQL}),
        PRIMARY KEY (slug_alias)
      );

      CREATE INDEX idx_project_slug_aliases_project_id
        ON project_slug_aliases(project_id);
    `,
  },
  {
    version: 40,
    name: "project_slug_company_scoped_unique",
    sql: `
      -- Project slugs should be unique within a company, not globally.
      -- URLs are /companies/{slug}/projects/{projectSlug} so two companies
      -- can safely share a project slug.
      --
      -- SQLite cannot drop a column-level UNIQUE constraint, so we recreate
      -- the table without it and add a compound unique index instead.

      CREATE TABLE projects_new (
        id              TEXT PRIMARY KEY,
        slug            TEXT NOT NULL,
        name            TEXT NOT NULL,
        description     TEXT NOT NULL DEFAULT '',
        color           TEXT NOT NULL DEFAULT '#0ea5e9',
        status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','paused','archived')),
        owner_user_id   TEXT,
        settings_json   TEXT NOT NULL DEFAULT '{}',
        created_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        archived_at     TEXT,
        company_id      TEXT REFERENCES companies(id) ON DELETE SET NULL
      );

      INSERT INTO projects_new
        SELECT id, slug, name, description, color, status,
               owner_user_id, settings_json, created_at, updated_at,
               archived_at, company_id
        FROM projects;

      DROP TABLE projects;
      ALTER TABLE projects_new RENAME TO projects;

      -- Company-scoped slug uniqueness (only for non-archived projects)
      CREATE UNIQUE INDEX idx_projects_company_slug
        ON projects(company_id, slug) WHERE archived_at IS NULL;

      -- Restore the other indexes that were on the original table
      CREATE INDEX idx_projects_status ON projects(status);
      CREATE INDEX idx_projects_updated_at ON projects(updated_at DESC);
      CREATE INDEX idx_projects_company_id ON projects(company_id);
    `,
  },
  {
    version: 41,
    name: "companies_add_workspace_slug",
    sql: `
      ALTER TABLE companies ADD COLUMN workspace_slug TEXT;

      UPDATE companies
      SET workspace_slug = slug
      WHERE workspace_slug IS NULL OR TRIM(workspace_slug) = '';
    `,
  },
  {
    version: 42,
    name: "dev_execution_test_leases",
    sql: `
      CREATE TABLE IF NOT EXISTS dev_execution_test_leases (
        company_id     TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
        enabled_at     TEXT NOT NULL DEFAULT (${NOW_SQL}),
        enabled_until  TEXT NOT NULL,
        enabled_by     TEXT,
        note           TEXT,
        created_at     TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at     TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX IF NOT EXISTS idx_dev_execution_test_leases_enabled_until
        ON dev_execution_test_leases(enabled_until);
    `,
  },
  {
    version: 43,
    name: "runtime_identity_slugs",
    sql: `
      ALTER TABLE companies ADD COLUMN runtime_slug TEXT;

      UPDATE companies
      SET runtime_slug = COALESCE(
        NULLIF(TRIM(workspace_slug), ''),
        NULLIF(TRIM(slug), ''),
        'company-' || substr(lower(replace(id, '-', '')), 1, 8)
      )
      WHERE runtime_slug IS NULL OR TRIM(runtime_slug) = '';

      WITH company_dupes AS (
        SELECT
          id,
          runtime_slug,
          substr(lower(replace(id, '-', '')), 1, 8) AS suffix,
          row_number() OVER (
            PARTITION BY runtime_slug
            ORDER BY created_at ASC, id ASC
          ) AS rn
        FROM companies
        WHERE runtime_slug IS NOT NULL AND TRIM(runtime_slug) != ''
      )
      UPDATE companies
      SET runtime_slug = runtime_slug || '-' || (
        SELECT suffix
        FROM company_dupes
        WHERE company_dupes.id = companies.id
      )
      WHERE id IN (
        SELECT id
        FROM company_dupes
        WHERE rn > 1
      );

      CREATE UNIQUE INDEX idx_companies_runtime_slug
        ON companies(runtime_slug);

      ALTER TABLE agents ADD COLUMN runtime_slug TEXT;

      UPDATE agents
      SET runtime_slug = COALESCE(
        NULLIF(TRIM(slug), ''),
        NULLIF(
          lower(
            replace(
              replace(
                replace(trim(name), ' ', '-'),
                '_',
                '-'
              ),
              '.',
              '-'
            )
          ),
          ''
        ),
        'agent-' || substr(lower(replace(id, '-', '')), 1, 8)
      )
      WHERE runtime_slug IS NULL OR TRIM(runtime_slug) = '';

      WITH agent_dupes AS (
        SELECT
          id,
          company_id,
          runtime_slug,
          substr(lower(replace(id, '-', '')), 1, 8) AS suffix,
          row_number() OVER (
            PARTITION BY company_id, runtime_slug
            ORDER BY created_at ASC, id ASC
          ) AS rn
        FROM agents
        WHERE runtime_slug IS NOT NULL AND TRIM(runtime_slug) != ''
      )
      UPDATE agents
      SET runtime_slug = runtime_slug || '-' || (
        SELECT suffix
        FROM agent_dupes
        WHERE agent_dupes.id = agents.id
      )
      WHERE id IN (
        SELECT id
        FROM agent_dupes
        WHERE rn > 1
      );

      CREATE UNIQUE INDEX idx_agents_company_runtime_slug
        ON agents(company_id, runtime_slug)
        WHERE runtime_slug IS NOT NULL;
    `,
  },
  {
    version: 44,
    name: "agents_avatar_identity_and_voice",
    sql: `
      ALTER TABLE agents ADD COLUMN avatar_style_id TEXT;
      ALTER TABLE agents ADD COLUMN avatar_gender TEXT;
      ALTER TABLE agents ADD COLUMN avatar_age INTEGER;
      ALTER TABLE agents ADD COLUMN avatar_hair_color TEXT;
      ALTER TABLE agents ADD COLUMN avatar_hair_length TEXT;
      ALTER TABLE agents ADD COLUMN avatar_eye_color TEXT;
      ALTER TABLE agents ADD COLUMN avatar_vibe TEXT;
      ALTER TABLE agents ADD COLUMN voice_id TEXT;
    `,
  },
  {
    version: 45,
    name: "allow_review_to_on_deck_transition",
    sql: `
      -- Product decision 2026-04-18: failed review routes back to on_deck
      -- (operator-facing "To-Do"), not in_progress. review→in_progress is
      -- reserved for live handoffs to a named agent. CEO reviewers need
      -- review→on_deck to push work back when criteria aren't met.
      INSERT OR IGNORE INTO status_transition_rules (from_status, to_status, requires_assignee, requires_review, is_terminal)
        VALUES ('review', 'on_deck', 0, 0, 0);
    `,
  },
  {
    version: 46,
    name: "add_consecutive_noop_wakes_counter",
    sql: `
      -- In-progress-loop circuit breaker (2026-04-18 late evening). Tracks
      -- consecutive wakes on a task that produced no structural progress
      -- (no task.status_changed / task.assigned / task.unassigned event).
      -- finishRun increments on no-op runs, resets on structural progress,
      -- and trips at 3 → flips task to blocked + emits [AWAITING_HUMAN]
      -- comment + skips continuation enqueue. moveTask (operator status
      -- change) resets the counter so manual unblocks start fresh. The
      -- sweeper has a defensive filter (< 3) as belt + suspenders; the
      -- blocked-status filter already excludes tripped tasks.
      ALTER TABLE tasks ADD COLUMN consecutive_noop_wakes INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_tasks_consecutive_noop_wakes
        ON tasks(consecutive_noop_wakes)
        WHERE consecutive_noop_wakes > 0;
    `,
  },
  {
    version: 47,
    name: "allow_on_deck_to_review_and_done_transitions",
    sql: `
      -- Product decision (CLAUDE.md): "Allow direct to-do → done transitions.
      -- Typical path remains to-do → in-progress → review → done, but rigid
      -- enforcement is wrong." Adds the two missing on_deck transitions.
      -- Concrete trigger: WEA-274 (2026-04-19) — Kelvin completed the task in
      -- a single heartbeat run, called update_task with status='review', and
      -- the rule check silently rejected the transition while the action
      -- handler reported "executed". Status stayed on_deck despite the
      -- "Ready for review" comment.
      INSERT OR IGNORE INTO status_transition_rules (from_status, to_status, requires_assignee, requires_review, is_terminal) VALUES
        ('on_deck', 'review', 0, 0, 0),
        ('on_deck', 'done',   0, 0, 1);
    `,
  },
  {
    version: 48,
    name: "task_artifact_registration_g5",
    sql: `
      -- G5 — Artifact registration on tasks. When a build-style subtask
      -- produces a deliverable (HTML report, PDF, generated file, URL), the
      -- agent registers it via the new \`register_artifact\` mc-action; the
      -- engine writes the URI + kind + content sha here. The sha is the
      -- input to G2's no-op resubmission detection: if an agent moves a task
      -- back to review after rework with an artifact_sha256 identical to
      -- the version present at rejection time, the engine auto-bounces.
      ALTER TABLE tasks ADD COLUMN artifact_uri TEXT;
      ALTER TABLE tasks ADD COLUMN artifact_kind TEXT;
      ALTER TABLE tasks ADD COLUMN artifact_registered_at TEXT;
      ALTER TABLE tasks ADD COLUMN artifact_sha256 TEXT;
    `,
  },
  {
    version: 49,
    name: "provider_neutral_agent_runtimes",
    sql: `
      -- HiveRunner-owned runtime registry. This is intentionally
      -- provider-neutral: OpenClaw is one provider row, not the identity
      -- model for every agent/runtime.
      CREATE TABLE IF NOT EXISTS agent_runtimes (
        id              TEXT PRIMARY KEY,
        company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        agent_id        TEXT REFERENCES agents(id) ON DELETE SET NULL,
        provider        TEXT NOT NULL,
        runtime_kind    TEXT NOT NULL DEFAULT 'cli'
          CHECK (runtime_kind IN ('cli','daemon','api','manual','external')),
        scope           TEXT NOT NULL DEFAULT 'agent'
          CHECK (scope IN ('company','agent','workspace','external')),
        runtime_slug    TEXT NOT NULL,
        display_name    TEXT NOT NULL,
        command         TEXT,
        version         TEXT,
        status          TEXT NOT NULL DEFAULT 'unknown'
          CHECK (status IN ('online','offline','unknown','error','disabled')),
        workspace_root  TEXT,
        metadata_json   TEXT NOT NULL DEFAULT '{}',
        last_seen_at    TEXT,
        created_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        UNIQUE(company_id, provider, runtime_slug)
      );

      CREATE INDEX idx_agent_runtimes_company_provider
        ON agent_runtimes(company_id, provider, status);
      CREATE INDEX idx_agent_runtimes_agent
        ON agent_runtimes(agent_id)
        WHERE agent_id IS NOT NULL;
      CREATE INDEX idx_agent_runtimes_status_last_seen
        ON agent_runtimes(status, last_seen_at DESC);

      WITH runtime_seed AS (
        SELECT
          a.id AS agent_id,
          a.company_id AS company_id,
          COALESCE(
            NULLIF(LOWER(TRIM(a.adapter_type)), ''),
            CASE
              WHEN NULLIF(TRIM(COALESCE(a.openclaw_agent_id, '')), '') IS NOT NULL THEN 'openclaw'
              WHEN NULLIF(TRIM(COALESCE(a.paperclip_agent_id, '')), '') IS NOT NULL THEN 'paperclip'
              ELSE 'manual'
            END
          ) AS provider,
          COALESCE(
            NULLIF(TRIM(a.runtime_slug), ''),
            NULLIF(TRIM(a.slug), ''),
            LOWER(REPLACE(TRIM(a.name), ' ', '-')),
            a.id
          ) AS runtime_slug,
          a.name AS agent_name,
          a.openclaw_agent_id AS openclaw_agent_id,
          a.paperclip_agent_id AS paperclip_agent_id,
          c.workspace_root AS workspace_root,
          a.adapter_config_json AS adapter_config_json,
          a.runtime_config_json AS runtime_config_json,
          a.created_at AS created_at,
          a.updated_at AS updated_at
        FROM agents a
        INNER JOIN companies c ON c.id = a.company_id
        WHERE a.archived_at IS NULL
      )
      INSERT OR IGNORE INTO agent_runtimes (
        id,
        company_id,
        agent_id,
        provider,
        runtime_kind,
        scope,
        runtime_slug,
        display_name,
        command,
        status,
        workspace_root,
        metadata_json,
        created_at,
        updated_at
      )
      SELECT
        'agent-runtime:' || agent_id || ':' || provider,
        company_id,
        agent_id,
        provider,
        CASE
          WHEN provider = 'manual' THEN 'manual'
          ELSE 'cli'
        END,
        'agent',
        runtime_slug,
        agent_name || ' runtime',
        CASE provider
          WHEN 'openclaw' THEN 'openclaw'
          WHEN 'paperclip' THEN 'paperclip'
          WHEN 'codex' THEN 'codex'
          WHEN 'anthropic' THEN 'claude'
          ELSE NULL
        END,
        CASE
          WHEN provider = 'openclaw'
            AND NULLIF(TRIM(COALESCE(openclaw_agent_id, '')), '') IS NULL
            THEN 'error'
          WHEN provider = 'paperclip'
            AND NULLIF(TRIM(COALESCE(paperclip_agent_id, '')), '') IS NULL
            THEN 'error'
          ELSE 'unknown'
        END,
        workspace_root,
        json_object(
          'seededFrom', 'agents',
          'openclawAgentId', openclaw_agent_id,
          'paperclipAgentId', paperclip_agent_id,
          'adapterConfig', json(adapter_config_json),
          'runtimeConfig', json(runtime_config_json)
        ),
        COALESCE(created_at, ${NOW_SQL}),
        COALESCE(updated_at, ${NOW_SQL})
      FROM runtime_seed;
    `,
  },
  {
    version: 50,
    name: "runtime_governance_approvals_audit",
    compatibleChecksums: [
      // Initial v50 checksum from dev databases before stale approval
      // references were guarded during the table rebuild.
      "d59ecc2133416667e281f99313ce3aaca6685a8d2884dea22e54e126318f9932",
    ],
    sql: `
      -- Expand approval governance beyond hiring/strategy/budget.
      -- SQLite CHECK constraints require table recreation.
      PRAGMA foreign_keys = OFF;

      CREATE TABLE approvals_new (
        id                      TEXT PRIMARY KEY,
        company_id              TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        type                    TEXT NOT NULL CHECK (type IN ('hire_agent','approve_ceo_strategy','budget_override_required','provider_switch','protected_runtime_command')),
        status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','revision_requested','approved','rejected','cancelled')),
        requested_by_agent_id   TEXT REFERENCES agents(id) ON DELETE SET NULL,
        payload_json            TEXT NOT NULL DEFAULT '{}',
        decision_note           TEXT,
        decided_by_user_id      TEXT,
        decided_at              TEXT,
        linked_task_id          TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        created_at              TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at              TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      INSERT INTO approvals_new (
        id, company_id, type, status, requested_by_agent_id, payload_json,
        decision_note, decided_by_user_id, decided_at, linked_task_id,
        created_at, updated_at
      )
      SELECT
        a.id,
        a.company_id,
        a.type,
        a.status,
        CASE WHEN requested_by.id IS NOT NULL THEN a.requested_by_agent_id ELSE NULL END,
        a.payload_json,
        a.decision_note,
        a.decided_by_user_id,
        a.decided_at,
        CASE WHEN linked_task.id IS NOT NULL THEN a.linked_task_id ELSE NULL END,
        a.created_at,
        a.updated_at
      FROM approvals a
      INNER JOIN companies c ON c.id = a.company_id
      LEFT JOIN agents requested_by ON requested_by.id = a.requested_by_agent_id
      LEFT JOIN tasks linked_task ON linked_task.id = a.linked_task_id;

      DROP TABLE approvals;
      ALTER TABLE approvals_new RENAME TO approvals;

      CREATE INDEX IF NOT EXISTS idx_approvals_company_status ON approvals(company_id, status);
      CREATE INDEX IF NOT EXISTS idx_approvals_company_type ON approvals(company_id, type);
      CREATE INDEX IF NOT EXISTS idx_approvals_linked_task ON approvals(linked_task_id);

      CREATE TABLE IF NOT EXISTS company_audit_events (
        id              TEXT PRIMARY KEY,
        company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        agent_id        TEXT REFERENCES agents(id) ON DELETE SET NULL,
        runtime_id      TEXT REFERENCES agent_runtimes(id) ON DELETE SET NULL,
        task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        approval_id     TEXT REFERENCES approvals(id) ON DELETE SET NULL,
        event_type      TEXT NOT NULL,
        actor_user_id   TEXT,
        metadata_json   TEXT NOT NULL DEFAULT '{}',
        created_at      TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX IF NOT EXISTS idx_company_audit_events_company_created
        ON company_audit_events(company_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_company_audit_events_agent_created
        ON company_audit_events(agent_id, created_at DESC)
        WHERE agent_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_company_audit_events_runtime_created
        ON company_audit_events(runtime_id, created_at DESC)
        WHERE runtime_id IS NOT NULL;

      PRAGMA foreign_keys = ON;
    `,
  },
  {
    version: 51,
    name: "execution_run_transcript_events",
    sql: `
      CREATE TABLE IF NOT EXISTS execution_run_transcript_events (
        id                TEXT PRIMARY KEY,
        execution_run_id  TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
        provider          TEXT NOT NULL,
        event_kind        TEXT NOT NULL,
        role              TEXT,
        title             TEXT,
        body              TEXT NOT NULL DEFAULT '',
        metadata_json     TEXT NOT NULL DEFAULT '{}',
        sequence          INTEGER NOT NULL DEFAULT 0,
        occurred_at       TEXT NOT NULL DEFAULT (${NOW_SQL}),
        created_at        TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX IF NOT EXISTS idx_execution_run_transcript_events_run_seq
        ON execution_run_transcript_events(execution_run_id, sequence, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_execution_run_transcript_events_provider
        ON execution_run_transcript_events(provider, occurred_at DESC);
    `,
  },
  {
    version: 52,
    name: "execution_runs_add_hermes_provider",
    sql: `
      -- Expand execution_runs.provider CHECK constraint to include 'hermes'.
      -- SQLite cannot ALTER CHECK constraints, so we recreate the table.
      PRAGMA foreign_keys = OFF;

      CREATE TABLE execution_runs_new (
        id                TEXT PRIMARY KEY,
        task_id           TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id          TEXT REFERENCES agents(id) ON DELETE SET NULL,
        provider          TEXT NOT NULL CHECK (provider IN ('openclaw','paperclip','codex','anthropic','hermes')),
        session_id        TEXT,
        status            TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
        started_at        TEXT,
        completed_at      TEXT,
        error_message     TEXT,
        token_usage_json  TEXT NOT NULL DEFAULT '{}',
        duration_ms       INTEGER,
        idempotency_key   TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO execution_runs_new SELECT * FROM execution_runs;
      DROP TABLE execution_runs;
      ALTER TABLE execution_runs_new RENAME TO execution_runs;

      CREATE INDEX idx_execution_runs_task_created_at
        ON execution_runs(task_id, created_at DESC);
      CREATE INDEX idx_execution_runs_task_status
        ON execution_runs(task_id, status);
      CREATE INDEX idx_execution_runs_provider_status
        ON execution_runs(provider, status);
      CREATE UNIQUE INDEX idx_execution_runs_idempotency_key
        ON execution_runs(idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      PRAGMA foreign_keys = ON;
    `,
  },
  {
    version: 53,
    name: "provider_profiles_and_cost_events",
    sql: `
      CREATE TABLE IF NOT EXISTS provider_connection_profiles (
        id                TEXT PRIMARY KEY,
        company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        runtime_id        TEXT REFERENCES agent_runtimes(id) ON DELETE SET NULL,
        provider          TEXT NOT NULL,
        display_name      TEXT NOT NULL,
        connection_type   TEXT NOT NULL DEFAULT 'unknown'
          CHECK (connection_type IN ('local_cli','api_key','env_api_key','oauth','subscription','router','local_model','daemon','manual','unknown')),
        billing_model     TEXT NOT NULL DEFAULT 'unknown'
          CHECK (billing_model IN ('metered_tokens','subscription_included','subscription_overage','credits','fixed','local_free','hybrid','unknown')),
        biller            TEXT NOT NULL DEFAULT 'unknown',
        auth_surface      TEXT NOT NULL DEFAULT 'unknown'
          CHECK (auth_surface IN ('api_key','env','oauth','device_login','setup_token','local_config','none','unknown')),
        confidence        TEXT NOT NULL DEFAULT 'detected'
          CHECK (confidence IN ('reported','detected','inferred','confirmed','unknown')),
        source            TEXT NOT NULL DEFAULT 'runtime_detection',
        is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        metadata_json     TEXT NOT NULL DEFAULT '{}',
        created_at        TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at        TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX IF NOT EXISTS idx_provider_profiles_company_provider
        ON provider_connection_profiles(company_id, provider, is_active);
      CREATE INDEX IF NOT EXISTS idx_provider_profiles_company_biller
        ON provider_connection_profiles(company_id, biller, is_active);
      CREATE INDEX IF NOT EXISTS idx_provider_profiles_runtime
        ON provider_connection_profiles(runtime_id)
        WHERE runtime_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS cost_events (
        id                  TEXT PRIMARY KEY,
        company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        agent_id            TEXT REFERENCES agents(id) ON DELETE SET NULL,
        task_id             TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        project_id          TEXT REFERENCES projects(id) ON DELETE SET NULL,
        execution_run_id    TEXT REFERENCES execution_runs(id) ON DELETE SET NULL,
        heartbeat_run_id    TEXT REFERENCES heartbeat_runs(id) ON DELETE SET NULL,
        provider            TEXT NOT NULL,
        biller              TEXT NOT NULL DEFAULT 'unknown',
        billing_type        TEXT NOT NULL DEFAULT 'unknown'
          CHECK (billing_type IN ('metered_api','subscription_included','subscription_overage','credits','fixed','local_free','estimated','unknown')),
        model               TEXT NOT NULL DEFAULT 'unknown',
        input_tokens        INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens       INTEGER NOT NULL DEFAULT 0,
        cost_cents          REAL NOT NULL DEFAULT 0,
        cost_source         TEXT NOT NULL DEFAULT 'unknown'
          CHECK (cost_source IN ('reported','estimated','subscription_included','manual','unknown')),
        confidence          TEXT NOT NULL DEFAULT 'inferred'
          CHECK (confidence IN ('reported','detected','inferred','confirmed','unknown')),
        metadata_json       TEXT NOT NULL DEFAULT '{}',
        occurred_at         TEXT NOT NULL DEFAULT (${NOW_SQL}),
        created_at          TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX IF NOT EXISTS idx_cost_events_company_occurred
        ON cost_events(company_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cost_events_company_provider
        ON cost_events(company_id, provider, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cost_events_company_biller
        ON cost_events(company_id, biller, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cost_events_agent_occurred
        ON cost_events(agent_id, occurred_at DESC)
        WHERE agent_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_events_execution_run_unique
        ON cost_events(execution_run_id)
        WHERE execution_run_id IS NOT NULL;
    `,
  },
  {
    version: 54,
    name: "provider_finance_events",
    sql: `
      CREATE TABLE IF NOT EXISTS provider_finance_events (
        id              TEXT PRIMARY KEY,
        company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        provider        TEXT NOT NULL DEFAULT 'unknown',
        biller          TEXT NOT NULL DEFAULT 'unknown',
        event_type      TEXT NOT NULL DEFAULT 'manual'
          CHECK (event_type IN ('invoice','usage','subscription','credit','adjustment','imported_usage','manual')),
        amount_cents    REAL NOT NULL DEFAULT 0,
        currency        TEXT NOT NULL DEFAULT 'USD',
        source          TEXT NOT NULL DEFAULT 'manual'
          CHECK (source IN ('manual','provider_import','invoice_import','estimated','unknown')),
        confidence      TEXT NOT NULL DEFAULT 'confirmed'
          CHECK (confidence IN ('reported','detected','inferred','confirmed','unknown')),
        period_start    TEXT,
        period_end      TEXT,
        external_id     TEXT,
        description     TEXT NOT NULL DEFAULT '',
        metadata_json   TEXT NOT NULL DEFAULT '{}',
        occurred_at     TEXT NOT NULL DEFAULT (${NOW_SQL}),
        created_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at      TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX IF NOT EXISTS idx_provider_finance_events_company_occurred
        ON provider_finance_events(company_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_provider_finance_events_company_biller
        ON provider_finance_events(company_id, biller, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_provider_finance_events_company_provider
        ON provider_finance_events(company_id, provider, occurred_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_finance_events_external
        ON provider_finance_events(company_id, source, external_id)
        WHERE external_id IS NOT NULL;
    `,
  },
  {
    version: 55,
    name: "company_members_foundation",
    compatibleChecksums: [
      // Public-share bootstrap before neutral local owner identity.
      "8743f74997786f2454f9fb8a80e0685de89bb27b124cae62096d324c733c1f32",
      // Live dev DB checksum before the public-share bootstrap neutralization.
      "123d36135717ad4d8b2326e6fcee3dcb4bb0a0e2f3769bf38e1d24556d24b3df",
    ],
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id              TEXT PRIMARY KEY,
        display_name    TEXT NOT NULL,
        email           TEXT NOT NULL UNIQUE,
        avatar_url      TEXT,
        created_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        archived_at     TEXT
      );

      CREATE TABLE IF NOT EXISTS company_members (
        id                  TEXT PRIMARY KEY,
        company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role                TEXT NOT NULL DEFAULT 'member'
          CHECK (role IN ('owner','admin','member','viewer')),
        status              TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active','invited','suspended','removed')),
        invited_by_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        UNIQUE(company_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_company_members_company
        ON company_members(company_id, status, role);
      CREATE INDEX IF NOT EXISTS idx_company_members_user
        ON company_members(user_id, status);

      ALTER TABLE companies ADD COLUMN owner_user_id TEXT;

      INSERT INTO users (id, display_name, email, created_at, updated_at)
      VALUES ('${DEFAULT_LOCAL_OWNER_ID}', '${DEFAULT_LOCAL_OWNER_NAME}', '${DEFAULT_LOCAL_OWNER_EMAIL}', ${NOW_SQL}, ${NOW_SQL})
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        email = excluded.email,
        updated_at = excluded.updated_at;

      INSERT INTO company_members (id, company_id, user_id, role, status, created_at, updated_at)
      SELECT 'member-' || id || '-${DEFAULT_LOCAL_OWNER_ID}', id, '${DEFAULT_LOCAL_OWNER_ID}', 'owner', 'active', ${NOW_SQL}, ${NOW_SQL}
      FROM companies
      WHERE archived_at IS NULL
      ON CONFLICT(company_id, user_id) DO UPDATE SET
        role = CASE WHEN company_members.role = 'owner' THEN company_members.role ELSE excluded.role END,
        status = 'active',
        updated_at = excluded.updated_at;

      UPDATE companies
      SET owner_user_id = '${DEFAULT_LOCAL_OWNER_ID}',
          updated_at = ${NOW_SQL}
      WHERE owner_user_id IS NULL
        AND archived_at IS NULL;
    `,
  },
  {
    version: 56,
    name: "company_scoped_tasks_and_due_dates",
    sql: `
      ALTER TABLE tasks ADD COLUMN company_id TEXT REFERENCES companies(id) ON DELETE CASCADE;
      ALTER TABLE tasks ADD COLUMN due_date TEXT;
      UPDATE tasks
         SET company_id = (
           SELECT p.company_id
             FROM projects p
            WHERE p.id = tasks.project_id
         )
       WHERE company_id IS NULL;
      CREATE INDEX idx_tasks_company_status_order ON tasks(company_id, status, column_order ASC, created_at ASC);
    `,
  },
  {
    version: 57,
    name: "provider_neutral_unlinked_agents",
    sql: `
      UPDATE agents
         SET adapter_type = CASE
           WHEN NULLIF(TRIM(COALESCE(paperclip_agent_id, '')), '') IS NOT NULL THEN 'paperclip'
           ELSE 'manual'
         END,
             updated_at = ${NOW_SQL}
       WHERE lower(COALESCE(adapter_type, '')) = 'openclaw'
         AND NULLIF(TRIM(COALESCE(openclaw_agent_id, '')), '') IS NULL;

      UPDATE agent_runtime_state
         SET adapter_type = (
           SELECT a.adapter_type
             FROM agents a
            WHERE a.id = agent_runtime_state.agent_id
         ),
             updated_at = ${NOW_SQL}
       WHERE EXISTS (
         SELECT 1
           FROM agents a
          WHERE a.id = agent_runtime_state.agent_id
            AND a.adapter_type IN ('manual', 'paperclip')
       )
         AND lower(COALESCE(adapter_type, '')) = 'openclaw';
    `,
  },
  {
    version: 58,
    name: "provider_neutral_company_workspaces",
    compatibleChecksums: [
      "e3efb25faa1ca15a293332c55de7b799b2a63a49f3093ddd9f6cfdc148b18180",
      "d601e0e8cd79dd429e2b0ad7525a71106276ce80df00930a79fe8fa6c8408dbe",
      "569ae591a276a52c8bb8c14956bc8b2c52e1328d185ea1cc91a77d1f8ff21412",
      "504030f664096cccedf5a032707510a09733dc4a1a6e018df7a0f15b04ca6184",
    ],
    sql: `
      UPDATE companies
         SET workspace_root = '${DEFAULT_MC_WORKSPACE_ROOT.replace(/'/g, "''")}/companies/' ||
              COALESCE(
                NULLIF(TRIM(workspace_slug), ''),
                NULLIF(TRIM(runtime_slug), ''),
                NULLIF(TRIM(slug), ''),
                id
              ) || '--' || id,
             workspace_source = 'provisioned',
             updated_at = ${NOW_SQL}
      WHERE workspace_source = 'openclaw';
    `,
  },
  {
    version: 59,
    name: "execution_runs_add_gemini_provider",
    sql: `
      -- Expand execution_runs.provider CHECK constraint to include 'gemini'.
      -- SQLite cannot ALTER CHECK constraints, so we recreate the table.
      PRAGMA foreign_keys = OFF;

      CREATE TABLE execution_runs_new (
        id                TEXT PRIMARY KEY,
        task_id           TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id          TEXT REFERENCES agents(id) ON DELETE SET NULL,
        provider          TEXT NOT NULL CHECK (provider IN ('openclaw','paperclip','codex','anthropic','hermes','gemini')),
        session_id        TEXT,
        status            TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
        started_at        TEXT,
        completed_at      TEXT,
        error_message     TEXT,
        token_usage_json  TEXT NOT NULL DEFAULT '{}',
        duration_ms       INTEGER,
        idempotency_key   TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO execution_runs_new SELECT * FROM execution_runs;
      DROP TABLE execution_runs;
      ALTER TABLE execution_runs_new RENAME TO execution_runs;

      CREATE INDEX idx_execution_runs_task_created_at
        ON execution_runs(task_id, created_at DESC);
      CREATE INDEX idx_execution_runs_task_status
        ON execution_runs(task_id, status);
      CREATE INDEX idx_execution_runs_provider_status
        ON execution_runs(provider, status);
      CREATE UNIQUE INDEX idx_execution_runs_idempotency_key
        ON execution_runs(idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      PRAGMA foreign_keys = ON;
    `,
  },
  {
    version: 60,
    name: "normalize_gemini_cli_models",
    compatibleChecksums: [
      // Earlier v60 also downgraded Gemini 3 preview selections. Gemini CLI
      // supports those model ids, so only ambiguous auto aliases are normalized.
      "db441cd0ead7b8ce13de2dc3293a4a2a2cb682929277d86089d6f144cdb5e67b",
      "f1873634abfa101f08f1b73bbadd33650bd411f87508bdfc0ffec60c8c11dccd",
      "900ea17036234757e93df7cc115433ee7935d5b6077a0ddb4a5ef2cc02ac7b95",
    ],
    sql: `
      UPDATE agents
         SET model = CASE
           WHEN lower(COALESCE(model, '')) LIKE 'google/auto%' THEN 'google/gemini-3-pro-preview'
           ELSE model
         END,
             updated_at = ${NOW_SQL}
       WHERE lower(COALESCE(adapter_type, '')) = 'gemini'
         AND lower(COALESCE(model, '')) LIKE 'google/auto%';
    `,
  },
  {
    version: 61,
    name: "normalize_gemini_runtime_metadata_models",
    compatibleChecksums: [
      // Earlier v61 also downgraded Gemini 3 preview selections. Gemini CLI
      // supports those model ids, so only ambiguous auto aliases are normalized.
      "6f92ccb015a737ec7a26f46d89ddeb47500399636edb93d3e5935f7cbcc9babe",
      "661a9d1fb10a3d6dac1197d4984820d7a53a0300f4fbbecffe009ea24354e568",
      "f61393c100ff353243282664b5be2b22cd8e9c93a2489eeee92901ed87ab1f09",
    ],
    sql: `
      UPDATE agent_runtimes
         SET metadata_json = json_set(metadata_json, '$.model', 'google/gemini-3-pro-preview'),
             updated_at = ${NOW_SQL}
      WHERE provider = 'gemini'
        AND lower(COALESCE(json_extract(metadata_json, '$.model'), '')) LIKE 'google/auto%';
    `,
  },
  {
    version: 62,
    name: "allow_blocked_to_review_transition",
    sql: `
      -- A retried blocked task can complete in the retry run and move straight
      -- back to review. Without this rule, successful retries leave tasks
      -- visibly blocked even after artifacts/comments land.
      INSERT OR IGNORE INTO status_transition_rules (from_status, to_status, requires_assignee, requires_review, is_terminal)
        VALUES ('blocked', 'review', 0, 0, 0);
    `,
  },
  {
    version: 63,
    name: "tasks_add_execution_engine",
    compatibleChecksums: ["38aceec4a61040f597ccda21e8abc3fe0fd617cf44ca63ab61764c6f66c3facb"],
    sql: `
      -- execution_mode is a legacy bridge/runtime field. execution_engine is
      -- the product-level owner of task orchestration.
      ALTER TABLE tasks
        ADD COLUMN execution_engine TEXT
        CHECK (execution_engine IS NULL OR execution_engine IN ('hiverunner','symphony','manual'));

      CREATE INDEX IF NOT EXISTS idx_tasks_execution_engine_status
        ON tasks(execution_engine, status, updated_at DESC);
    `,
  },
  {
    version: 64,
    name: "execution_runs_add_symphony_provider",
    sql: `
      -- Expand execution_runs.provider CHECK constraint to include 'symphony'.
      -- SQLite cannot ALTER CHECK constraints, so we recreate the table.
      PRAGMA foreign_keys = OFF;

      CREATE TABLE execution_runs_new (
        id                TEXT PRIMARY KEY,
        task_id           TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id          TEXT REFERENCES agents(id) ON DELETE SET NULL,
        provider          TEXT NOT NULL CHECK (provider IN ('openclaw','paperclip','codex','anthropic','hermes','gemini','symphony')),
        session_id        TEXT,
        status            TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
        started_at        TEXT,
        completed_at      TEXT,
        error_message     TEXT,
        token_usage_json  TEXT NOT NULL DEFAULT '{}',
        duration_ms       INTEGER,
        idempotency_key   TEXT,
        created_at        TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO execution_runs_new SELECT * FROM execution_runs;
      DROP TABLE execution_runs;
      ALTER TABLE execution_runs_new RENAME TO execution_runs;

      CREATE INDEX idx_execution_runs_task_created_at
        ON execution_runs(task_id, created_at DESC);
      CREATE INDEX idx_execution_runs_task_status
        ON execution_runs(task_id, status);
      CREATE INDEX idx_execution_runs_provider_status
        ON execution_runs(provider, status);
      CREATE UNIQUE INDEX idx_execution_runs_idempotency_key
        ON execution_runs(idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      PRAGMA foreign_keys = ON;
    `,
  },
  {
    version: 65,
    name: "tasks_add_model_lane",
    sql: `
      ALTER TABLE tasks
        ADD COLUMN model_lane TEXT NOT NULL DEFAULT 'default'
        CHECK (model_lane IN ('default','fast','mini','deep'));

      CREATE INDEX IF NOT EXISTS idx_tasks_model_lane_status
        ON tasks(model_lane, status, updated_at DESC);
    `,
  },
  {
    version: 66,
    name: "company_skill_registry",
    sql: `
      CREATE TABLE company_skills (
        id                TEXT PRIMARY KEY,
        company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        slug              TEXT NOT NULL,
        name              TEXT NOT NULL,
        description       TEXT NOT NULL DEFAULT '',
        status            TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','active','archived')),
        version           INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
        source            TEXT NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('manual','seed','learned','imported')),
        scope             TEXT NOT NULL DEFAULT 'company'
                          CHECK (scope IN ('company','project','agent')),
        owner_agent_id    TEXT REFERENCES agents(id) ON DELETE SET NULL,
        review_required   INTEGER NOT NULL DEFAULT 1 CHECK (review_required IN (0,1)),
        review_state      TEXT NOT NULL DEFAULT 'not_requested'
                          CHECK (review_state IN ('not_requested','requested','approved','rejected')),
        metadata_json     TEXT NOT NULL DEFAULT '{}',
        created_at        TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at        TEXT NOT NULL DEFAULT (${NOW_SQL}),
        archived_at       TEXT,
        UNIQUE(company_id, slug)
      );

      CREATE INDEX idx_company_skills_company_status
        ON company_skills(company_id, status, updated_at DESC);

      CREATE INDEX idx_company_skills_owner
        ON company_skills(owner_agent_id, status)
        WHERE owner_agent_id IS NOT NULL;
    `,
  },
  {
    version: 67,
    name: "agent_skill_assignments",
    sql: `
      CREATE TABLE agent_skill_assignments (
        id                   TEXT PRIMARY KEY,
        company_id           TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        agent_id             TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        skill_id             TEXT NOT NULL REFERENCES company_skills(id) ON DELETE CASCADE,
        status               TEXT NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft','active','archived')),
        source               TEXT NOT NULL DEFAULT 'manual'
                             CHECK (source IN ('manual','seed','learned','imported')),
        assigned_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        notes                TEXT NOT NULL DEFAULT '',
        metadata_json        TEXT NOT NULL DEFAULT '{}',
        created_at           TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at           TEXT NOT NULL DEFAULT (${NOW_SQL}),
        archived_at          TEXT,
        UNIQUE(agent_id, skill_id)
      );

      CREATE INDEX idx_agent_skill_assignments_company_agent
        ON agent_skill_assignments(company_id, agent_id, status);

      CREATE INDEX idx_agent_skill_assignments_skill
        ON agent_skill_assignments(skill_id, status);
    `,
  },
  {
    version: 68,
    name: "company_memory_records",
    sql: `
      CREATE TABLE company_memory_records (
        id                TEXT PRIMARY KEY,
        company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        project_id        TEXT REFERENCES projects(id) ON DELETE SET NULL,
        agent_id          TEXT REFERENCES agents(id) ON DELETE SET NULL,
        task_id           TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        execution_run_id  TEXT REFERENCES execution_runs(id) ON DELETE SET NULL,
        slug              TEXT NOT NULL,
        title             TEXT NOT NULL,
        body              TEXT NOT NULL DEFAULT '',
        kind              TEXT NOT NULL DEFAULT 'fact'
                          CHECK (kind IN ('fact','decision','preference','architecture','domain_constraint','workflow_note','skill_evidence')),
        scope             TEXT NOT NULL DEFAULT 'company'
                          CHECK (scope IN ('company','project','agent')),
        status            TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','active','rejected','archived')),
        source            TEXT NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('manual','task','run','extractor','imported')),
        confidence        REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
        review_required   INTEGER NOT NULL DEFAULT 1 CHECK (review_required IN (0,1)),
        review_state      TEXT NOT NULL DEFAULT 'not_requested'
                          CHECK (review_state IN ('not_requested','requested','approved','rejected')),
        reviewed_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        reviewed_at       TEXT,
        metadata_json     TEXT NOT NULL DEFAULT '{}',
        created_at        TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at        TEXT NOT NULL DEFAULT (${NOW_SQL}),
        archived_at       TEXT,
        UNIQUE(company_id, slug)
      );

      CREATE INDEX idx_company_memory_records_company_status
        ON company_memory_records(company_id, status, updated_at DESC);

      CREATE INDEX idx_company_memory_records_project
        ON company_memory_records(project_id, status)
        WHERE project_id IS NOT NULL;

      CREATE INDEX idx_company_memory_records_agent
        ON company_memory_records(agent_id, status)
        WHERE agent_id IS NOT NULL;

      CREATE INDEX idx_company_memory_records_task
        ON company_memory_records(task_id, status)
        WHERE task_id IS NOT NULL;
    `,
  },
  {
    version: 69,
    name: "skill_effectiveness_events",
    sql: `
      CREATE TABLE skill_effectiveness_events (
        id                TEXT PRIMARY KEY,
        company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        skill_id          TEXT REFERENCES company_skills(id) ON DELETE SET NULL,
        assignment_id     TEXT REFERENCES agent_skill_assignments(id) ON DELETE SET NULL,
        agent_id          TEXT REFERENCES agents(id) ON DELETE SET NULL,
        task_id           TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        execution_run_id  TEXT REFERENCES execution_runs(id) ON DELETE SET NULL,
        event_type        TEXT NOT NULL
                          CHECK (event_type IN ('available','explicit_use','review_outcome')),
        outcome           TEXT
                          CHECK (outcome IS NULL OR outcome IN ('pass','fail','blocked','unknown')),
        source            TEXT NOT NULL DEFAULT 'system'
                          CHECK (source IN ('system','agent','operator')),
        metadata_json     TEXT NOT NULL DEFAULT '{}',
        created_at        TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX idx_skill_effectiveness_company_skill
        ON skill_effectiveness_events(company_id, skill_id, created_at DESC);

      CREATE INDEX idx_skill_effectiveness_task
        ON skill_effectiveness_events(task_id, event_type, created_at DESC)
        WHERE task_id IS NOT NULL;

      CREATE INDEX idx_skill_effectiveness_run
        ON skill_effectiveness_events(execution_run_id, event_type)
        WHERE execution_run_id IS NOT NULL;
    `,
  },
  {
    version: 70,
    name: "execution_runs_add_runner_identity",
    compatibleChecksums: [
      // Dev-lane v70 was briefly applied as execution_runs_runner_metadata with
      // the same columns and narrower runner indexes before the migration was
      // renamed/finalized. Treat it as compatible and repair the canonical index
      // during the writable migration path.
      "a7534837ea482874819ad4d1d896c1bf7c8205639452a44b8daa3e8f64c22210",
    ],
    sql: `
      ALTER TABLE execution_runs
        ADD COLUMN execution_engine TEXT
          CHECK (execution_engine IS NULL OR execution_engine IN ('hiverunner','symphony','manual'));

      ALTER TABLE execution_runs
        ADD COLUMN runner_provider TEXT;

      ALTER TABLE execution_runs
        ADD COLUMN runner_model TEXT;

      CREATE INDEX IF NOT EXISTS idx_execution_runs_runner_identity
        ON execution_runs(execution_engine, runner_provider, status, updated_at DESC);
    `,
  },
  {
    version: 71,
    name: "company_execution_hives",
    sql: `
      CREATE TABLE company_execution_hives (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        preset TEXT NOT NULL DEFAULT 'custom',
        orchestration_mode TEXT NOT NULL CHECK (orchestration_mode IN ('hiverunner','symphony','manual')),
        optimize_for TEXT NOT NULL DEFAULT 'balanced',
        autonomy TEXT NOT NULL DEFAULT 'supervised',
        runtime_priority_json TEXT NOT NULL DEFAULT '[]',
        routing_policy TEXT NOT NULL DEFAULT '',
        lanes_json TEXT NOT NULL DEFAULT '[]',
        verification_json TEXT NOT NULL DEFAULT '{}',
        usage_json TEXT NOT NULL DEFAULT '{}',
        is_recommended INTEGER NOT NULL DEFAULT 0 CHECK (is_recommended IN (0,1)),
        is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
        archived_at TEXT,
        created_at TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at TEXT NOT NULL DEFAULT (${NOW_SQL}),
        UNIQUE(company_id, slug)
      );

      CREATE UNIQUE INDEX idx_company_execution_hives_single_active
        ON company_execution_hives(company_id)
        WHERE is_active = 1 AND archived_at IS NULL;

      CREATE INDEX idx_company_execution_hives_company
        ON company_execution_hives(company_id, archived_at, updated_at DESC);
    `,
  },
  {
    version: 72,
    name: "tasks_add_execution_routing_overrides",
    sql: `
      ALTER TABLE tasks
        ADD COLUMN execution_runtime_provider TEXT;

      ALTER TABLE tasks
        ADD COLUMN execution_runtime_label TEXT;

      ALTER TABLE tasks
        ADD COLUMN execution_model_routing TEXT;

      ALTER TABLE tasks
        ADD COLUMN execution_model_routing_label TEXT;

      CREATE INDEX IF NOT EXISTS idx_tasks_execution_runtime_provider
        ON tasks(execution_runtime_provider, status, updated_at DESC)
        WHERE execution_runtime_provider IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_tasks_execution_model_routing
        ON tasks(execution_model_routing, status, updated_at DESC)
        WHERE execution_model_routing IS NOT NULL;
    `,
  },
  {
    version: 73,
    name: "execution_runs_add_lane_route_audit",
    sql: `
      ALTER TABLE execution_runs
        ADD COLUMN model_lane TEXT;

      ALTER TABLE execution_runs
        ADD COLUMN fallback_used INTEGER NOT NULL DEFAULT 0 CHECK (fallback_used IN (0,1));

      ALTER TABLE execution_runs
        ADD COLUMN fallback_index INTEGER;

      ALTER TABLE execution_runs
        ADD COLUMN fallback_from_provider TEXT;

      ALTER TABLE execution_runs
        ADD COLUMN route_attempts_json TEXT NOT NULL DEFAULT '[]';

      CREATE INDEX IF NOT EXISTS idx_execution_runs_lane_runner
        ON execution_runs(model_lane, runner_provider, status, updated_at DESC)
        WHERE model_lane IS NOT NULL;
    `,
  },
  {
    version: 74,
    name: "available_models_catalog",
    sql: `
      CREATE TABLE available_models (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        runtime_provider TEXT NOT NULL CHECK (runtime_provider IN ('anthropic','openai','google','hermes','openclaw','openrouter')),
        default_runtime_label TEXT NOT NULL,
        model_source_id TEXT NOT NULL,
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        context_window INTEGER,
        description TEXT,
        is_seed INTEGER NOT NULL DEFAULT 0 CHECK (is_seed IN (0,1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX idx_available_models_provider_active
        ON available_models(runtime_provider, is_active, display_name);

      CREATE INDEX idx_available_models_source_active
        ON available_models(model_source_id, is_active, display_name);

      INSERT INTO available_models (
        id, display_name, runtime_provider, default_runtime_label, model_source_id,
        capabilities_json, context_window, description, is_seed, is_active, created_at, updated_at
      )
      SELECT *
      FROM (
        VALUES
          ('claude-sonnet-4-6', 'Claude Sonnet 4.6', 'anthropic', 'Claude Code', 'anthropic', '["text","vision","tools","structured-output"]', NULL, 'Balanced Anthropic model for implementation, review, and product reasoning.', 1, 1, ${NOW_SQL}, ${NOW_SQL}),
          ('claude-opus-4-7', 'Claude Opus 4.7', 'anthropic', 'Claude Code', 'anthropic', '["text","vision","tools","structured-output"]', NULL, 'Deep Anthropic model for architecture, hard debugging, and high-stakes review.', 1, 1, ${NOW_SQL}, ${NOW_SQL}),
          ('claude-haiku-4-5', 'Claude Haiku 4.5', 'anthropic', 'Claude Code', 'anthropic', '["text","tools"]', NULL, 'Fast Anthropic model for low-risk summaries, triage, and short edits.', 1, 1, ${NOW_SQL}, ${NOW_SQL}),
          ('gpt-5', 'GPT-5', 'openai', 'Codex', 'openai', '["text","vision","tools","structured-output"]', NULL, 'General OpenAI model for coding, analysis, and tool-rich execution.', 1, 1, ${NOW_SQL}, ${NOW_SQL}),
          ('gpt-5-mini', 'GPT-5 Mini', 'openai', 'Codex', 'openai', '["text","tools","structured-output"]', NULL, 'Fast OpenAI model for lightweight coding and operational tasks.', 1, 1, ${NOW_SQL}, ${NOW_SQL}),
          ('gpt-4o', 'GPT-4o', 'openai', 'Codex', 'openai', '["text","vision","tools","structured-output"]', NULL, 'Multimodal OpenAI model for vision-heavy review and general work.', 1, 1, ${NOW_SQL}, ${NOW_SQL}),
          ('gpt-4o-mini', 'GPT-4o Mini', 'openai', 'Codex', 'openai', '["text","vision","tools"]', NULL, 'Low-latency OpenAI model for small multimodal and text tasks.', 1, 1, ${NOW_SQL}, ${NOW_SQL}),
          ('gemini-2.5-pro', 'Gemini 2.5 Pro', 'google', 'Gemini CLI', 'google', '["text","vision","tools","structured-output"]', NULL, 'Google model for long-context, multimodal, and implementation work.', 1, 1, ${NOW_SQL}, ${NOW_SQL}),
          ('gemini-2.5-flash', 'Gemini 2.5 Flash', 'google', 'Gemini CLI', 'google', '["text","vision","tools"]', NULL, 'Fast Google model for low-latency tasks and broad context checks.', 1, 1, ${NOW_SQL}, ${NOW_SQL}),
          ('hermes-runtime-managed', 'Hermes Runtime Managed', 'hermes', 'Hermes', 'hermes', '["text","tools"]', NULL, 'Hermes-managed in-house profile selected by the runtime.', 1, 1, ${NOW_SQL}, ${NOW_SQL}),
          ('openclaw-runtime-managed', 'OpenClaw Runtime Managed', 'openclaw', 'OpenClaw', 'openclaw', '["text","tools"]', NULL, 'OpenClaw-managed local or workspace model selected by the runtime.', 1, 1, ${NOW_SQL}, ${NOW_SQL})
      )
      WHERE NOT EXISTS (SELECT 1 FROM available_models);
    `,
  },
  {
    version: 75,
    name: "available_model_refresh_status",
    sql: `
      CREATE TABLE IF NOT EXISTS available_model_refresh_status (
        provider TEXT PRIMARY KEY CHECK (provider IN ('anthropic','openai','google','hermes','openclaw','openrouter')),
        status TEXT NOT NULL CHECK (status IN ('refreshed','fallback','skipped','failed')),
        refreshed_at TEXT NOT NULL DEFAULT (${NOW_SQL}),
        model_count INTEGER NOT NULL DEFAULT 0,
        message TEXT
      );
    `,
  },
  {
    version: 76,
    name: "execution_runs_add_process_pid",
    sql: `ALTER TABLE execution_runs ADD COLUMN process_pid INTEGER;`,
  },
  {
    version: 77,
    name: "execution_runs_add_failure_class",
    sql: `ALTER TABLE execution_runs ADD COLUMN failure_class TEXT;`,
  },
  {
    version: 81,
    name: "goals_kind_and_hiverunner_project_name",
    sql: `
      ALTER TABLE sprints ADD COLUMN goal_kind TEXT DEFAULT NULL CHECK (goal_kind IN ('company', 'sprint') OR goal_kind IS NULL);

      UPDATE projects
      SET name = 'HiveRunner Orchestration',
          updated_at = ${NOW_SQL}
      WHERE slug = 'mission-control-orchestration'
        AND name = 'HiveRunner Orchestration';
    `,
  },
  {
    version: 82,
    name: "approvals_add_explicit_routing",
    sql: `
      ALTER TABLE approvals
        ADD COLUMN approver_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL;

      ALTER TABLE approvals
        ADD COLUMN approval_route_reason TEXT;

      CREATE INDEX IF NOT EXISTS idx_approvals_approver_status
        ON approvals(approver_agent_id, status, updated_at DESC)
        WHERE approver_agent_id IS NOT NULL;
    `,
  },
  {
    version: 83,
    name: "tasks_company_updated_index",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_tasks_company_updated
        ON tasks(company_id, updated_at DESC, created_at DESC, id ASC)
        WHERE archived_at IS NULL;
    `,
  },
  {
    version: 84,
    name: "normalize_agent_avatar_symbols",
    sql: `
      UPDATE agents
      SET emoji = CASE
        WHEN lower(role) LIKE '%ceo%'
          OR lower(role) LIKE '%chief%'
          OR lower(role) LIKE '%founder%'
          OR lower(role) LIKE '%president%'
          OR lower(role) LIKE '%lead%'
          OR lower(role) LIKE '%director%'
          OR lower(role) LIKE '%head%' THEN 'icon:crown'
        WHEN lower(role) LIKE '%quant%'
          OR lower(role) LIKE '%analytic%'
          OR lower(role) LIKE '%analyst%'
          OR lower(role) LIKE '%finance%'
          OR lower(role) LIKE '%market%'
          OR lower(role) LIKE '%metric%'
          OR lower(role) LIKE '%data%'
          OR lower(role) LIKE '%report%' THEN 'icon:bar-chart'
        WHEN lower(role) LIKE '%ops%'
          OR lower(role) LIKE '%operation%'
          OR lower(role) LIKE '%coordinator%'
          OR lower(role) LIKE '%manager%'
          OR lower(role) LIKE '%orchestrat%'
          OR lower(role) LIKE '%workflow%'
          OR lower(role) LIKE '%heartbeat%' THEN 'icon:activity'
        WHEN lower(role) LIKE '%engineer%'
          OR lower(role) LIKE '%developer%'
          OR lower(role) LIKE '%software%'
          OR lower(role) LIKE '%frontend%'
          OR lower(role) LIKE '%backend%'
          OR lower(role) LIKE '%full-stack%'
          OR lower(role) LIKE '%code%'
          OR lower(role) LIKE '%architect%' THEN 'icon:code'
        WHEN lower(role) LIKE '%qa%'
          OR lower(role) LIKE '%quality%'
          OR lower(role) LIKE '%test%'
          OR lower(role) LIKE '%verification%'
          OR lower(role) LIKE '%verify%'
          OR lower(role) LIKE '%audit%' THEN 'icon:test-tube'
        WHEN lower(role) LIKE '%research%'
          OR lower(role) LIKE '%scout%'
          OR lower(role) LIKE '%discover%'
          OR lower(role) LIKE '%investigat%'
          OR lower(role) LIKE '%search%' THEN 'icon:telescope'
        WHEN lower(role) LIKE '%design%'
          OR lower(role) LIKE '%creative%'
          OR lower(role) LIKE '%brand%'
          OR lower(role) LIKE '%visual%'
          OR lower(role) LIKE '%ui%'
          OR lower(role) LIKE '%ux%' THEN 'icon:palette'
        WHEN lower(role) LIKE '%security%'
          OR lower(role) LIKE '%risk%'
          OR lower(role) LIKE '%compliance%'
          OR lower(role) LIKE '%guard%'
          OR lower(role) LIKE '%review%'
          OR lower(role) LIKE '%gate%' THEN 'icon:shield'
        WHEN lower(role) LIKE '%infra%'
          OR lower(role) LIKE '%platform%'
          OR lower(role) LIKE '%systems%'
          OR lower(role) LIKE '%devops%'
          OR lower(role) LIKE '%database%'
          OR lower(role) LIKE '%server%' THEN 'icon:server'
        WHEN lower(role) LIKE '%voice%'
          OR lower(role) LIKE '%audio%'
          OR lower(role) LIKE '%call%'
          OR lower(role) LIKE '%speech%' THEN 'icon:mic'
        ELSE 'icon:bot'
      END,
      updated_at = ${NOW_SQL}
      WHERE emoji IS NULL
        OR TRIM(emoji) = ''
        OR TRIM(emoji) NOT LIKE 'icon:%';
    `,
  },
  {
    version: 85,
    name: "rename_on_deck_status_to_to_do",
    compatibleChecksums: [
      "9ce10a71332c58d50a6f569e81b6d978a6604fa020f91a90a4aa1e9f416ae33a",
      "77baa60829ddb130e8176b1f90f9324bc1325133e7b358bb9d8341a50cf91890",
    ],
    sql: `
      -- Applied by applyRenameOnDeckStatusMigration because tasks must be
      -- rebuilt dynamically to preserve whichever columns exist in the local DB.
      SELECT 1;
    `,
  },
  {
    version: 86,
    name: "goal_contract_schema_and_status_rules",
    sql: `
      -- Applied by applyGoalContractSchemaMigration because sprints must be
      -- rebuilt to expand the status CHECK while preserving local columns.
      SELECT 1;
    `,
  },
  {
    version: 87,
    name: "goal_sprint_plan_drafts",
    sql: `
      CREATE TABLE goal_sprint_plan_drafts (
        id                 TEXT PRIMARY KEY,
        company_id         TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        company_goal_id    TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
        planning_task_id   TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        proposed_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        status             TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','approved','rejected','superseded')),
        sprint_json        TEXT NOT NULL DEFAULT '{}',
        tasks_json         TEXT NOT NULL DEFAULT '[]',
        reject_reason      TEXT,
        approved_at        TEXT,
        rejected_at        TEXT,
        created_at         TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at         TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX idx_goal_sprint_plan_drafts_goal_status
        ON goal_sprint_plan_drafts(company_goal_id, status, created_at DESC);
      CREATE INDEX idx_goal_sprint_plan_drafts_company_status
        ON goal_sprint_plan_drafts(company_id, status, created_at DESC);
    `,
  },
  {
    version: 88,
    name: "execution_runs_require_task_id",
    compatibleChecksums: [
      "491258d8d6e2b312661eb6317a4feebe6c321133da5a6172d8cb7b1c52fe5140",
    ],
    sql: `
      -- Applied by applyExecutionRunsRequireTaskIdMigration because task
      -- columns vary across legacy dev DBs.
      SELECT 1;
    `,
  },
  {
    version: 89,
    name: "goal_sprint_plan_drafts_sequence",
    sql: `
      ALTER TABLE goal_sprint_plan_drafts
        ADD COLUMN sequence_number INTEGER NOT NULL DEFAULT 1;

      ALTER TABLE goal_sprint_plan_drafts
        ADD COLUMN proposal_group_id TEXT;

      UPDATE goal_sprint_plan_drafts
      SET proposal_group_id = lower(hex(randomblob(4))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(2))) || '-' ||
        lower(hex(randomblob(6)))
      WHERE proposal_group_id IS NULL;

      CREATE UNIQUE INDEX idx_goal_sprint_plan_drafts_active_sequence
        ON goal_sprint_plan_drafts(company_goal_id, sequence_number)
        WHERE status IN ('pending', 'approved');

      CREATE INDEX idx_goal_sprint_plan_drafts_group_status
        ON goal_sprint_plan_drafts(company_goal_id, proposal_group_id, status, sequence_number);
    `,
  },
  {
    version: 92,
    name: "allow_to_do_done_transition",
    sql: `
      INSERT OR IGNORE INTO status_transition_rules
        (from_status, to_status, requires_assignee, requires_review, is_terminal)
      VALUES ('to-do', 'done', 0, 0, 1);
    `,
  },
  {
    version: 93,
    name: "add_memory_candidates_and_propose_memory_policies",
    sql: `
      CREATE TABLE IF NOT EXISTS memory_candidates (
        id                  TEXT PRIMARY KEY,
        body                TEXT NOT NULL,
        type                TEXT,
        tags                TEXT,
        category            TEXT,
        status              TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','rejected')),
        proposed_by_agent   TEXT,
        source_task_id      TEXT REFERENCES tasks(id),
        source_run_id       TEXT REFERENCES execution_runs(id),
        proposed_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        routing_target      TEXT,
        reviewed_by         TEXT,
        reviewed_at         TEXT,
        target_source_file  TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memory_candidates_status
        ON memory_candidates(status);

      CREATE INDEX IF NOT EXISTS idx_memory_candidates_proposed_at
        ON memory_candidates(proposed_at);

      CREATE INDEX IF NOT EXISTS idx_memory_candidates_source_task
        ON memory_candidates(source_task_id);

      CREATE TABLE IF NOT EXISTS propose_memory_policies (
        id               TEXT PRIMARY KEY,
        role_pattern     TEXT,
        category         TEXT,
        mode             TEXT NOT NULL DEFAULT 'review'
                           CHECK (mode IN ('review','auto_approve','specialist')),
        specialist_agent TEXT,
        created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `,
  },
  {
    version: 94,
    name: "memory_candidates_scope_and_policies_schema_fix",
    sql: `
      -- Add scope column required by Decision C (Phase 3 foundation).
      -- Default 'role_project' so existing rows (none yet) would get the safe default.
      ALTER TABLE memory_candidates ADD COLUMN scope TEXT NOT NULL DEFAULT 'role_project'
        CHECK (scope IN ('role_project','company'));

      -- Recreate propose_memory_policies with the locked schema from ins-120-phase3-decisions.md.
      -- The table ships empty in Phase 3 so the drop-recreate is safe.
      DROP TABLE IF EXISTS propose_memory_policies;
      CREATE TABLE propose_memory_policies (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        role        TEXT NOT NULL,
        category    TEXT NOT NULL,
        mode        TEXT NOT NULL CHECK (mode IN ('auto_approve', 'pending')),
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        created_by  TEXT NOT NULL,
        notes       TEXT
      );
    `,
  },
  {
    version: 95,
    name: "orchestration_intelligence_schema",
    sql: `
      ALTER TABLE sprints
        ADD COLUMN auto_progression INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE tasks
        ADD COLUMN eligible_assignee_ids TEXT NOT NULL DEFAULT '[]';

      UPDATE tasks
      SET eligible_assignee_ids = json_array(assignee_agent_id)
      WHERE assignee_agent_id IS NOT NULL
        AND (eligible_assignee_ids IS NULL OR eligible_assignee_ids = '[]' OR TRIM(eligible_assignee_ids) = '');

      ALTER TABLE agents
        ADD COLUMN eligible_categories TEXT NOT NULL DEFAULT '[]';

      ALTER TABLE agents
        ADD COLUMN review_specialist_categories TEXT NOT NULL DEFAULT '[]';

      UPDATE agents
      SET eligible_categories = CASE
        WHEN lower(role) LIKE '%front%' OR lower(role) LIKE '%ui%' OR lower(role) LIKE '%product%' THEN '["frontend","ui"]'
        WHEN lower(role) LIKE '%qa%' OR lower(role) LIKE '%verification%' OR lower(role) LIKE '%review%' THEN '["qa","verification"]'
        WHEN lower(role) LIKE '%research%' OR lower(role) LIKE '%scan%' THEN '["research"]'
        WHEN lower(role) LIKE '%backend%' OR lower(role) LIKE '%integration%' OR lower(role) LIKE '%engineer%' THEN '["backend","implementation"]'
        WHEN lower(role) LIKE '%repo%' OR lower(role) LIKE '%release%' THEN '["release","repo"]'
        WHEN lower(role) LIKE '%legal%' OR lower(role) LIKE '%compliance%' THEN '["legal","compliance"]'
        WHEN lower(role) LIKE '%financial%' OR lower(role) LIKE '%audit%' THEN '["financial","audit"]'
        ELSE '[]'
      END
      WHERE eligible_categories IS NULL OR eligible_categories = '[]' OR TRIM(eligible_categories) = '';

      UPDATE agents
      SET review_specialist_categories = CASE
        WHEN lower(name) = 'lens' OR lower(role) LIKE '%visual%' THEN '["qa","visual","ui"]'
        WHEN lower(name) = 'clarity' OR lower(role) LIKE '%second-pass%' OR lower(role) LIKE '%second pass%' THEN '["qa","second_pass"]'
        WHEN lower(name) = 'gator' OR lower(role) LIKE '%qa%' OR lower(role) LIKE '%verification%' THEN '["qa","general"]'
        ELSE '[]'
      END
      WHERE review_specialist_categories IS NULL OR review_specialist_categories = '[]' OR TRIM(review_specialist_categories) = '';
    `,
  },
  {
    version: 96,
    name: "memory_candidates_specialist_approved_status",
    sql: `
      -- SQLite CHECK constraints can't be altered; rebuild the table to add specialist_approved.
      ALTER TABLE memory_candidates RENAME TO memory_candidates_v95;

      CREATE TABLE memory_candidates (
        id                  TEXT PRIMARY KEY,
        body                TEXT NOT NULL,
        type                TEXT,
        tags                TEXT,
        category            TEXT,
        status              TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','specialist_approved','rejected')),
        scope               TEXT NOT NULL DEFAULT 'role_project'
                              CHECK (scope IN ('role_project','company')),
        proposed_by_agent   TEXT,
        source_task_id      TEXT REFERENCES tasks(id),
        source_run_id       TEXT REFERENCES execution_runs(id),
        proposed_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        routing_target      TEXT,
        reviewed_by         TEXT,
        reviewed_at         TEXT,
        target_source_file  TEXT
      );

      INSERT INTO memory_candidates
        SELECT id, body, type, tags, category, status, scope, proposed_by_agent,
               source_task_id, source_run_id, proposed_at, routing_target,
               reviewed_by, reviewed_at, target_source_file
        FROM memory_candidates_v95;

      DROP TABLE memory_candidates_v95;

      CREATE INDEX IF NOT EXISTS idx_memory_candidates_status
        ON memory_candidates(status);
      CREATE INDEX IF NOT EXISTS idx_memory_candidates_proposed_at
        ON memory_candidates(proposed_at);
      CREATE INDEX IF NOT EXISTS idx_memory_candidates_source_task
        ON memory_candidates(source_task_id);
    `,
  },
  {
    version: 97,
    name: "execution_runs_add_metadata_json",
    sql: `ALTER TABLE execution_runs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';`,
  },
  {
    version: 98,
    name: "sprint_keys_and_to_do_review_transition",
    sql: `
      ALTER TABLE sprints ADD COLUMN sprint_key TEXT;

      WITH ranked_sprints AS (
        SELECT
          s.id,
          UPPER(COALESCE(c.company_code, substr(replace(c.name, ' ', ''), 1, 3))) || '-S' ||
            ROW_NUMBER() OVER (
              PARTITION BY s.parent_id
              ORDER BY s.created_at ASC, s.rowid ASC
            ) AS next_key
        FROM sprints s
        INNER JOIN projects p ON p.id = s.project_id
        INNER JOIN companies c ON c.id = p.company_id
        WHERE s.parent_id IS NOT NULL
      )
      UPDATE sprints
      SET sprint_key = (
        SELECT ranked_sprints.next_key
        FROM ranked_sprints
        WHERE ranked_sprints.id = sprints.id
      )
      WHERE id IN (SELECT id FROM ranked_sprints)
        AND (sprint_key IS NULL OR trim(sprint_key) = '');

      INSERT OR IGNORE INTO status_transition_rules
        (from_status, to_status, requires_assignee, requires_review, is_terminal)
      VALUES ('to-do', 'review', 0, 0, 0);
    `,
  },
  {
    version: 99,
    name: "cancel_stale_orphan_approvals",
    sql: `
      UPDATE approvals
      SET status = 'cancelled',
          decision_note = 'auto-cancelled: stale orphan approval (no linked task, predates 7-day threshold).',
          decided_by_user_id = COALESCE(decided_by_user_id, 'migration:v99'),
          decided_at = COALESCE(decided_at, ${NOW_SQL}),
          updated_at = ${NOW_SQL}
      WHERE status = 'pending'
        AND linked_task_id IS NULL
        AND (
          created_at < datetime('now', '-7 days')
          OR id IN (
            '294be0ce-16d9-43c4-b85a-5b80c87f411e',
            '5a185825-5d47-47d9-b5c0-e0d59237458e',
            'c5f3d828-df1a-44b4-83d2-714a4597a923',
            'cdc7a003-daf4-458e-878a-dd75370e60ad'
          )
        );
    `,
  },
  {
    version: 101,
    name: "company_memory_vault_index",
    sql: `
      -- Applied by applyCompanyMemoryVaultIndexMigration because local DBs may
      -- already contain some memory-source tables from earlier dev lanes.
      SELECT 1;
    `,
  },
  {
    version: 102,
    name: "company_wide_sprint_keys",
    sql: `
      WITH ranked_sprints AS (
        SELECT
          s.id,
          UPPER(COALESCE(NULLIF(c.company_code, ''), substr(replace(c.name, ' ', ''), 1, 3), 'SPR')) || '-S' ||
            printf('%03d', ROW_NUMBER() OVER (
              PARTITION BY c.id
              ORDER BY s.created_at ASC, s.rowid ASC
            )) AS next_key
        FROM sprints s
        INNER JOIN projects p ON p.id = s.project_id
        INNER JOIN companies c ON c.id = p.company_id
        WHERE s.parent_id IS NOT NULL
      )
      UPDATE sprints
      SET sprint_key = (
        SELECT ranked_sprints.next_key
        FROM ranked_sprints
        WHERE ranked_sprints.id = sprints.id
      )
      WHERE id IN (SELECT id FROM ranked_sprints);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_sprints_sprint_key_unique
        ON sprints(sprint_key)
        WHERE sprint_key IS NOT NULL AND trim(sprint_key) != '';
    `,
  },
  {
    version: 103,
    name: "company_goal_keys",
    sql: `
      -- Applied by applyCompanyGoalKeysMigration because SQLite does not
      -- support ALTER TABLE ADD COLUMN IF NOT EXISTS in this runtime.
      SELECT 1;
    `,
  },
  {
    version: 104,
    name: "sprints_archived_at",
    sql: `
      ALTER TABLE sprints ADD COLUMN archived_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_sprints_archived_at ON sprints(archived_at);
    `,
  },
  {
    version: 105,
    name: "memory_quality_curation_persistence",
    sql: `
      CREATE TABLE IF NOT EXISTS memory_quality_signals (
        id                  TEXT PRIMARY KEY,
        company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        target_type         TEXT NOT NULL CHECK (target_type IN ('source_index','memory_record')),
        target_id           TEXT NOT NULL,
        queue               TEXT NOT NULL CHECK (queue IN ('duplicates','stale','weak_provenance','broken_links','low_confidence')),
        severity            TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical','high','medium','low')),
        quality_score       REAL NOT NULL CHECK (quality_score >= 0 AND quality_score <= 100),
        confidence          REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
        reason              TEXT NOT NULL DEFAULT '',
        evidence_json       TEXT NOT NULL DEFAULT '{}',
        scoring_contract    TEXT NOT NULL,
        source_fingerprint  TEXT NOT NULL,
        computed_at         TEXT NOT NULL DEFAULT (${NOW_SQL}),
        created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        UNIQUE(company_id, target_type, target_id, queue, scoring_contract)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_quality_signals_company_queue
        ON memory_quality_signals(company_id, queue, quality_score ASC, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_memory_quality_signals_target
        ON memory_quality_signals(company_id, target_type, target_id, computed_at DESC);

      CREATE TABLE IF NOT EXISTS memory_quality_recomputations (
        id                  TEXT PRIMARY KEY,
        company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        scope               TEXT NOT NULL DEFAULT 'company' CHECK (scope IN ('company','target')),
        target_type         TEXT CHECK (target_type IS NULL OR target_type IN ('source_index','memory_record')),
        target_id           TEXT,
        recomputation_key   TEXT NOT NULL,
        input_hash          TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'completed'
                            CHECK (status IN ('pending','running','completed','failed','skipped')),
        scores_written      INTEGER NOT NULL DEFAULT 0 CHECK (scores_written >= 0),
        error               TEXT,
        started_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        completed_at        TEXT,
        created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        UNIQUE(company_id, scope, target_type, target_id, recomputation_key, input_hash)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_quality_recomputations_company
        ON memory_quality_recomputations(company_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS memory_curation_states (
        id                  TEXT PRIMARY KEY,
        company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        target_type         TEXT NOT NULL CHECK (target_type IN ('source_index','memory_record')),
        target_id           TEXT NOT NULL,
        state               TEXT NOT NULL DEFAULT 'open'
                            CHECK (state IN ('open','acknowledged','resolved','dismissed','superseded')),
        previous_state      TEXT CHECK (previous_state IS NULL OR previous_state IN ('open','acknowledged','resolved','dismissed','superseded')),
        acknowledged_at     TEXT,
        resolved_at         TEXT,
        dismissed_at        TEXT,
        superseded_at       TEXT,
        actor               TEXT,
        note                TEXT,
        metadata_json       TEXT NOT NULL DEFAULT '{}',
        created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        UNIQUE(company_id, target_type, target_id)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_curation_states_company_state
        ON memory_curation_states(company_id, state, updated_at DESC);

      CREATE TABLE IF NOT EXISTS memory_curation_actions (
        id                  TEXT PRIMARY KEY,
        company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        target_type         TEXT NOT NULL CHECK (target_type IN ('source_index','memory_record')),
        target_id           TEXT NOT NULL,
        action              TEXT NOT NULL CHECK (action IN ('acknowledge','resolve','dismiss','supersede','reopen')),
        from_state          TEXT CHECK (from_state IS NULL OR from_state IN ('open','acknowledged','resolved','dismissed','superseded')),
        to_state            TEXT NOT NULL CHECK (to_state IN ('open','acknowledged','resolved','dismissed','superseded')),
        actor               TEXT,
        note                TEXT,
        idempotency_key     TEXT NOT NULL,
        metadata_json       TEXT NOT NULL DEFAULT '{}',
        created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
        UNIQUE(company_id, target_type, target_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_curation_actions_target
        ON memory_curation_actions(company_id, target_type, target_id, created_at DESC);
    `,
  },
  {
    version: 106,
    name: "memory_curation_state_timestamps",
    sql: `
      ALTER TABLE memory_curation_states ADD COLUMN acknowledged_at TEXT;
      ALTER TABLE memory_curation_states ADD COLUMN resolved_at TEXT;
      ALTER TABLE memory_curation_states ADD COLUMN dismissed_at TEXT;
      ALTER TABLE memory_curation_states ADD COLUMN superseded_at TEXT;
    `,
  },
  {
    version: 107,
    name: "memory_curation_current_lifecycle",
    sql: `
      -- Applied by applyMemoryCurationCurrentLifecycleMigration because
      -- SQLite cannot alter CHECK constraints in place.
      SELECT 1;
    `,
  },
  {
    version: 108,
    name: "memory_curation_extended_lifecycle",
    sql: `
      -- Applied by applyMemoryCurationExtendedLifecycleMigration because
      -- SQLite cannot alter CHECK constraints in place.
      SELECT 1;
    `,
  },
  {
    version: 109,
    name: "wiki_writeback_request_provenance",
    sql: `
      CREATE TABLE IF NOT EXISTS wiki_writeback_requests (
        id                        TEXT PRIMARY KEY,
        company_id                TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        approval_state            TEXT NOT NULL DEFAULT 'requested'
                                  CHECK (approval_state IN ('requested','approved','rejected','written','failed','rolled_back')),
        target_path               TEXT NOT NULL,
        idempotency_key           TEXT NOT NULL,
        source_memory_ids_json    TEXT NOT NULL DEFAULT '[]',
        curation_action_ids_json  TEXT NOT NULL DEFAULT '[]',
        generated_content_hash    TEXT NOT NULL,
        previous_file_hash        TEXT,
        rollback_json             TEXT NOT NULL DEFAULT '{}',
        requested_by              TEXT,
        approved_by               TEXT,
        rejection_reason          TEXT,
        failure_reason            TEXT,
        approved_at               TEXT,
        written_at                TEXT,
        rolled_back_at            TEXT,
        created_at                TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at                TEXT NOT NULL DEFAULT (${NOW_SQL}),
        UNIQUE(company_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_wiki_writeback_requests_company_state
        ON wiki_writeback_requests(company_id, approval_state, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_wiki_writeback_requests_target
        ON wiki_writeback_requests(company_id, target_path, updated_at DESC);
    `,
  },
  {
    version: 110,
    name: "normalize_approval_state_in_memory_index",
    sql: `
      -- Normalize approval_state in memory_source_index frontmatter.
      -- When review_state is present in frontmatter, add approval_state if missing.
      UPDATE memory_source_index
      SET frontmatter_json = json_set(
        frontmatter_json,
        '$.approval_state',
        json_extract(frontmatter_json, '$.review_state')
      )
      WHERE json_extract(frontmatter_json, '$.approval_state') IS NULL
        AND json_extract(frontmatter_json, '$.review_state') IS NOT NULL;
    `,
  },
];

let dbInstance: Database.Database | null = null;

function isDirectTestEntrypoint(): boolean {
  return process.argv.some((arg) => /(?:__tests__|\.test\.[cm]?[jt]sx?)$/.test(arg));
}

function resolveConfiguredOrchestrationDbPath(): string {
  if (process.env.ORCHESTRATION_DB_PATH?.trim()) {
    return path.resolve(process.env.ORCHESTRATION_DB_PATH);
  }

  const defaultPath = path.join(MC_DATA_DIR, "orchestration.db");
  if (!isDirectTestEntrypoint()) {
    return defaultPath;
  }

  const liveDbCandidates = new Set([
    path.resolve(defaultPath),
    path.resolve(process.cwd(), "data", "orchestration.db"),
    path.resolve(process.cwd(), "data-dev", "orchestration.db"),
  ]);

  if (liveDbCandidates.has(path.resolve(defaultPath))) {
    throw new Error(
      [
        "Refusing to run a direct test entrypoint against a live HiveRunner orchestration DB.",
        "Set ORCHESTRATION_DB_PATH to an isolated temp file, for example:",
        "ORCHESTRATION_DB_PATH=/tmp/hiverunner-test.db npx tsx src/lib/__tests__/your-test.ts",
      ].join(" "),
    );
  }

  return path.join(os.tmpdir(), `hiverunner-orchestration-test-${process.pid}.db`);
}

const ORCHESTRATION_DB_PATH = resolveConfiguredOrchestrationDbPath();

export function getOrchestrationDbPath(): string {
  return ORCHESTRATION_DB_PATH;
}

function normalizeDbTaskStatusSql(columnRef: string): string {
  return `
    CASE
      WHEN ${columnRef} IS NULL OR TRIM(${columnRef}) = '' THEN 'backlog'
      WHEN lower(replace(replace(trim(${columnRef}), '-', '_'), ' ', '_')) IN ('backlog') THEN 'backlog'
      WHEN lower(replace(replace(trim(${columnRef}), '-', '_'), ' ', '_')) IN ('on_deck', 'to_do', 'ondeck', 'todo', 'queued') THEN 'to-do'
      WHEN lower(replace(replace(trim(${columnRef}), '-', '_'), ' ', '_')) IN ('in_progress', 'inprogress', 'active', 'working') THEN 'in_progress'
      WHEN lower(replace(replace(trim(${columnRef}), '-', '_'), ' ', '_')) IN ('review', 'in_review', 'inreview', 'qa') THEN 'review'
      WHEN lower(replace(replace(trim(${columnRef}), '-', '_'), ' ', '_')) IN ('done', 'completed', 'complete', 'closed', 'resolved') THEN 'done'
      WHEN lower(replace(replace(trim(${columnRef}), '-', '_'), ' ', '_')) IN ('blocked', 'block', 'blocked_waiting', 'waiting') THEN 'blocked'
      ELSE 'backlog'
    END
  `;
}

export function normalizeOrchestrationStatusValues(db = getOrchestrationDb()): {
  tasksNormalized: number;
  taskEventsNormalized: number;
  transitionRulesNormalized: number;
} {
  const normalizeTasksSql = normalizeDbTaskStatusSql("status");
  const normalizeFromStatusSql = normalizeDbTaskStatusSql("from_status");
  const normalizeToStatusSql = normalizeDbTaskStatusSql("to_status");

  const apply = db.transaction(() => {
    const tasksResult = db
      .prepare(
        `UPDATE tasks
         SET status = ${normalizeTasksSql},
             updated_at = ${NOW_SQL}
         WHERE status != ${normalizeTasksSql}`
      )
      .run();

    const taskEventsFromResult = db
      .prepare(
        `UPDATE task_events
         SET from_status = ${normalizeFromStatusSql}
         WHERE from_status IS NOT NULL
           AND from_status != ${normalizeFromStatusSql}`
      )
      .run();

    const taskEventsToResult = db
      .prepare(
        `UPDATE task_events
         SET to_status = ${normalizeToStatusSql}
         WHERE to_status IS NOT NULL
           AND to_status != ${normalizeToStatusSql}`
      )
      .run();

    db.exec(`
      CREATE TEMP TABLE _normalized_status_transition_rules (
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        requires_assignee INTEGER NOT NULL,
        requires_review INTEGER NOT NULL,
        is_terminal INTEGER NOT NULL,
        PRIMARY KEY (from_status, to_status)
      );

      INSERT OR IGNORE INTO _normalized_status_transition_rules (
        from_status,
        to_status,
        requires_assignee,
        requires_review,
        is_terminal
      )
      SELECT
        ${normalizeDbTaskStatusSql("from_status")} AS from_status,
        ${normalizeDbTaskStatusSql("to_status")} AS to_status,
        MAX(CASE WHEN requires_assignee = 1 THEN 1 ELSE 0 END) AS requires_assignee,
        MAX(CASE WHEN requires_review = 1 THEN 1 ELSE 0 END) AS requires_review,
        MAX(CASE WHEN is_terminal = 1 THEN 1 ELSE 0 END) AS is_terminal
      FROM status_transition_rules
      GROUP BY 1, 2;

      DELETE FROM status_transition_rules;

      INSERT INTO status_transition_rules (
        from_status,
        to_status,
        requires_assignee,
        requires_review,
        is_terminal
      )
      SELECT
        from_status,
        to_status,
        requires_assignee,
        requires_review,
        is_terminal
      FROM _normalized_status_transition_rules
      WHERE from_status IN ('backlog','to-do','in_progress','review','done','blocked')
        AND to_status IN ('backlog','to-do','in_progress','review','done','blocked');

      DROP TABLE _normalized_status_transition_rules;
    `);

    db.exec(`
      INSERT OR IGNORE INTO status_transition_rules (from_status, to_status, requires_assignee, requires_review, is_terminal) VALUES
        ('backlog', 'to-do', 0, 0, 0),
        ('backlog', 'blocked', 0, 0, 1),
        ('to-do', 'backlog', 0, 0, 0),
        ('to-do', 'in_progress', 1, 0, 0),
        ('to-do', 'blocked', 0, 0, 1),
        ('in_progress', 'review', 0, 0, 0),
        ('in_progress', 'blocked', 0, 0, 1),
        ('in_progress', 'to-do', 0, 0, 0),
        ('in_progress', 'done', 0, 0, 1),
        ('review', 'done', 0, 0, 1),
        ('review', 'in_progress', 0, 0, 0),
        ('review', 'blocked', 0, 0, 1),
        ('blocked', 'to-do', 0, 0, 0),
        ('blocked', 'in_progress', 1, 0, 0),
        ('blocked', 'review', 0, 0, 0),
        ('done', 'review', 0, 0, 0);
    `);

    const transitionRulesCount = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM status_transition_rules
         WHERE from_status NOT IN ('backlog','to-do','in_progress','review','done','blocked')
            OR to_status NOT IN ('backlog','to-do','in_progress','review','done','blocked')`
      )
      .get() as { count: number };

    return {
      tasksNormalized: tasksResult.changes,
      taskEventsNormalized: taskEventsFromResult.changes + taskEventsToResult.changes,
      transitionRulesNormalized: Number(transitionRulesCount.count ?? 0),
    };
  });

  return apply();
}

function ensureDataDir(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export type OrchestrationMigrationIssue = {
  version: number;
  name: string;
  reason: "missing" | "checksum_mismatch" | "future_migration" | "legacy_extra";
  expectedChecksum?: string;
  actualChecksum?: string;
  compatibleChecksums?: string[];
};

export type OrchestrationMigrationCompatibility = {
  ok: boolean;
  expectedLatestVersion: number;
  expectedLatestName: string;
  appliedLatestVersion: number | null;
  appliedLatestName: string | null;
  checkedCount: number;
  pending: OrchestrationMigrationIssue[];
  incompatible: OrchestrationMigrationIssue[];
  legacyExtra: OrchestrationMigrationIssue[];
};

export function checkOrchestrationMigrationCompatibility(
  db: Database.Database,
): OrchestrationMigrationCompatibility {
  const expectedLatest = MIGRATIONS[MIGRATIONS.length - 1];
  if (!expectedLatest) {
    throw new Error("No orchestration migrations are defined.");
  }

  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get() as { name: string } | undefined;
  if (!table) {
    return {
      ok: true,
      expectedLatestVersion: expectedLatest.version,
      expectedLatestName: expectedLatest.name,
      appliedLatestVersion: null,
      appliedLatestName: null,
      checkedCount: 0,
      pending: MIGRATIONS.map((migration) => ({
        version: migration.version,
        name: migration.name,
        reason: "missing",
      })),
      incompatible: [],
      legacyExtra: [],
    };
  }

  const appliedRows = db
    .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC")
    .all() as Array<{ version: number; name: string; checksum: string }>;
  const appliedByVersion = new Map(appliedRows.map((row) => [row.version, row]));
  const expectedByVersion = new Map(MIGRATIONS.map((migration) => [migration.version, migration]));

  const pending: OrchestrationMigrationIssue[] = [];
  const incompatible: OrchestrationMigrationIssue[] = [];
  const legacyExtra: OrchestrationMigrationIssue[] = [];

  for (const migration of MIGRATIONS) {
    const expectedChecksum = migrationChecksum(migration.sql);
    const row = appliedByVersion.get(migration.version);
    if (!row) {
      pending.push({
        version: migration.version,
        name: migration.name,
        reason: "missing",
        expectedChecksum,
      });
      continue;
    }

    const acceptedChecksums = new Set([
      expectedChecksum,
      ...(migration.compatibleChecksums ?? []),
    ]);
    if (!acceptedChecksums.has(row.checksum)) {
      incompatible.push({
        version: migration.version,
        name: migration.name,
        reason: "checksum_mismatch",
        expectedChecksum,
        actualChecksum: row.checksum,
        compatibleChecksums: [...(migration.compatibleChecksums ?? [])],
      });
    }
  }

  for (const row of appliedRows) {
    if (!expectedByVersion.has(row.version)) {
      const issue: OrchestrationMigrationIssue = {
        version: row.version,
        name: row.name,
        reason:
          row.version > expectedLatest.version ? "future_migration" : "legacy_extra",
        actualChecksum: row.checksum,
      };
      if (issue.reason === "future_migration") {
        incompatible.push(issue);
      } else {
        legacyExtra.push(issue);
      }
    }
  }

  const appliedLatest = appliedRows.at(-1);

  return {
    ok: incompatible.length === 0,
    expectedLatestVersion: expectedLatest.version,
    expectedLatestName: expectedLatest.name,
    appliedLatestVersion: appliedLatest?.version ?? null,
    appliedLatestName: appliedLatest?.name ?? null,
    checkedCount: appliedRows.length,
    pending,
    incompatible,
    legacyExtra,
  };
}

function createMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      checksum    TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (${NOW_SQL})
    );
  `);
}

function getAppliedMigration(
  db: Database.Database,
  version: number
): { version: number; name: string; checksum: string } | undefined {
  return db
    .prepare("SELECT version, name, checksum FROM schema_migrations WHERE version = ?")
    .get(version) as { version: number; name: string; checksum: string } | undefined;
}

function ensureColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string
): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
}

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
  return columns.some((column) => column.name === columnName);
}

function memoryCurationLifecycleIsCurrent(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_curation_states'")
    .get() as { sql: string | null } | undefined;
  return Boolean(row?.sql?.includes("'acknowledged'") && row.sql.includes("'resolved'") && row.sql.includes("'superseded'"));
}

function applyMemoryCurationCurrentLifecycleMigration(db: Database.Database): void {
  if (memoryCurationLifecycleIsCurrent(db)) {
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_curation_states_current (
      id                  TEXT PRIMARY KEY,
      company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      target_type         TEXT NOT NULL CHECK (target_type IN ('source_index','memory_record')),
      target_id           TEXT NOT NULL,
      state               TEXT NOT NULL DEFAULT 'open'
                          CHECK (state IN ('open','acknowledged','resolved','dismissed','superseded')),
      previous_state      TEXT CHECK (previous_state IS NULL OR previous_state IN ('open','acknowledged','resolved','dismissed','superseded')),
      acknowledged_at     TEXT,
      resolved_at         TEXT,
      dismissed_at        TEXT,
      superseded_at       TEXT,
      actor               TEXT,
      note                TEXT,
      metadata_json       TEXT NOT NULL DEFAULT '{}',
      created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
      updated_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
      UNIQUE(company_id, target_type, target_id)
    );

    INSERT OR IGNORE INTO memory_curation_states_current (
      id, company_id, target_type, target_id, state, previous_state,
      acknowledged_at, resolved_at, dismissed_at, superseded_at, actor, note,
      metadata_json, created_at, updated_at
    )
    SELECT
      id,
      company_id,
      target_type,
      target_id,
      CASE state
        WHEN 'reviewed' THEN 'acknowledged'
        WHEN 'archived' THEN 'superseded'
        ELSE state
      END,
      CASE previous_state
        WHEN 'reviewed' THEN 'acknowledged'
        WHEN 'archived' THEN 'superseded'
        ELSE previous_state
      END,
      COALESCE(acknowledged_at, reviewed_at),
      resolved_at,
      dismissed_at,
      COALESCE(superseded_at, archived_at),
      actor,
      note,
      metadata_json,
      created_at,
      updated_at
    FROM memory_curation_states;

    DROP TABLE memory_curation_states;
    ALTER TABLE memory_curation_states_current RENAME TO memory_curation_states;

    CREATE INDEX IF NOT EXISTS idx_memory_curation_states_company_state
      ON memory_curation_states(company_id, state, updated_at DESC);

    CREATE TABLE IF NOT EXISTS memory_curation_actions_current (
      id                  TEXT PRIMARY KEY,
      company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      target_type         TEXT NOT NULL CHECK (target_type IN ('source_index','memory_record')),
      target_id           TEXT NOT NULL,
      action              TEXT NOT NULL CHECK (action IN ('acknowledge','resolve','dismiss','supersede','reopen')),
      from_state          TEXT CHECK (from_state IS NULL OR from_state IN ('open','acknowledged','resolved','dismissed','superseded')),
      to_state            TEXT NOT NULL CHECK (to_state IN ('open','acknowledged','resolved','dismissed','superseded')),
      actor               TEXT,
      note                TEXT,
      idempotency_key     TEXT NOT NULL,
      metadata_json       TEXT NOT NULL DEFAULT '{}',
      created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
      UNIQUE(company_id, target_type, target_id, idempotency_key)
    );

    INSERT OR IGNORE INTO memory_curation_actions_current (
      id, company_id, target_type, target_id, action, from_state, to_state,
      actor, note, idempotency_key, metadata_json, created_at
    )
    SELECT
      id, company_id, target_type, target_id, action, from_state, to_state,
      actor, note, idempotency_key, metadata_json, created_at
    FROM memory_curation_actions;

    DROP TABLE memory_curation_actions;
    ALTER TABLE memory_curation_actions_current RENAME TO memory_curation_actions;

    CREATE INDEX IF NOT EXISTS idx_memory_curation_actions_target
      ON memory_curation_actions(company_id, target_type, target_id, created_at DESC);
  `);
}

function applyMemoryCurationExtendedLifecycleMigration(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_curation_states_extended (
      id                  TEXT PRIMARY KEY,
      company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      target_type         TEXT NOT NULL CHECK (target_type IN ('source_index','memory_record')),
      target_id           TEXT NOT NULL,
      state               TEXT NOT NULL DEFAULT 'open'
                          CHECK (state IN ('open','reviewed','acknowledged','resolved','dismissed','superseded','archived','rewrite_requested','merge_candidate')),
      previous_state      TEXT CHECK (previous_state IS NULL OR previous_state IN ('open','reviewed','acknowledged','resolved','dismissed','superseded','archived','rewrite_requested','merge_candidate')),
      acknowledged_at     TEXT,
      resolved_at         TEXT,
      dismissed_at        TEXT,
      superseded_at       TEXT,
      archived_at         TEXT,
      actor               TEXT,
      note                TEXT,
      metadata_json       TEXT NOT NULL DEFAULT '{}',
      created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
      updated_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
      UNIQUE(company_id, target_type, target_id)
    );

    INSERT OR IGNORE INTO memory_curation_states_extended (
      id, company_id, target_type, target_id, state, previous_state,
      acknowledged_at, resolved_at, dismissed_at, superseded_at, archived_at,
      actor, note, metadata_json, created_at, updated_at
    )
    SELECT
      id, company_id, target_type, target_id, state, previous_state,
      acknowledged_at, resolved_at, dismissed_at, superseded_at, NULL,
      actor, note, metadata_json, created_at, updated_at
    FROM memory_curation_states;

    DROP TABLE memory_curation_states;
    ALTER TABLE memory_curation_states_extended RENAME TO memory_curation_states;

    CREATE INDEX IF NOT EXISTS idx_memory_curation_states_company_state
      ON memory_curation_states(company_id, state, updated_at DESC);

    CREATE TABLE IF NOT EXISTS memory_curation_actions_extended (
      id                  TEXT PRIMARY KEY,
      company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      target_type         TEXT NOT NULL CHECK (target_type IN ('source_index','memory_record')),
      target_id           TEXT NOT NULL,
      action              TEXT NOT NULL CHECK (action IN ('mark_reviewed','acknowledge','resolve','dismiss','supersede','reopen','archive','request_rewrite','suggest_merge','restore')),
      from_state          TEXT CHECK (from_state IS NULL OR from_state IN ('open','reviewed','acknowledged','resolved','dismissed','superseded','archived','rewrite_requested','merge_candidate')),
      to_state            TEXT NOT NULL CHECK (to_state IN ('open','reviewed','acknowledged','resolved','dismissed','superseded','archived','rewrite_requested','merge_candidate')),
      actor               TEXT,
      note                TEXT,
      idempotency_key     TEXT NOT NULL,
      metadata_json       TEXT NOT NULL DEFAULT '{}',
      created_at          TEXT NOT NULL DEFAULT (${NOW_SQL}),
      UNIQUE(company_id, target_type, target_id, idempotency_key)
    );

    INSERT OR IGNORE INTO memory_curation_actions_extended (
      id, company_id, target_type, target_id, action, from_state, to_state,
      actor, note, idempotency_key, metadata_json, created_at
    )
    SELECT
      id, company_id, target_type, target_id, action, from_state, to_state,
      actor, note, idempotency_key, metadata_json, created_at
    FROM memory_curation_actions;

    DROP TABLE memory_curation_actions;
    ALTER TABLE memory_curation_actions_extended RENAME TO memory_curation_actions;

    CREATE INDEX IF NOT EXISTS idx_memory_curation_actions_target
      ON memory_curation_actions(company_id, target_type, target_id, created_at DESC);
  `);
}

function executionRunsProviderAllowsSymphony(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'execution_runs'")
    .get() as { sql: string | null } | undefined;
  return Boolean(row?.sql?.includes("'symphony'"));
}

function repairCompatibleAppliedMigrationIfNeeded(
  db: Database.Database,
  migration: { version: number; name: string; sql: string },
): number {
  if (migration.version === 70) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_execution_runs_runner_identity
        ON execution_runs(execution_engine, runner_provider, status, updated_at DESC);
    `);
    return 1;
  } else if (migration.version === 86 && !hasColumn(db, "sprints", "lead_agent_id")) {
    applyGoalContractSchemaMigration(db);
    return 1;
  } else if (migration.version === 101) {
    applyCompanyMemoryVaultIndexMigration(db);
    return 1;
  } else if (migration.version === 103) {
    applyCompanyGoalKeysMigration(db);
    return 1;
  } else if (migration.version === 107 && !memoryCurationLifecycleIsCurrent(db)) {
    applyMemoryCurationCurrentLifecycleMigration(db);
    return 1;
  }
  return 0;
}

function executeMigrationSqlIdempotently(db: Database.Database, sql: string): void {
  const statements = sql
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    try {
      db.exec(`${statement};`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const duplicateColumn = /duplicate column name/i.test(message);
      const duplicateIndex = /index .* already exists/i.test(message);
      if (duplicateColumn || duplicateIndex) {
        continue;
      }
      throw error;
    }
  }
}

function repairAppliedMigrationChecksumIfPossible(
  db: Database.Database,
  migration: { version: number; name: string; sql: string },
  expectedChecksum: string,
  existing: { version: number; name: string; checksum: string },
): boolean {
  try {
    executeMigrationSqlIdempotently(db, migration.sql);
    db.prepare("UPDATE schema_migrations SET name = ?, checksum = ? WHERE version = ?").run(
      migration.name,
      expectedChecksum,
      migration.version,
    );
    console.warn(`[migrations] self-healed applied migration v${migration.version} (${migration.name}); checksum ${existing.checksum} -> ${expectedChecksum}`);
    return true;
  } catch (error) {
    console.warn(
      `[migrations] self-heal skipped for v${migration.version} (${migration.name}):`,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

function markOutOfBandMigrationIfAlreadyApplied(
  db: Database.Database,
  migration: { version: number; name: string; sql: string },
  checksum: string
): boolean {
  if (migration.version === 63 && hasColumn(db, "tasks", "execution_engine")) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_execution_engine_status
        ON tasks(execution_engine, status, updated_at DESC);
    `);
  } else if (
    migration.version === 70 &&
    hasColumn(db, "execution_runs", "execution_engine") &&
    hasColumn(db, "execution_runs", "runner_provider") &&
    hasColumn(db, "execution_runs", "runner_model")
  ) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_execution_runs_runner_identity
        ON execution_runs(execution_engine, runner_provider, status, updated_at DESC);
    `);
  } else if (migration.version === 64 && executionRunsProviderAllowsSymphony(db)) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_execution_runs_task_created_at
        ON execution_runs(task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_execution_runs_task_status
        ON execution_runs(task_id, status);
      CREATE INDEX IF NOT EXISTS idx_execution_runs_provider_status
        ON execution_runs(provider, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_runs_idempotency_key
        ON execution_runs(idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);
  } else if (
    migration.version === 82 &&
    hasColumn(db, "approvals", "approver_agent_id") &&
    hasColumn(db, "approvals", "approval_route_reason")
  ) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_approvals_approver_status
        ON approvals(approver_agent_id, status, updated_at DESC)
        WHERE approver_agent_id IS NOT NULL;
    `);
  } else if (migration.version === 103 && hasColumn(db, "sprints", "goal_key")) {
    applyCompanyGoalKeysMigration(db);
  } else {
    return false;
  }

  db.prepare(
    "INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)"
  ).run(migration.version, migration.name, checksum);
  return true;
}

function ensureOrchestrationSchemaCompatibility(db: Database.Database): void {
  ensureColumn(db, "companies", "settings_json", "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, "execution_runs", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
}

function applyCompanyMemoryVaultIndexMigration(db: Database.Database): void {
  ensureColumn(db, "memory_candidates", "company_id", "TEXT REFERENCES companies(id) ON DELETE CASCADE");

  const existingMemoryIndex = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_source_index'")
    .get() as { sql: string | null } | undefined;
  if (existingMemoryIndex?.sql && !existingMemoryIndex.sql.includes("DEFAULT 'company'")) {
    const backupName = "memory_source_index_v101_backup";
    db.exec(`DROP TABLE IF EXISTS ${backupName}; ALTER TABLE memory_source_index RENAME TO ${backupName};`);
    db.exec(`
      CREATE TABLE memory_source_index (
        record_id             TEXT PRIMARY KEY,
        company_id            TEXT REFERENCES companies(id) ON DELETE CASCADE,
        source_id             TEXT NOT NULL,
        source_path           TEXT NOT NULL,
        layer                 TEXT NOT NULL DEFAULT 'company',
        title                 TEXT NOT NULL DEFAULT '',
        content_excerpt       TEXT NOT NULL DEFAULT '',
        content_fts           TEXT NOT NULL DEFAULT '',
        file_type             TEXT NOT NULL DEFAULT 'markdown',
        created_at            TEXT,
        updated_at            TEXT,
        file_mtime            TEXT,
        frontmatter_json      TEXT NOT NULL DEFAULT '{}',
        tags_json             TEXT NOT NULL DEFAULT '[]',
        linked_ids_json       TEXT NOT NULL DEFAULT '[]',
        subdirectory          TEXT,
        agent_attribution     TEXT,
        project_link          TEXT,
        pinned                INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
        hiverunner_tags_json  TEXT NOT NULL DEFAULT '[]',
        status                TEXT NOT NULL DEFAULT 'active',
        indexed_at            TEXT NOT NULL DEFAULT (${NOW_SQL}),
        index_error           TEXT
      );
    `);
    const backupHasCompanyId = hasColumn(db, backupName, "company_id");
    db.exec(`
      INSERT OR IGNORE INTO memory_source_index (
        record_id, company_id, source_id, source_path, layer, title, content_excerpt, content_fts,
        file_type, created_at, updated_at, file_mtime, frontmatter_json, tags_json, linked_ids_json,
        subdirectory, agent_attribution, project_link, pinned, hiverunner_tags_json, status, indexed_at, index_error
      )
      SELECT
        record_id,
        ${backupHasCompanyId ? "company_id" : "NULL"} AS company_id,
        source_id,
        source_path,
        CASE WHEN layer = 'operator' THEN 'company' ELSE layer END AS layer,
        title,
        COALESCE(content_excerpt, ''),
        COALESCE(content_fts, content_excerpt, ''),
        COALESCE(file_type, 'markdown'),
        created_at,
        updated_at,
        file_mtime,
        COALESCE(frontmatter_json, '{}'),
        COALESCE(tags_json, '[]'),
        COALESCE(linked_ids_json, '[]'),
        subdirectory,
        agent_attribution,
        project_link,
        COALESCE(pinned, 0),
        COALESCE(hiverunner_tags_json, '[]'),
        COALESCE(status, 'active'),
        COALESCE(indexed_at, ${NOW_SQL}),
        index_error
      FROM ${backupName};
    `);
    db.exec(`DROP TABLE IF EXISTS ${backupName};`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_source_index (
      record_id             TEXT PRIMARY KEY,
      company_id            TEXT REFERENCES companies(id) ON DELETE CASCADE,
      source_id             TEXT NOT NULL,
      source_path           TEXT NOT NULL,
      layer                 TEXT NOT NULL DEFAULT 'company',
      title                 TEXT NOT NULL DEFAULT '',
      content_excerpt       TEXT NOT NULL DEFAULT '',
      content_fts           TEXT NOT NULL DEFAULT '',
      file_type             TEXT NOT NULL DEFAULT 'markdown',
      created_at            TEXT,
      updated_at            TEXT,
      file_mtime            TEXT,
      frontmatter_json      TEXT NOT NULL DEFAULT '{}',
      tags_json             TEXT NOT NULL DEFAULT '[]',
      linked_ids_json       TEXT NOT NULL DEFAULT '[]',
      subdirectory          TEXT,
      agent_attribution     TEXT,
      project_link          TEXT,
      pinned                INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1)),
      hiverunner_tags_json  TEXT NOT NULL DEFAULT '[]',
      status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','error')),
      indexed_at            TEXT NOT NULL DEFAULT (${NOW_SQL}),
      index_error           TEXT
    );
  `);

  ensureColumn(db, "memory_source_index", "company_id", "TEXT REFERENCES companies(id) ON DELETE CASCADE");
  ensureColumn(db, "memory_source_index", "source_id", "TEXT NOT NULL DEFAULT 'unknown'");
  ensureColumn(db, "memory_source_index", "content_fts", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "memory_source_index", "hiverunner_tags_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "memory_source_index", "status", "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(db, "memory_source_index", "indexed_at", `TEXT NOT NULL DEFAULT (${NOW_SQL})`);
  ensureColumn(db, "memory_source_index", "index_error", "TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_source_index_source_path
      ON memory_source_index(source_path);
  `);

  if (hasColumn(db, "memory_source_index", "company_id")) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_source_index_company_status
        ON memory_source_index(company_id, status, indexed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_source_index_layer
        ON memory_source_index(company_id, layer, status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_source_index_company_path
        ON memory_source_index(company_id, source_path)
        WHERE company_id IS NOT NULL;
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_sync_log (
      id                TEXT PRIMARY KEY,
      company_id        TEXT REFERENCES companies(id) ON DELETE CASCADE,
      source_id         TEXT NOT NULL,
      started_at        TEXT NOT NULL DEFAULT (${NOW_SQL}),
      completed_at      TEXT,
      files_checked     INTEGER NOT NULL DEFAULT 0,
      files_reindexed   INTEGER NOT NULL DEFAULT 0,
      files_removed     INTEGER NOT NULL DEFAULT 0,
      errors            INTEGER NOT NULL DEFAULT 0,
      error_detail      TEXT
    );
  `);
  ensureColumn(db, "memory_sync_log", "company_id", "TEXT REFERENCES companies(id) ON DELETE CASCADE");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_sync_log_company_started
      ON memory_sync_log(company_id, started_at DESC);
  `);

  const existingWritebackLog = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_writeback_log'")
    .get() as { sql: string | null } | undefined;
  if (
    existingWritebackLog?.sql &&
    (
      existingWritebackLog.sql.includes("memory_source_index_v101_backup") ||
      existingWritebackLog.sql.includes("CHECK (action IN ('tag_write'") ||
      !hasColumn(db, "memory_writeback_log", "company_id") ||
      !hasColumn(db, "memory_writeback_log", "candidate_id")
    )
  ) {
    const backupName = "memory_writeback_log_v101_backup";
    db.exec(`DROP TABLE IF EXISTS ${backupName}; ALTER TABLE memory_writeback_log RENAME TO ${backupName};`);
    db.exec(`
      CREATE TABLE memory_writeback_log (
        id                TEXT PRIMARY KEY,
        company_id        TEXT REFERENCES companies(id) ON DELETE CASCADE,
        candidate_id      TEXT REFERENCES memory_candidates(id) ON DELETE SET NULL,
        record_id         TEXT,
        source_path       TEXT NOT NULL,
        action            TEXT NOT NULL DEFAULT 'create',
        before_snapshot   TEXT,
        after_snapshot    TEXT,
        written_at        TEXT NOT NULL DEFAULT (${NOW_SQL}),
        attribution       TEXT,
        error             TEXT
      );
    `);
    const backupHasCompanyId = hasColumn(db, backupName, "company_id");
    const backupHasCandidateId = hasColumn(db, backupName, "candidate_id");
    db.exec(`
      INSERT OR IGNORE INTO memory_writeback_log (
        id, company_id, candidate_id, record_id, source_path, action,
        before_snapshot, after_snapshot, written_at, attribution, error
      )
      SELECT
        'legacy-' || CAST(id AS TEXT),
        ${backupHasCompanyId ? "company_id" : "NULL"} AS company_id,
        ${backupHasCandidateId ? "candidate_id" : "NULL"} AS candidate_id,
        record_id,
        source_path,
        CASE
          WHEN action IN ('create','append','append_failed') THEN action
          ELSE 'legacy_' || action
        END AS action,
        before_snapshot,
        after_snapshot,
        CAST(written_at AS TEXT),
        attribution,
        error
      FROM ${backupName}
      WHERE source_path IS NOT NULL;
    `);
    db.exec(`DROP TABLE IF EXISTS ${backupName};`);
  }

  db.exec(`

    CREATE TABLE IF NOT EXISTS memory_writeback_log (
      id                TEXT PRIMARY KEY,
      company_id        TEXT REFERENCES companies(id) ON DELETE CASCADE,
      candidate_id      TEXT REFERENCES memory_candidates(id) ON DELETE SET NULL,
      record_id         TEXT,
      source_path       TEXT NOT NULL,
      action            TEXT NOT NULL DEFAULT 'create',
      before_snapshot   TEXT,
      after_snapshot    TEXT,
      written_at        TEXT NOT NULL DEFAULT (${NOW_SQL}),
      attribution       TEXT,
      error             TEXT
    );
  `);
  ensureColumn(db, "memory_writeback_log", "company_id", "TEXT REFERENCES companies(id) ON DELETE CASCADE");
  ensureColumn(db, "memory_writeback_log", "candidate_id", "TEXT REFERENCES memory_candidates(id) ON DELETE SET NULL");
  ensureColumn(db, "memory_writeback_log", "record_id", "TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_writeback_company_written
      ON memory_writeback_log(company_id, written_at DESC);
  `);

  db.exec(`
    UPDATE memory_candidates
    SET company_id = (
      SELECT p.company_id
      FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = memory_candidates.source_task_id
      LIMIT 1
    )
    WHERE company_id IS NULL
      AND source_task_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE t.id = memory_candidates.source_task_id
      );
  `);
}

function applyCompanyGoalKeysMigration(db: Database.Database): void {
  ensureColumn(db, "sprints", "goal_key", "TEXT");
  db.exec(`
    WITH ranked_goals AS (
      SELECT
        s.id,
        UPPER(COALESCE(NULLIF(c.company_code, ''), substr(replace(c.name, ' ', ''), 1, 3), 'GOAL')) || '-G' ||
          printf('%03d', ROW_NUMBER() OVER (
            PARTITION BY c.id
            ORDER BY s.created_at ASC, s.rowid ASC
          )) AS next_key
      FROM sprints s
      INNER JOIN projects p ON p.id = s.project_id
      INNER JOIN companies c ON c.id = p.company_id
      WHERE s.goal_kind = 'company'
    )
    UPDATE sprints
    SET goal_key = (
      SELECT ranked_goals.next_key
      FROM ranked_goals
      WHERE ranked_goals.id = sprints.id
    )
    WHERE id IN (SELECT id FROM ranked_goals)
      AND (goal_key IS NULL OR trim(goal_key) = '');

    CREATE UNIQUE INDEX IF NOT EXISTS idx_sprints_goal_key_unique
      ON sprints(goal_key)
      WHERE goal_key IS NOT NULL AND trim(goal_key) != '';
  `);
}

function normalizePathPart(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/'/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "company";
}

function isSameOrNestedPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function archiveRemainingLegacyDirectory(source: string, destination: string): void {
  if (!fs.existsSync(source)) return;

  const archiveRoot = path.join(destination, ".legacy-workspace-conflicts");
  const baseName = path.basename(source);
  let archiveDestination = path.join(archiveRoot, baseName);
  if (fs.existsSync(archiveDestination)) {
    archiveDestination = path.join(archiveRoot, `${baseName}-${Date.now()}`);
  }

  fs.mkdirSync(path.dirname(archiveDestination), { recursive: true });
  fs.renameSync(source, archiveDestination);
}

function moveDirectoryToCleanDestination(
  source: string,
  destination: string,
  options?: { archiveRemaining?: boolean },
): void {
  if (path.resolve(source) === path.resolve(destination)) return;
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination)) {
    fs.renameSync(source, destination);
    return;
  }
  if (!fs.statSync(destination).isDirectory()) return;

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourceEntry = path.join(source, entry.name);
    const destinationEntry = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      moveDirectoryToCleanDestination(sourceEntry, destinationEntry);
      continue;
    }
    if (fs.existsSync(destinationEntry)) continue;
    fs.renameSync(sourceEntry, destinationEntry);
  }

  if (fs.readdirSync(source).length === 0) {
    fs.rmSync(source, { recursive: true, force: true });
  } else if (options?.archiveRemaining) {
    archiveRemainingLegacyDirectory(source, destination);
  }
}

function normalizeManagedCompanyWorkspaceRoots(db: Database.Database): void {
  const managedWorkspaceRoot = DEFAULT_MC_WORKSPACE_ROOT;
  const companiesRoot = path.join(managedWorkspaceRoot, "companies");
  fs.mkdirSync(companiesRoot, { recursive: true });

  const rows = db
    .prepare(
      `SELECT id, slug, workspace_slug, runtime_slug, workspace_root, workspace_source
       FROM companies
       WHERE archived_at IS NULL`
    )
    .all() as Array<{
      id: string;
      slug: string;
      workspace_slug: string | null;
      runtime_slug: string | null;
      workspace_root: string | null;
      workspace_source: string | null;
    }>;

  const update = db.prepare(
    `UPDATE companies
     SET workspace_root = ?,
         workspace_source = CASE
           WHEN workspace_source IS NULL OR TRIM(workspace_source) = '' OR workspace_source = 'openclaw'
             THEN 'provisioned'
           ELSE workspace_source
         END,
         updated_at = ${NOW_SQL}
     WHERE id = ?`
  );

  for (const row of rows) {
    const workspaceSlug = normalizePathPart(row.workspace_slug || row.runtime_slug || row.slug || row.id);
    const cleanRoot = path.join(companiesRoot, workspaceSlug);
    const currentRoot = row.workspace_root?.trim() ? path.resolve(row.workspace_root) : null;

    if (currentRoot && !isSameOrNestedPath(companiesRoot, currentRoot)) {
      continue;
    }

    if (currentRoot && currentRoot !== cleanRoot) {
      moveDirectoryToCleanDestination(currentRoot, cleanRoot, { archiveRemaining: true });
    }

    const legacyIdRoot = path.join(companiesRoot, `${workspaceSlug}--${row.id}`);
    if (path.resolve(legacyIdRoot) !== path.resolve(cleanRoot)) {
      moveDirectoryToCleanDestination(legacyIdRoot, cleanRoot, { archiveRemaining: true });
    }

    fs.mkdirSync(path.join(cleanRoot, "projects"), { recursive: true });
    fs.mkdirSync(path.join(cleanRoot, "memory"), { recursive: true });
    fs.mkdirSync(path.join(cleanRoot, "scripts"), { recursive: true });

    if (currentRoot !== cleanRoot || row.workspace_source === "openclaw" || !row.workspace_source?.trim()) {
      update.run(cleanRoot, row.id);
    }
  }
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function applyRenameOnDeckStatusMigration(db: Database.Database): void {
  const taskTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
    .get() as { sql: string } | undefined;
  if (!taskTable?.sql) {
    return;
  }

  const indexRows = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks' AND sql IS NOT NULL")
    .all() as Array<{ sql: string }>;
  const originalColumns = db.pragma("table_info(tasks)") as Array<{ name: string }>;
  const originalColumnNames = originalColumns.map((column) => column.name);
  const createTasksSql = taskTable.sql.replace(/\bon_deck\b/g, "to-do");

  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");
  try {
    db.exec("ALTER TABLE tasks RENAME TO tasks_status_v85_old;");
    db.exec(createTasksSql);

    const nextColumns = db.pragma("table_info(tasks)") as Array<{ name: string }>;
    const nextColumnNames = new Set(nextColumns.map((column) => column.name));
    const insertColumns = originalColumnNames.filter((name) => nextColumnNames.has(name));
    const selectColumns = insertColumns.map((name) => {
      const quoted = quoteSqlIdentifier(name);
      if (name === "status") {
        return `CASE WHEN ${quoted} = 'on_deck' THEN 'to-do' ELSE ${quoted} END`;
      }
      return quoted;
    });

    db.exec(`
      INSERT INTO tasks (${insertColumns.map(quoteSqlIdentifier).join(", ")})
      SELECT ${selectColumns.join(", ")}
      FROM tasks_status_v85_old;

      DROP TABLE tasks_status_v85_old;
    `);

    for (const row of indexRows) {
      db.exec(row.sql.replace(/\bon_deck\b/g, "to-do"));
    }
  } finally {
    db.pragma("legacy_alter_table = OFF");
    db.pragma("foreign_keys = ON");
  }

  db.exec(`
    UPDATE task_events SET from_status = 'to-do' WHERE from_status = 'on_deck';
    UPDATE task_events SET to_status = 'to-do' WHERE to_status = 'on_deck';
    UPDATE status_transition_rules SET from_status = 'to-do' WHERE from_status = 'on_deck';
    UPDATE status_transition_rules SET to_status = 'to-do' WHERE to_status = 'on_deck';

    INSERT OR IGNORE INTO status_transition_rules (from_status, to_status, requires_assignee, requires_review, is_terminal) VALUES
      ('backlog', 'to-do', 0, 0, 0),
      ('to-do', 'backlog', 0, 0, 0),
      ('to-do', 'in_progress', 1, 0, 0),
      ('to-do', 'blocked', 0, 0, 1),
      ('to-do', 'review', 0, 0, 0),
      ('to-do', 'done', 0, 0, 1),
      ('in_progress', 'to-do', 0, 0, 0),
      ('review', 'to-do', 0, 0, 0),
      ('blocked', 'to-do', 0, 0, 0);

    DELETE FROM status_transition_rules
    WHERE from_status = 'on_deck'
       OR to_status = 'on_deck';
  `);
}

function applyGoalContractSchemaMigration(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      CREATE TABLE sprints_goal_contract_v86_new (
        id              TEXT PRIMARY KEY,
        project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        goal            TEXT NOT NULL DEFAULT '',
        status          TEXT NOT NULL DEFAULT 'planning'
                        CHECK (status IN ('planning','active','blocked','paused','completed')),
        start_date      TEXT NOT NULL,
        end_date        TEXT,
        completed_at    TEXT,
        created_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        parent_id       TEXT REFERENCES sprints(id) ON DELETE SET NULL,
        owner           TEXT DEFAULT NULL,
        goal_kind       TEXT DEFAULT NULL CHECK (goal_kind IN ('company', 'sprint') OR goal_kind IS NULL),
        lead_agent_id   TEXT REFERENCES agents(id) ON DELETE SET NULL,
        stop_condition  TEXT NOT NULL DEFAULT '',
        progress_summary TEXT NOT NULL DEFAULT '',
        default_execution_engine TEXT CHECK (default_execution_engine IS NULL OR default_execution_engine IN ('hiverunner','symphony','manual')),
        default_model_lane TEXT CHECK (default_model_lane IS NULL OR default_model_lane IN ('default','fast','mini','deep')),
        UNIQUE(project_id, name)
      );

      INSERT INTO sprints_goal_contract_v86_new (
        id, project_id, name, goal, status, start_date, end_date, completed_at,
        created_at, updated_at, parent_id, owner, goal_kind
      )
      SELECT
        id, project_id, name, goal, status, start_date, end_date, completed_at,
        created_at, updated_at, parent_id, owner, goal_kind
      FROM sprints;

      DROP TABLE sprints;
      ALTER TABLE sprints_goal_contract_v86_new RENAME TO sprints;

      CREATE INDEX IF NOT EXISTS idx_sprints_project_status ON sprints(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_sprints_parent_id ON sprints(parent_id);
      CREATE INDEX IF NOT EXISTS idx_sprints_lead_agent_id ON sprints(lead_agent_id);

      CREATE TABLE goal_contract_items (
        id              TEXT PRIMARY KEY,
        sprint_id       TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
        kind            TEXT NOT NULL CHECK (kind IN ('success_criterion','validation_check','out_of_scope')),
        text            TEXT NOT NULL,
        position        INTEGER NOT NULL DEFAULT 0,
        created_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        created_by_user_id  TEXT,
        archived_at     TEXT,
        created_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at      TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX idx_goal_contract_items_sprint_kind
        ON goal_contract_items(sprint_id, kind, position)
        WHERE archived_at IS NULL;

      CREATE TABLE goal_contract_evidence (
        id              TEXT PRIMARY KEY,
        item_id         TEXT NOT NULL REFERENCES goal_contract_items(id) ON DELETE CASCADE,
        sprint_id       TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
        item_kind       TEXT NOT NULL CHECK (item_kind IN ('success_criterion','validation_check','out_of_scope')),
        status          TEXT NOT NULL CHECK (status IN ('proposed','passed','failed','retracted')),
        source          TEXT NOT NULL CHECK (source IN ('agent','operator','system')),
        result_text     TEXT NOT NULL DEFAULT '',
        command_exit_code INTEGER,
        artifact_uri    TEXT,
        recorded_by_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        recorded_by_user_id  TEXT,
        created_at      TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at      TEXT NOT NULL DEFAULT (${NOW_SQL})
      );

      CREATE INDEX idx_goal_contract_evidence_item_created
        ON goal_contract_evidence(item_id, created_at DESC, id DESC);
      CREATE INDEX idx_goal_contract_evidence_sprint_kind
        ON goal_contract_evidence(sprint_id, item_kind, created_at DESC);

      INSERT OR IGNORE INTO status_transition_rules (from_status, to_status, requires_assignee, requires_review, is_terminal) VALUES
        ('planned', 'active', 0, 0, 0),
        ('planned', 'blocked', 0, 0, 0),
        ('planned', 'paused', 0, 0, 0),
        ('active', 'planned', 0, 0, 0),
        ('active', 'blocked', 0, 0, 0),
        ('active', 'paused', 0, 0, 0),
        ('active', 'done', 0, 0, 1),
        ('blocked', 'active', 0, 0, 0),
        ('blocked', 'paused', 0, 0, 0),
        ('paused', 'planned', 0, 0, 0),
        ('paused', 'active', 0, 0, 0),
        ('paused', 'blocked', 0, 0, 0),
        ('done', 'active', 0, 0, 0),
        ('done', 'blocked', 0, 0, 0),
        ('done', 'paused', 0, 0, 0);
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function insertCleanupAnchorTaskIfNeeded(db: Database.Database, now: string): void {
  const hasTasklessRuns = (
    db.prepare("SELECT COUNT(*) AS count FROM execution_runs WHERE task_id IS NULL").get() as { count: number }
  ).count > 0;
  if (!hasTasklessRuns) return;

  db.prepare(
    `INSERT OR IGNORE INTO projects
      (id, slug, name, description, color, status, owner_user_id, settings_json, created_at, updated_at, archived_at, company_id)
     VALUES (
      'system-execution-run-cleanup-project',
      'system-execution-run-cleanup',
      'System execution run cleanup',
      'Archived anchor project for historical execution runs that were created without a task.',
      '#78716c',
      'archived',
      NULL,
      '{}',
      ?,
      ?,
      ?,
      (SELECT id FROM companies ORDER BY created_at ASC LIMIT 1)
     )`
  ).run(now, now, now);

  const taskColumns: string[] = [
    "id",
    "project_id",
    "title",
    "description",
    "priority",
    "type",
    "status",
    "column_order",
    "created_by",
    "labels_json",
    "depends_on_json",
    "execution_mode",
    "created_at",
    "updated_at",
  ];
  const taskValues: unknown[] = [
    "system-execution-run-cleanup-task",
    "system-execution-run-cleanup-project",
    "Archived execution run cleanup anchor",
    "System anchor used to preserve historical execution_run rows that were originally written without task_id.",
    "medium",
    "infrastructure",
    "backlog",
    0,
    "system",
    JSON.stringify(["cleanup", "execution_runs"]),
    "[]",
    "manual",
    now,
    now,
  ];

  if (hasColumn(db, "tasks", "archived_at")) {
    taskColumns.push("archived_at");
    taskValues.push(now);
  }
  if (hasColumn(db, "tasks", "attachments_json")) {
    taskColumns.push("attachments_json");
    taskValues.push("[]");
  }
  if (hasColumn(db, "tasks", "consecutive_noop_wakes")) {
    taskColumns.push("consecutive_noop_wakes");
    taskValues.push(0);
  }
  if (hasColumn(db, "tasks", "company_id")) {
    taskColumns.push("company_id");
    taskValues.push(db.prepare("SELECT company_id FROM projects WHERE id = ?").pluck().get("system-execution-run-cleanup-project") ?? null);
  }
  if (hasColumn(db, "tasks", "execution_engine")) {
    taskColumns.push("execution_engine");
    taskValues.push("manual");
  }
  if (hasColumn(db, "tasks", "model_lane")) {
    taskColumns.push("model_lane");
    taskValues.push("default");
  }

  db.prepare(
    `INSERT OR IGNORE INTO tasks
      (${taskColumns.join(", ")})
     VALUES (${taskColumns.map(() => "?").join(", ")})`
  ).run(...taskValues);

  db.prepare(
    `UPDATE execution_runs
     SET task_id = 'system-execution-run-cleanup-task',
         status = 'cancelled',
         completed_at = COALESCE(completed_at, ?),
         error_message = COALESCE(error_message, 'Cancelled: cleanup-orphan missing task_id'),
         failure_class = COALESCE(failure_class, 'cancelled'),
         process_pid = NULL,
         updated_at = ?
     WHERE task_id IS NULL`
  ).run(now, now);
}

function applyExecutionRunsRequireTaskIdMigration(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  try {
    const now = new Date().toISOString();
    insertCleanupAnchorTaskIfNeeded(db, now);

    db.exec(`
      DROP INDEX IF EXISTS idx_execution_runs_task_created_at;
      DROP INDEX IF EXISTS idx_execution_runs_task_status;
      DROP INDEX IF EXISTS idx_execution_runs_provider_status;
      DROP INDEX IF EXISTS idx_execution_runs_idempotency_key;
      DROP INDEX IF EXISTS idx_execution_runs_runner_identity;
      DROP INDEX IF EXISTS idx_execution_runs_lane_runner;

      CREATE TABLE execution_runs_new (
        id                TEXT PRIMARY KEY,
        task_id           TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id          TEXT REFERENCES agents(id) ON DELETE SET NULL,
        provider          TEXT NOT NULL CHECK (provider IN ('openclaw','paperclip','codex','anthropic','hermes','gemini','symphony')),
        session_id        TEXT,
        status            TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
        started_at        TEXT,
        completed_at      TEXT,
        error_message     TEXT,
        token_usage_json  TEXT NOT NULL DEFAULT '{}',
        duration_ms       INTEGER,
        idempotency_key   TEXT,
        created_at        TEXT NOT NULL DEFAULT (${NOW_SQL}),
        updated_at        TEXT NOT NULL DEFAULT (${NOW_SQL}),
        execution_engine  TEXT CHECK (execution_engine IS NULL OR execution_engine IN ('hiverunner','symphony','manual')),
        runner_provider   TEXT,
        runner_model      TEXT,
        model_lane        TEXT,
        fallback_used     INTEGER NOT NULL DEFAULT 0 CHECK (fallback_used IN (0,1)),
        fallback_index    INTEGER,
        fallback_from_provider TEXT,
        route_attempts_json TEXT NOT NULL DEFAULT '[]',
        process_pid       INTEGER,
        failure_class     TEXT
      );

      INSERT INTO execution_runs_new
        (id, task_id, agent_id, provider, session_id, status, started_at, completed_at, error_message, token_usage_json, duration_ms, idempotency_key, created_at, updated_at, execution_engine, runner_provider, runner_model, model_lane, fallback_used, fallback_index, fallback_from_provider, route_attempts_json, process_pid, failure_class)
      SELECT
        id, task_id, agent_id, provider, session_id, status, started_at, completed_at, error_message, token_usage_json, duration_ms, idempotency_key, created_at, updated_at, execution_engine, runner_provider, runner_model, model_lane, fallback_used, fallback_index, fallback_from_provider, route_attempts_json, process_pid, failure_class
      FROM execution_runs;

      DROP TABLE execution_runs;
      ALTER TABLE execution_runs_new RENAME TO execution_runs;

      CREATE INDEX idx_execution_runs_task_created_at
        ON execution_runs(task_id, created_at DESC);
      CREATE INDEX idx_execution_runs_task_status
        ON execution_runs(task_id, status);
      CREATE INDEX idx_execution_runs_provider_status
        ON execution_runs(provider, status);
      CREATE UNIQUE INDEX idx_execution_runs_idempotency_key
        ON execution_runs(idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX idx_execution_runs_runner_identity
        ON execution_runs(execution_engine, runner_provider, status, updated_at DESC);
      CREATE INDEX idx_execution_runs_lane_runner
        ON execution_runs(model_lane, runner_provider, status, updated_at DESC)
        WHERE model_lane IS NOT NULL;
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

export function getOrchestrationDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  ensureDataDir(ORCHESTRATION_DB_PATH);

  const db = new Database(ORCHESTRATION_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);

  createMigrationsTable(db);
  runOrchestrationMigrations(db);
  ensureOrchestrationSchemaCompatibility(db);
  normalizeManagedCompanyWorkspaceRoots(db);
  normalizeOrchestrationStatusValues(db);

  dbInstance = db;
  return db;
}

export function runOrchestrationMigrations(db = getOrchestrationDb()): {
  applied: number[];
  skipped: number[];
} {
  createMigrationsTable(db);

  const applied: number[] = [];
  const skipped: number[] = [];

  for (const migration of MIGRATIONS) {
    const checksum = migrationChecksum(migration.sql);
    const existing = getAppliedMigration(db, migration.version);

    if (existing) {
      const acceptedChecksums = new Set([
        checksum,
        ...(migration.compatibleChecksums ?? []),
      ]);

      if (!acceptedChecksums.has(existing.checksum)) {
        const repaired = repairAppliedMigrationChecksumIfPossible(db, migration, checksum, existing);
        if (!repaired) {
          throw new Error(
            `Migration checksum mismatch for v${migration.version} (${migration.name}).`
          );
        }
        skipped.push(migration.version);
        continue;
      }

      repairCompatibleAppliedMigrationIfNeeded(db, migration);
      if (existing.checksum !== checksum || existing.name !== migration.name) {
        db.prepare("UPDATE schema_migrations SET name = ?, checksum = ? WHERE version = ?").run(
          migration.name,
          checksum,
          migration.version
        );
      }

      skipped.push(migration.version);
      continue;
    }

    if (markOutOfBandMigrationIfAlreadyApplied(db, migration, checksum)) {
      applied.push(migration.version);
      continue;
    }

    if (migration.version === 85) {
      applyRenameOnDeckStatusMigration(db);
      db.prepare(
        "INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)"
      ).run(migration.version, migration.name, checksum);
    } else if (migration.version === 86) {
      applyGoalContractSchemaMigration(db);
      db.prepare(
        "INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)"
      ).run(migration.version, migration.name, checksum);
    } else if (migration.version === 88) {
      applyExecutionRunsRequireTaskIdMigration(db);
      db.prepare(
        "INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)"
      ).run(migration.version, migration.name, checksum);
    } else if (migration.version === 101) {
      const apply = db.transaction(() => {
        applyCompanyMemoryVaultIndexMigration(db);
        db.prepare(
          "INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)"
        ).run(migration.version, migration.name, checksum);
      });
      apply();
    } else if (migration.version === 103) {
      const apply = db.transaction(() => {
        applyCompanyGoalKeysMigration(db);
        db.prepare(
          "INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)"
        ).run(migration.version, migration.name, checksum);
      });
      apply();
    } else if (migration.version === 106) {
      const apply = db.transaction(() => {
        ensureColumn(db, "memory_curation_states", "acknowledged_at", "TEXT");
        ensureColumn(db, "memory_curation_states", "resolved_at", "TEXT");
        ensureColumn(db, "memory_curation_states", "dismissed_at", "TEXT");
        ensureColumn(db, "memory_curation_states", "superseded_at", "TEXT");
        db.prepare(
          "INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)"
        ).run(migration.version, migration.name, checksum);
      });
      apply();
    } else if (migration.version === 107) {
      const apply = db.transaction(() => {
        applyMemoryCurationCurrentLifecycleMigration(db);
        db.prepare(
          "INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)"
        ).run(migration.version, migration.name, checksum);
      });
      apply();
    } else if (migration.version === 108) {
      const apply = db.transaction(() => {
        applyMemoryCurationExtendedLifecycleMigration(db);
        db.prepare(
          "INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)"
        ).run(migration.version, migration.name, checksum);
      });
      apply();
    } else {
      const apply = db.transaction(() => {
        db.exec(migration.sql);
        db.prepare(
          "INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)"
        ).run(migration.version, migration.name, checksum);
      });

      apply();
    }
    applied.push(migration.version);
  }

  return { applied, skipped };
}

function setProjectUpdatedAt(db: Database.Database, projectId: string): void {
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    projectId
  );
}

export function seedOrchestrationDevData(db = getOrchestrationDb()): {
  projectIds: string[];
  taskIds: string[];
  agentIds: string[];
} {
  const now = new Date().toISOString();

  const seededProjects = [
    {
      id: randomUUID(),
      slug: "hiverunner-orchestration",
      name: "HiveRunner Orchestration",
      description: "Core orchestration layer, board APIs, and execution lifecycle",
      color: "#f97316",
      emoji: "🛰️",
      theme: "Corporate Noir",
    },
    {
      id: randomUUID(),
      slug: "research-lab",
      name: "Research Lab",
      description: "Research intake, synthesis, evidence tracking, and reporting",
      color: "#0ea5e9",
      emoji: "🌦️",
      theme: "Sci-Fi Crew",
    },
    {
      id: randomUUID(),
      slug: "ops-automation",
      name: "Ops Automation",
      description: "Operational workflows, support automation, and process checks",
      color: "#22c55e",
      emoji: "₿",
      theme: "Cyberpunk",
    },
    {
      id: randomUUID(),
      slug: "product-studio",
      name: "Product Studio",
      description: "Product planning, implementation support, and release coordination",
      color: "#38bdf8",
      emoji: "📈",
      theme: "Corporate Noir",
    },
    {
      id: randomUUID(),
      slug: "insight-website",
      name: "Insight Website",
      description: "Public insights surface, reporting pages, and publishing pipeline",
      color: "#f59e0b",
      emoji: "🌐",
      theme: "Corporate Noir",
    },
    {
      id: randomUUID(),
      slug: "signalforge",
      name: "SignalForge",
      description: "Signal research, feature experiments, and model readiness",
      color: "#e11d48",
      emoji: "🧪",
      theme: "Cyberpunk",
    },
    {
      id: randomUUID(),
      slug: "ideas-pipeline",
      name: "Ideas Pipeline",
      description: "Idea intake, triage, synthesis, and task generation loop",
      color: "#14b8a6",
      emoji: "💡",
      theme: "Corporate Noir",
    },
    {
      id: randomUUID(),
      slug: "snapaudit",
      name: "SnapAudit",
      description: "Automated quality assurance evidence capture, regression checks, and audits",
      color: "#f43f5e",
      emoji: "📸",
      theme: "Corporate Noir",
    },
  ] as const;

  const projectA = seededProjects.find((project) => project.slug === "research-lab");
  const projectB = seededProjects.find(
    (project) => project.slug === "hiverunner-orchestration"
  );
  if (!projectA || !projectB) {
    throw new Error("Missing required seed project definitions");
  }

  const insertProject = db.prepare(`
    INSERT OR IGNORE INTO projects
      (id, company_id, slug, name, description, color, status, owner_user_id, settings_json, created_at, updated_at)
    VALUES
      (@id, @company_id, @slug, @name, @description, @color, 'active', 'tim', @settings_json, @created_at, @updated_at)
  `);

  const updateProject = db.prepare(`
    UPDATE projects
    SET
      name = @name,
      description = @description,
      color = @color,
      status = 'active',
      owner_user_id = COALESCE(owner_user_id, 'tim'),
      settings_json = @settings_json,
      archived_at = NULL,
      updated_at = @updated_at
    WHERE company_id = @company_id
      AND slug = @slug
  `);

  const findProject = db.prepare("SELECT id, slug, company_id FROM projects WHERE slug = ?");

  const insertTheme = db.prepare(`
    INSERT OR IGNORE INTO avatar_themes
      (id, company_id, name, prompt_template, style_keywords_json, sample_url, is_default, created_at, updated_at)
    VALUES
      (@id, @company_id, @name, @prompt_template, @style_keywords_json, @sample_url, 0, @created_at, @updated_at)
  `);

  const insertSprint = db.prepare(`
    INSERT OR IGNORE INTO sprints
      (id, project_id, name, goal, status, start_date, created_at, updated_at)
    VALUES
      (@id, @project_id, @name, @goal, 'active', @start_date, @created_at, @updated_at)
  `);
  const findSprint = db.prepare(
    "SELECT id FROM sprints WHERE project_id = ? AND name = ? LIMIT 1"
  );

  const insertAgent = db.prepare(`
    INSERT OR IGNORE INTO agents
      (id, company_id, project_id, name, emoji, role, personality, status, model, created_at, updated_at)
    VALUES
      (@id, @company_id, @project_id, @name, @emoji, @role, @personality, 'idle', @model, @created_at, @updated_at)
  `);
  const findAgent = db.prepare(
    "SELECT id FROM agents WHERE project_id = ? AND name = ? LIMIT 1"
  );

  const insertTask = db.prepare(`
    INSERT OR IGNORE INTO tasks
      (id, project_id, sprint_id, title, description, priority, type, status, column_order, assignee_agent_id, created_by, labels_json, created_at, updated_at)
    VALUES
      (@id, @project_id, @sprint_id, @title, @description, @priority, @type, @status, @column_order, @assignee_agent_id, 'seed', @labels_json, @created_at, @updated_at)
  `);

  const tx = db.transaction(() => {
    for (const project of seededProjects) {
      insertProject.run({
        ...project,
        company_id: DEFAULT_COMPANY_ID,
        settings_json: JSON.stringify({ emoji: project.emoji }),
        created_at: now,
        updated_at: now,
      });
      updateProject.run({
        ...project,
        company_id: DEFAULT_COMPANY_ID,
        settings_json: JSON.stringify({ emoji: project.emoji }),
        updated_at: now,
      });
    }

    const dbProjectA = findProject.get(projectA.slug) as
      | { id: string; slug: string; company_id: string | null }
      | undefined;
    const dbProjectB = findProject.get(projectB.slug) as
      | { id: string; slug: string; company_id: string | null }
      | undefined;
    if (!dbProjectA || !dbProjectB) {
      throw new Error("Failed to resolve seeded project IDs");
    }

    for (const project of seededProjects) {
      const dbProject = findProject.get(project.slug) as
        | { id: string; slug: string; company_id: string | null }
        | undefined;
      if (!dbProject) {
        throw new Error(`Failed to resolve seeded project ID for slug: ${project.slug}`);
      }
      insertTheme.run({
        id: randomUUID(),
        company_id: dbProject.company_id ?? DEFAULT_COMPANY_ID,
        name: project.theme,
        prompt_template: "cohesive team avatar style, role-informed portrait, production-safe",
        style_keywords_json: JSON.stringify(["cohesive", "team", "avatar"]),
        sample_url: null,
        created_at: now,
        updated_at: now,
      });
    }

    const sprintAName = "Sprint 1: Forecast Integrity";
    const sprintBName = "Sprint 1: Foundation";

    insertSprint.run({
      id: randomUUID(),
      project_id: dbProjectA.id,
      name: sprintAName,
      goal: "Stabilize forecast ingest + edge scoring",
      start_date: now,
      created_at: now,
      updated_at: now,
    });
    insertSprint.run({
      id: randomUUID(),
      project_id: dbProjectB.id,
      name: sprintBName,
      goal: "Ship orchestration schema and route layer",
      start_date: now,
      created_at: now,
      updated_at: now,
    });
    const sprintA = findSprint.get(dbProjectA.id, sprintAName) as { id: string } | undefined;
    const sprintB = findSprint.get(dbProjectB.id, sprintBName) as { id: string } | undefined;
    if (!sprintA || !sprintB) {
      throw new Error("Failed to resolve seeded sprint IDs");
    }

    const scoutName = "Scout";
    const forgeName = "Forge";
    const gaterName = "Gater";
    const pixelName = "Pixel";

    insertAgent.run({
      id: randomUUID(),
      company_id: dbProjectA.company_id ?? DEFAULT_COMPANY_ID,
      project_id: dbProjectA.id,
      name: scoutName,
      emoji: "🌤️",
      role: "Research Analyst",
      personality: "Practical analyst focused on resilient research inputs",
      model: "gpt-5.4-mini",
      created_at: now,
      updated_at: now,
    });
    insertAgent.run({
      id: randomUUID(),
      company_id: dbProjectB.company_id ?? DEFAULT_COMPANY_ID,
      project_id: dbProjectB.id,
      name: forgeName,
      emoji: "🔧",
      role: "Backend Engineer",
      personality: "Builds durable systems with clear contracts",
      model: "gpt-5.4",
      created_at: now,
      updated_at: now,
    });
    insertAgent.run({
      id: randomUUID(),
      company_id: dbProjectB.company_id ?? DEFAULT_COMPANY_ID,
      project_id: dbProjectB.id,
      name: gaterName,
      emoji: "🚧",
      role: "QA Lead",
      personality: "Relentless on testability and production safety",
      model: "gpt-5.4-mini",
      created_at: now,
      updated_at: now,
    });
    insertAgent.run({
      id: randomUUID(),
      company_id: dbProjectB.company_id ?? DEFAULT_COMPANY_ID,
      project_id: dbProjectB.id,
      name: pixelName,
      emoji: "🎨",
      role: "Frontend Engineer",
      personality: "Pixel-perfect UI builder with a sharp eye for design systems",
      model: "gpt-5.4-mini",
      created_at: now,
      updated_at: now,
    });
    const agentScout = findAgent.get(dbProjectA.id, scoutName) as { id: string } | undefined;
    const agentForge = findAgent.get(dbProjectB.id, forgeName) as { id: string } | undefined;
    const agentGater = findAgent.get(dbProjectB.id, gaterName) as { id: string } | undefined;
    const agentPixel = findAgent.get(dbProjectB.id, pixelName) as { id: string } | undefined;
    if (!agentScout || !agentForge || !agentGater || !agentPixel) {
      throw new Error("Failed to resolve seeded agent IDs");
    }

    const taskIds = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];

    insertTask.run({
      id: taskIds[0],
      project_id: dbProjectB.id,
      sprint_id: sprintB.id,
      title: "Define SQLite orchestration schema",
      description: "Create durable schema for projects, agents, tasks, comments, and themes",
      priority: "critical",
      type: "infrastructure",
      status: "in_progress",
      column_order: 1000,
      assignee_agent_id: agentForge.id,
      labels_json: JSON.stringify(["backend", "schema"]),
      created_at: now,
      updated_at: now,
    });
    insertTask.run({
      id: taskIds[1],
      project_id: dbProjectB.id,
      sprint_id: sprintB.id,
      title: "Agree API contracts with Pixel",
      description: "Lock request/response payload contracts for board routes",
      priority: "high",
      type: "feature",
      status: "to-do",
      column_order: 1000,
      assignee_agent_id: agentForge.id,
      labels_json: JSON.stringify(["api", "contracts"]),
      created_at: now,
      updated_at: now,
    });
    insertTask.run({
      id: taskIds[2],
      project_id: dbProjectB.id,
      sprint_id: sprintB.id,
      title: "Review foundation tests",
      description: "Validate migrations and route validation with Vigil",
      priority: "high",
      type: "feature",
      status: "review",
      column_order: 1000,
      assignee_agent_id: agentGater.id,
      labels_json: JSON.stringify(["qa"]),
      created_at: now,
      updated_at: now,
    });
    insertTask.run({
      id: taskIds[3],
      project_id: dbProjectA.id,
      sprint_id: sprintA.id,
      title: "Weather station ingest cleanup",
      description: "Normalize ingest payloads and enforce station quality tags",
      priority: "medium",
      type: "feature",
      status: "backlog",
      column_order: 1000,
      assignee_agent_id: agentScout.id,
      labels_json: JSON.stringify(["weather", "ingest"]),
      created_at: now,
      updated_at: now,
    });
    insertTask.run({
      id: taskIds[4],
      project_id: dbProjectB.id,
      sprint_id: sprintB.id,
      title: "Done sample task",
      description: "Reference complete task for UI baseline",
      priority: "low",
      type: "feature",
      status: "done",
      column_order: 1000,
      assignee_agent_id: agentForge.id,
      labels_json: JSON.stringify(["seed"]),
      created_at: now,
      updated_at: now,
    });

    for (const project of seededProjects) {
      const dbProject = findProject.get(project.slug) as { id: string } | undefined;
      if (dbProject) {
        setProjectUpdatedAt(db, dbProject.id);
      }
    }
  });

  tx();

  const projectRows = db
    .prepare(
      `SELECT id
       FROM projects
       WHERE slug IN (
         'hiverunner-orchestration',
         'research-lab',
         'ops-automation',
         'product-studio',
         'insight-website',
         'signalforge',
         'ideas-pipeline',
         'snapaudit'
       )`
    )
    .all() as Array<{ id: string }>;
  const taskRows = db
    .prepare("SELECT id FROM tasks ORDER BY created_at DESC LIMIT 5")
    .all() as Array<{ id: string }>;
  const agentRows = db
    .prepare("SELECT id FROM agents WHERE name IN ('Nimbus','Forge','Gater')")
    .all() as Array<{ id: string }>;

  return {
    projectIds: projectRows.map((row) => row.id),
    taskIds: taskRows.map((row) => row.id),
    agentIds: agentRows.map((row) => row.id),
  };
}

export function closeOrchestrationDb(): void {
  if (!dbInstance) {
    return;
  }
  dbInstance.close();
  dbInstance = null;
}
