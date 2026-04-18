import { createHash, randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { MC_DATA_DIR } from "../data-dir";

type Migration = {
  version: number;
  name: string;
  sql: string;
  compatibleChecksums?: readonly string[];
};

const FORGE_PAPERCLIP_AGENT_ID = "9c9f7974-97ee-4b43-b622-ad83381c5237";
const GATER_PAPERCLIP_AGENT_ID = "e198ee19-eb6c-49f3-a89a-043fdaa3d7d1";
const PIXEL_PAPERCLIP_AGENT_ID = "e2f2e51c-dd3a-4476-85ca-e8b38b28202d";
const DEFAULT_COMPANY_ID = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
const DEFAULT_OPENCLAW_WORKSPACE_ROOT =
  process.env.OPENCLAW_WORKSPACE_ROOT?.trim() || "/Users/timharris/.openclaw/workspace";

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
          'neveridle-core',
          'NeverIdle Core',
          'Autonomous AI organization — building, trading, and shipping 24/7',
          'active',
          'Corporate Noir',
          'dark premium portrait, cohesive team style',
          '["cinematic","glass","neon-trim","studio-lighting"]',
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
    version: 5,
    name: "normalize_seeded_paperclip_agent_ids_to_uuid",
    sql: `
      UPDATE agents
      SET paperclip_agent_id = '${FORGE_PAPERCLIP_AGENT_ID}',
          updated_at = ${NOW_SQL}
      WHERE
        archived_at IS NULL
        AND name = 'Forge'
        AND (paperclip_agent_id = 'forge' OR paperclip_agent_id IS NULL OR TRIM(paperclip_agent_id) = '');

      UPDATE agents
      SET paperclip_agent_id = '${GATER_PAPERCLIP_AGENT_ID}',
          updated_at = ${NOW_SQL}
      WHERE
        archived_at IS NULL
        AND name = 'Gater'
        AND (paperclip_agent_id = 'gater' OR paperclip_agent_id IS NULL OR TRIM(paperclip_agent_id) = '');
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
    sql: `
      ALTER TABLE companies ADD COLUMN company_code TEXT;

      UPDATE companies
      SET company_code = CASE
        WHEN id = '${DEFAULT_COMPANY_ID}' THEN 'NEV'
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
    compatibleChecksums: ["5f37d971bb1bda4882c518a36053a9ac7e13c8fb5f2ecb9b0cb8b246b3539e75"],
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
      -- Agent wakeup request queue (mirrors Paperclip's agentWakeupRequests)
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
      VALUES ('${DEFAULT_COMPANY_ID}', 'weather-edge');
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
        "Refusing to run a direct test entrypoint against a live Mission Control orchestration DB.",
        "Set ORCHESTRATION_DB_PATH to an isolated temp file, for example:",
        "ORCHESTRATION_DB_PATH=/tmp/mission-control-test.db npx tsx src/lib/__tests__/your-test.ts",
      ].join(" "),
    );
  }

  return path.join(os.tmpdir(), `mission-control-orchestration-test-${process.pid}.db`);
}

const ORCHESTRATION_DB_PATH = resolveConfiguredOrchestrationDbPath();

