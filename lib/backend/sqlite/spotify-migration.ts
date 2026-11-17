import type Database from "better-sqlite3";

export function migrateSpotifyConnections(db: Database.Database) {
  const version = () => (db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v;
  if (version() >= 5) return;
  db.transaction(() => {
    if (version() >= 5) return;
    db.exec(`
      CREATE TABLE spotify_connections (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        tokens TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE spotify_authorizations (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        state_hash TEXT NOT NULL UNIQUE,
        session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
        browser_origin TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        result TEXT,
        claimed INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.prepare("INSERT INTO schema_migrations VALUES (5, ?)").run(new Date().toISOString());
  }).immediate();
}
