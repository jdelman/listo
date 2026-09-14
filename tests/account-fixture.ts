import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openListoDatabase } from "../lib/backend/sqlite/database";
import { Accounts, digest, secret } from "../lib/auth/accounts";
import { LEGACY_USER_ID } from "../lib/backend/sqlite/accounts-migration";
import { SQLiteBackend } from "../lib/backend/sqlite/sqlite-backend";
export function accountFixture() {
  const directory = mkdtempSync(join(tmpdir(), "listo-account-test-"));
  const previous = { path: process.env.LISTO_DB_PATH, origin: process.env.LISTO_ORIGIN };
  process.env.LISTO_DB_PATH = join(directory, "test.sqlite");
  process.env.LISTO_ORIGIN = "http://localhost:3000";
  const db = openListoDatabase(process.env.LISTO_DB_PATH);
  const accounts = new Accounts(db), token = secret();
  db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(digest(token), LEGACY_USER_ID, Date.now() + 60000);
  const backend = new SQLiteBackend(db, LEGACY_USER_ID);
  return { directory, db, accounts, backend, token, cookie: `listo_session=${token}`, close() {
    db.close(); rmSync(directory, { recursive: true, force: true });
    for (const [key, value] of [["LISTO_DB_PATH", previous.path], ["LISTO_ORIGIN", previous.origin]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; }
  } };
}
