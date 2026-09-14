import type Database from "better-sqlite3";

export const LEGACY_USER_ID = "user-jdelman";

export function migrateAccounts(db: Database.Database) {
  if ((db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v >= 3) return;
  db.transaction(() => {
    if ((db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v >= 3) return;
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE INDEX sessions_user ON sessions(user_id);
      CREATE TABLE password_resets (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE INDEX resets_user ON password_resets(user_id);
      CREATE TABLE auth_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE oauth_clients (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE oauth_grants (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_id TEXT NOT NULL REFERENCES oauth_clients(id), scope TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
      CREATE INDEX grants_user ON oauth_grants(user_id);
      CREATE TABLE oauth_codes (hash TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE);
      CREATE TABLE oauth_tokens (access_hash TEXT PRIMARY KEY, refresh_hash TEXT UNIQUE, grant_id TEXT NOT NULL REFERENCES oauth_grants(id),
        access_expires INTEGER NOT NULL, refresh_expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, scope TEXT NOT NULL);
      CREATE INDEX tokens_grant ON oauth_tokens(grant_id);
    `);
    db.prepare("INSERT INTO users(id, username, created_at, updated_at) VALUES (?, 'jdelman', ?, ?)").run(LEGACY_USER_ID, new Date().toISOString(), new Date().toISOString());
    // Rebuild all related tables together, retaining every original column and value.
    for (const name of ["lists", "items", "list_items", "jobs"]) {
      const original = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name) as { sql: string }).sql;
      let sql = original.replace(`CREATE TABLE ${name}`, `CREATE TABLE ${name}_accounts`);
      sql = sql.replace(/REFERENCES (lists|items)\(id\)/g, "REFERENCES $1_accounts(id)");
      const additions = ["user_id TEXT NOT NULL REFERENCES users(id)"];
      if (name === "lists") additions.push("system_key TEXT", "UNIQUE(user_id, system_key)");
      if (name === "lists" || name === "items") additions.push("UNIQUE(user_id, id)");
      if (name === "list_items") additions.push("FOREIGN KEY(user_id, list_id) REFERENCES lists_accounts(user_id, id) ON DELETE CASCADE");
      if (name === "list_items" || name === "jobs") additions.push("FOREIGN KEY(user_id, item_id) REFERENCES items_accounts(user_id, id) ON DELETE CASCADE");
      // Column definitions must precede table constraints.
      const bodyEnd = sql.lastIndexOf(")");
      sql = sql.slice(0, bodyEnd) + ", " + additions.filter(x => !x.startsWith("user_id") && !x.startsWith("system_key")).join(", ") + sql.slice(bodyEnd);
      sql = sql.replace("(", "(\n user_id TEXT NOT NULL REFERENCES users(id),\n" + (name === "lists" ? "system_key TEXT,\n" : ""));
      // jobs and memberships have constraints; every rebuilt table has at least one added constraint.
      db.exec(sql);
      const cols = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map(c => c.name).join(", ");
      db.prepare(`INSERT INTO ${name}_accounts (${cols}, user_id) SELECT ${cols}, ? FROM ${name}`).run(LEGACY_USER_ID);
    }
    db.exec("UPDATE lists_accounts SET system_key='inbox' WHERE id='inbox'");
    db.exec("DROP TABLE jobs; DROP TABLE list_items; DROP TABLE items; DROP TABLE lists;");
    for (const name of ["lists", "items", "list_items", "jobs"]) db.exec(`ALTER TABLE ${name}_accounts RENAME TO ${name}`);
    db.exec(`CREATE INDEX list_items_order ON list_items(user_id, list_id, position);
      CREATE INDEX jobs_ready ON jobs(status, run_at, created_at);
      CREATE INDEX jobs_user ON jobs(user_id);
      CREATE INDEX placements_user ON list_items(user_id);`);
    if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Account migration foreign-key check failed");
    db.prepare("INSERT INTO schema_migrations VALUES (3, ?)").run(new Date().toISOString());
  }).immediate();
}

export function migrateOAuthAudience(db: Database.Database) {
  if ((db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v >= 4) return;
  db.transaction(() => {
    if ((db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v >= 4) return;
    db.exec("ALTER TABLE oauth_tokens ADD COLUMN issuer TEXT NOT NULL DEFAULT ''; ALTER TABLE oauth_tokens ADD COLUMN resource TEXT NOT NULL DEFAULT ''; UPDATE oauth_grants SET revoked=1;");
    db.prepare("INSERT INTO schema_migrations VALUES (4, ?)").run(new Date().toISOString());
  }).immediate();
}
