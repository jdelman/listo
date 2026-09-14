import Database from "better-sqlite3";
import { migrateAccounts, migrateOAuthAudience } from "./accounts-migration";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";

const defaultPath = join(process.cwd(), "data", "listo.sqlite");
const globalDatabases = globalThis as typeof globalThis & { __listoDatabases?: Map<string, Database.Database> };

export function openListoDatabase(path = process.env.LISTO_DB_PATH || defaultPath) {
  const databases = globalDatabases.__listoDatabases ??= new Map();
  const existing = databases.get(path);
  if (existing?.open) return existing;

  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  try {
    migrateLegacy(db);
    const version = (db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version;
    if (version < 3 && path !== ":memory:") {
      // Unique names permit concurrent web/worker startup without a backup-file race.
      const backup = `${path}.before-accounts-${process.pid}-${Date.now()}.sqlite`;
      db.prepare("VACUUM INTO ?").run(backup);
      chmodSync(backup, 0o600);
    }
    migrateAccounts(db);
    migrateOAuthAudience(db);
    if (path !== ":memory:") chmodSync(path, 0o600);
  } catch (error) { db.close(); throw error; }
  databases.set(path, db);
  return db;
}

export function migrateLegacy(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  db.transaction(() => {
    const version = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number };
    if (version.version >= 2) return;
    if (version.version < 1) {

    db.transaction(() => {
      db.exec(`
        CREATE TABLE lists (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          default_view TEXT NOT NULL DEFAULT 'list',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE items (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          source_url TEXT,
          availability_json TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE list_items (
          id TEXT PRIMARY KEY,
          list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
          item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          UNIQUE(list_id, item_id)
        );

        CREATE INDEX list_items_order ON list_items(list_id, position);

        CREATE TABLE jobs (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          input_revision INTEGER NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 5,
          run_at TEXT NOT NULL,
          lock_token TEXT,
          locked_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(item_id, kind, input_revision)
        );

        CREATE INDEX jobs_ready ON jobs(status, run_at, created_at);
      `);

      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(1, new Date().toISOString());
    })();
    }
    db.transaction(() => {
      db.exec("ALTER TABLE lists ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'");
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(2, new Date().toISOString());
    })();
  }).immediate();
}
