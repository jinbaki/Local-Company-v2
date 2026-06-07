import { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { ensureDataRoot } from "./file-store.js";

export interface DatabaseContext {
  config: AppConfig;
  db: DatabaseSync;
  appliedMigrations: string[];
}

const migrations = [
  {
    id: "001_initial_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS divisions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        lead_worker_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY,
        division_id TEXT NOT NULL,
        name TEXT NOT NULL,
        position TEXT NOT NULL,
        skills TEXT NOT NULL DEFAULT '[]',
        work_style TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (division_id) REFERENCES divisions(id)
      );

      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        division_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        pm_worker_id TEXT,
        status TEXT NOT NULL DEFAULT 'planning',
        current_focus TEXT NOT NULL DEFAULT '',
        health TEXT NOT NULL DEFAULT 'normal',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (division_id) REFERENCES divisions(id),
        FOREIGN KEY (pm_worker_id) REFERENCES workers(id)
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'pm',
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        role TEXT NOT NULL,
        author_name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      );

      CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      );

      CREATE TABLE IF NOT EXISTS graph_edges (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        from_node_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
        FOREIGN KEY (from_node_id) REFERENCES graph_nodes(id),
        FOREIGN KEY (to_node_id) REFERENCES graph_nodes(id)
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        owner_worker_id TEXT,
        instructions TEXT NOT NULL DEFAULT '',
        acceptance_criteria TEXT NOT NULL DEFAULT '',
        artifact_ids TEXT NOT NULL DEFAULT '[]',
        decision_ids TEXT NOT NULL DEFAULT '[]',
        priority TEXT NOT NULL DEFAULT 'normal',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
        FOREIGN KEY (owner_worker_id) REFERENCES workers(id)
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        display_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'markdown',
        status TEXT NOT NULL DEFAULT 'draft',
        current_version TEXT,
        owner_worker_id TEXT,
        linked_task_ids TEXT NOT NULL DEFAULT '[]',
        review_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (campaign_id, display_number),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
        FOREIGN KEY (owner_worker_id) REFERENCES workers(id)
      );

      CREATE TABLE IF NOT EXISTS artifact_versions (
        artifact_id TEXT NOT NULL,
        version TEXT NOT NULL,
        created_by TEXT NOT NULL,
        source_queue_item_id TEXT,
        content_path TEXT NOT NULL,
        review_path TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (artifact_id, version),
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id)
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        title TEXT NOT NULL,
        reason TEXT NOT NULL,
        options TEXT NOT NULL DEFAULT '[]',
        recommended_option TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        blocks TEXT NOT NULL DEFAULT '[]',
        answer TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      );

      CREATE TABLE IF NOT EXISTS queue_items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        campaign_id TEXT NOT NULL,
        worker_id TEXT,
        task_id TEXT,
        artifact_ids TEXT NOT NULL DEFAULT '[]',
        attempt INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 2,
        blocked_by_decision_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
        FOREIGN KEY (worker_id) REFERENCES workers(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (blocked_by_decision_id) REFERENCES decisions(id)
      );

      CREATE TABLE IF NOT EXISTS worker_sessions (
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        campaign_id TEXT NOT NULL,
        session_id TEXT,
        status TEXT NOT NULL DEFAULT 'not_started',
        last_used_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (worker_id) REFERENCES workers(id),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        campaign_id TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `
  },
  {
    id: "002_campaign_workers",
    sql: `
      CREATE TABLE IF NOT EXISTS campaign_workers (
        campaign_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'AI 직원',
        status TEXT NOT NULL DEFAULT 'assigned',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (campaign_id, worker_id),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
        FOREIGN KEY (worker_id) REFERENCES workers(id)
      );

      CREATE INDEX IF NOT EXISTS idx_campaign_workers_worker_id ON campaign_workers(worker_id);
      CREATE INDEX IF NOT EXISTS idx_queue_items_campaign_status ON queue_items(campaign_id, status);
      CREATE INDEX IF NOT EXISTS idx_worker_sessions_campaign_worker ON worker_sessions(campaign_id, worker_id);
    `
  },
  {
    id: "003_artifact_revision_requests",
    sql: `
      CREATE TABLE IF NOT EXISTS artifact_revision_requests (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        queue_item_id TEXT,
        instruction TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (campaign_id, artifact_id, instruction),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (queue_item_id) REFERENCES queue_items(id)
      );

      CREATE INDEX IF NOT EXISTS idx_artifact_revision_requests_artifact_status ON artifact_revision_requests(artifact_id, status);
      CREATE INDEX IF NOT EXISTS idx_artifact_revision_requests_queue ON artifact_revision_requests(queue_item_id);
    `
  },
  {
    id: "004_campaign_team_proposals",
    sql: `
      CREATE TABLE IF NOT EXISTS campaign_team_proposals (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        title TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        members TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      );

      CREATE INDEX IF NOT EXISTS idx_campaign_team_proposals_campaign_status
        ON campaign_team_proposals(campaign_id, status);
    `
  },
  {
    id: "005_neutral_default_seed_labels",
    sql: `
      UPDATE workers
      SET name = '사업부 PM', updated_at = CURRENT_TIMESTAMP
      WHERE id = 'worker-default-pm';

      UPDATE workers
      SET name = '실행 담당', updated_at = CURRENT_TIMESTAMP
      WHERE id = 'worker-default-execution';
    `
  },
  {
    id: "006_campaign_references",
    sql: `
      CREATE TABLE IF NOT EXISTS campaign_references (
        id TEXT PRIMARY KEY,
        campaign_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      );

      CREATE INDEX IF NOT EXISTS idx_campaign_references_campaign_created
        ON campaign_references(campaign_id, created_at);
    `
  },
  {
    id: "007_korean_default_worker_names",
    sql: `
      UPDATE workers
      SET name = '김하늘', updated_at = CURRENT_TIMESTAMP
      WHERE id = 'worker-default-pm'
        AND name IN ('사업부 PM', '기본 PM', 'PM');

      UPDATE workers
      SET name = '박도현', updated_at = CURRENT_TIMESTAMP
      WHERE id = 'worker-default-execution'
        AND name IN ('실행 담당', 'AI 실행 담당', 'AI 실행 직원');
    `
  }
];

export function initializeDatabase(config: AppConfig = loadConfig()): DatabaseContext {
  ensureDataRoot(config);

  const db = new DatabaseSync(config.dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const appliedMigrations: string[] = [];
  const migrationExists = db.prepare("SELECT id FROM schema_migrations WHERE id = ?");
  const insertMigration = db.prepare("INSERT INTO schema_migrations (id) VALUES (?)");

  for (const migration of migrations) {
    const existing = migrationExists.get(migration.id);
    if (!existing) {
      db.exec(migration.sql);
      insertMigration.run(migration.id);
      appliedMigrations.push(migration.id);
    }
  }

  db.prepare(
    `INSERT INTO app_meta (key, value, updated_at)
     VALUES ('schema_version', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(migrations.at(-1)?.id ?? "none");

  return {
    config,
    db,
    appliedMigrations
  };
}

export function getDatabaseSummary(db: DatabaseSync): { tableCount: number; migrations: string[] } {
  const tableRows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  const migrationRows = db
    .prepare("SELECT id FROM schema_migrations ORDER BY applied_at ASC")
    .all() as { id: string }[];

  return {
    tableCount: tableRows.length,
    migrations: migrationRows.map((row) => row.id)
  };
}