function normalizeDbTaskStatusSql(columnRef: string): string {
  return `
    CASE
      WHEN ${columnRef} IS NULL OR TRIM(${columnRef}) = '' THEN 'backlog'
      WHEN lower(replace(replace(trim(${columnRef}), '-', '_'), ' ', '_')) IN ('backlog') THEN 'backlog'
      WHEN lower(replace(replace(trim(${columnRef}), '-', '_'), ' ', '_')) IN ('on_deck', 'ondeck', 'todo', 'queued') THEN 'on_deck'
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
      WHERE from_status IN ('backlog','on_deck','in_progress','review','done','blocked')
        AND to_status IN ('backlog','on_deck','in_progress','review','done','blocked');

      DROP TABLE _normalized_status_transition_rules;
    `);

    db.exec(`
      INSERT OR IGNORE INTO status_transition_rules (from_status, to_status, requires_assignee, requires_review, is_terminal) VALUES
        ('backlog', 'on_deck', 0, 0, 0),
        ('backlog', 'blocked', 0, 0, 1),
        ('on_deck', 'backlog', 0, 0, 0),
        ('on_deck', 'in_progress', 1, 0, 0),
        ('on_deck', 'blocked', 0, 0, 1),
        ('in_progress', 'review', 0, 0, 0),
        ('in_progress', 'blocked', 0, 0, 1),
        ('in_progress', 'on_deck', 0, 0, 0),
        ('in_progress', 'done', 0, 0, 1),
        ('review', 'done', 0, 0, 1),
        ('review', 'in_progress', 0, 0, 0),
        ('review', 'blocked', 0, 0, 1),
        ('blocked', 'on_deck', 0, 0, 0),
        ('blocked', 'in_progress', 1, 0, 0),
        ('done', 'review', 0, 0, 0);
    `);

    const transitionRulesCount = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM status_transition_rules
         WHERE from_status NOT IN ('backlog','on_deck','in_progress','review','done','blocked')
            OR to_status NOT IN ('backlog','on_deck','in_progress','review','done','blocked')`
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
        throw new Error(
          `Migration checksum mismatch for v${migration.version} (${migration.name}).`
        );
      }

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

    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)"
      ).run(migration.version, migration.name, checksum);
    });

    apply();
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
      slug: "mission-control-orchestration",
      name: "Mission Control Orchestration",
      description: "Core orchestration layer, board APIs, and execution lifecycle",
      color: "#f97316",
      emoji: "🛰️",
      theme: "Corporate Noir",
    },
    {
      id: randomUUID(),
      slug: "weather-trading",
      name: "Weather Trading",
      description: "Weather market strategy automation, execution, and monitoring",
      color: "#0ea5e9",
      emoji: "🌦️",
      theme: "Sci-Fi Crew",
    },
    {
      id: randomUUID(),
      slug: "crypto-trading",
      name: "Crypto Trading",
      description: "Systematic crypto strategy execution and risk controls",
      color: "#22c55e",
      emoji: "₿",
      theme: "Cyberpunk",
    },
    {
      id: randomUUID(),
      slug: "stock-trading",
      name: "Stock Trading",
      description: "Equities automation stack for signal generation and execution",
      color: "#38bdf8",
      emoji: "📈",
      theme: "Corporate Noir",
    },
    {
      id: randomUUID(),
      slug: "boardrunner",
      name: "BoardRunner",
      description: "Board orchestration workflows, reviews, and cadence automation",
      color: "#a855f7",
      emoji: "🏁",
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

  const projectA = seededProjects.find((project) => project.slug === "weather-trading");
  const projectB = seededProjects.find(
    (project) => project.slug === "mission-control-orchestration"
  );
  if (!projectA || !projectB) {
    throw new Error("Missing required seed project definitions");
  }

  const insertProject = db.prepare(`
    INSERT INTO projects
      (id, company_id, slug, name, description, color, status, owner_user_id, settings_json, created_at, updated_at)
    VALUES
      (@id, @company_id, @slug, @name, @description, @color, 'active', 'tim', @settings_json, @created_at, @updated_at)
    ON CONFLICT(slug) DO UPDATE SET
      company_id = excluded.company_id,
      name = excluded.name,
      description = excluded.description,
      color = excluded.color,
      status = 'active',
      owner_user_id = COALESCE(projects.owner_user_id, excluded.owner_user_id),
      settings_json = excluded.settings_json,
      archived_at = NULL,
      updated_at = excluded.updated_at
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
      (id, company_id, project_id, name, emoji, role, personality, status, model, paperclip_agent_id, created_at, updated_at)
    VALUES
      (@id, @company_id, @project_id, @name, @emoji, @role, @personality, 'idle', @model, @paperclip_agent_id, @created_at, @updated_at)
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

    const nimbusName = "Nimbus";
    const forgeName = "Forge";
    const gaterName = "Gater";
    const pixelName = "Pixel";

    insertAgent.run({
      id: randomUUID(),
      company_id: dbProjectA.company_id ?? DEFAULT_COMPANY_ID,
      project_id: dbProjectA.id,
      name: nimbusName,
      emoji: "🌤️",
      role: "Weather Ops",
      personality: "Practical operator focused on resilient trading inputs",
      model: "gpt-5.4-mini",
      paperclip_agent_id: null,
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
      paperclip_agent_id: FORGE_PAPERCLIP_AGENT_ID,
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
      paperclip_agent_id: GATER_PAPERCLIP_AGENT_ID,
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
      paperclip_agent_id: PIXEL_PAPERCLIP_AGENT_ID,
      created_at: now,
      updated_at: now,
    });
    const agentNimbus = findAgent.get(dbProjectA.id, nimbusName) as { id: string } | undefined;
    const agentForge = findAgent.get(dbProjectB.id, forgeName) as { id: string } | undefined;
    const agentGater = findAgent.get(dbProjectB.id, gaterName) as { id: string } | undefined;
    const agentPixel = findAgent.get(dbProjectB.id, pixelName) as { id: string } | undefined;
    if (!agentNimbus || !agentForge || !agentGater || !agentPixel) {
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
      status: "on_deck",
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
      assignee_agent_id: agentNimbus.id,
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
         'mission-control-orchestration',
         'weather-trading',
         'crypto-trading',
         'stock-trading',
         'boardrunner',
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
