import assert from "node:assert/strict";
import test from "node:test";
import RawDatabase from "better-sqlite3";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountFixture } from "./account-fixture";
import { digest, Accounts } from "../lib/auth/accounts";
import { SQLiteBackend } from "../lib/backend/sqlite/sqlite-backend";
import { migrateLegacy, openListoDatabase } from "../lib/backend/sqlite/database";
import { LEGACY_USER_ID } from "../lib/backend/sqlite/accounts-migration";
import { commandSchema } from "../lib/backend/command-schema";
import { POST as logout } from "../app/logout/route";
import { GET as state } from "../app/api/state/route";
import { POST as command } from "../app/api/commands/route";
import { ownsThumbnail, validateThumbnailReferences } from "../lib/auth/thumbnails";
const note = (id: string) => ({ id, type: "note" as const, title: id, description: "", tags: ["private"], metadata: {}, availability: { external: false, localReference: false, imported: false } });

test("migration preserves all version-2 records, enforces ownership, backs up, and is repeatable", () => {
  const dir = mkdtempSync(join(tmpdir(), "listo-migration-")), path = join(dir, "legacy.sqlite");
  let db = new RawDatabase(path); migrateLegacy(db);
  const time = new Date().toISOString();
  db.prepare("INSERT INTO lists(id,title,tags_json,created_at,updated_at) VALUES ('inbox','Inbox','[\"old\"]',?,?)").run(time,time);
  db.prepare("INSERT INTO items(id,type,title,tags_json,availability_json,created_at,updated_at) VALUES ('old','note','Old','[\"tag\"]','{}',?,?)").run(time,time);
  db.exec("INSERT INTO list_items VALUES ('p','inbox','old',7)");
  db.prepare("INSERT INTO jobs(id,item_id,kind,input_revision,run_at,created_at,updated_at) VALUES ('j','old','process-item',1,?,?,?)").run(time,time,time);
  const original = Object.fromEntries(["lists", "items", "list_items", "jobs"].map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
  db.close();
  try {
    db = openListoDatabase(path);
    assert.ok(readdirSync(dir).some(name => name.startsWith("legacy.sqlite.before-accounts-")));
    for (const [table, rows] of Object.entries(original)) {
      const migrated = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
      assert.deepEqual(migrated.map(({ user_id, system_key: _system, ...row }) => { assert.equal(user_id, LEGACY_USER_ID); void _system; return row; }), rows);
    }
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    const before = new SQLiteBackend(db, LEGACY_USER_ID).getDatabase(); db.close(); db = openListoDatabase(path);
    assert.deepEqual(new SQLiteBackend(db, LEGACY_USER_ID).getDatabase(), before);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM users").get() as { n: number }).n, 1);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("login, password change, recovery, session expiry and logout revoke access", async () => {
  const f = accountFixture();
  try {
    await f.accounts.bootstrap("test-password-one");
    assert.equal(await f.accounts.bootstrap("different-password"), false);
    assert.equal(await f.accounts.login("jdelman", "incorrect"), null);
    const token = await f.accounts.login("JDELMAN", "test-password-one"); assert.ok(token);
    assert.equal(f.accounts.session(token)?.username, "jdelman");
    const reset = f.accounts.resetLink("jdelman");
    await f.accounts.resetPassword(reset, "test-password-two");
    assert.equal(f.accounts.session(token), undefined);
    await assert.rejects(f.accounts.resetPassword(reset, "test-password-three"));
    const next = await f.accounts.login("jdelman", "test-password-two"); assert.ok(next);
    await f.accounts.changePassword(LEGACY_USER_ID, "test-password-two", "test-password-three");
    assert.equal(f.accounts.session(next), undefined);
    const last = await f.accounts.login("jdelman", "test-password-three"); assert.ok(last);
    const request = (origin = "http://localhost:3000") => new Request("http://localhost:3000/logout", { method: "POST", headers: { origin, cookie: `listo_session=${last}` } });
    assert.equal((await logout(request("https://foreign.test"))).status, 403);
    assert.ok(f.accounts.session(last));
    const response = await logout(request()); assert.equal(response.status, 303);
    assert.match(response.headers.get("set-cookie")!, /Max-Age=0/);
    assert.equal(response.headers.get("location"), "http://localhost:3000/login");
    assert.equal(f.accounts.session(last), undefined);
    assert.equal((await logout(request())).status, 303);
    assert.equal((await state(new Request("http://localhost:3000/api/state"))).status, 401);
  } finally { f.close(); }
});

test("users cannot access or mutate each other's records, memberships, tags or thumbnails", async () => {
  const f = accountFixture();
  try {
    const second = await f.accounts.create("second", "second-password");
    const other = new SQLiteBackend(f.db, second.id);
    f.backend.createItem(note("private-item"), ["inbox"]);
    other.createItem(note("other-item"), ["inbox"]);
    assert.equal(other.getItem("private-item"), null);
    const time = new Date().toISOString();
    f.backend.createList({ id: "private-list", title: "Private", description: "", tags: ["hidden"], defaultView: "list", createdAt: time, updatedAt: time });
    for (const action of [() => other.updateItem("private-item", { title: "leak" }), () => other.deleteItem("private-item"), () => other.updateList("private-list", { title: "leak" }), () => other.deleteList("private-list"), () => other.setItemLists("other-item", ["private-list"]), () => other.removeFromList("private-list", "other-item"), () => other.moveItem("private-list", "other-item", 1), () => other.reorderItem("inbox", "other-item", "private-item"), () => other.createItem(note("bad"), ["private-list"])]) assert.throws(action, /not found/);
    assert.equal(other.getDatabase().items.length, 1);
    assert.doesNotMatch(JSON.stringify(other.getDatabase()), /private-item|private-list|hidden/);
    assert.throws(() => f.db.prepare("INSERT INTO list_items(id,user_id,list_id,item_id,position) VALUES ('bad',?,?,?,0)").run(second.id, "private-list", "other-item"), /FOREIGN KEY/);
    const path = `/thumbnails/${"a".repeat(64)}.png`;
    f.backend.updateList("private-list", { metadata: { thumbnailUrl: path } });
    assert.equal(ownsThumbnail(second.id, path), false);
    assert.throws(() => validateThumbnailReferences(second.id, { metadata: { thumbnailUrl: path } }), /not found/);
    const imported = other.getDatabase(); f.backend.importDatabase(imported);
    assert.equal(f.backend.getDatabase().items.length, 2);
    assert.equal(other.getDatabase().items.length, 1);
    assert.equal(f.backend.getItem("other-item"), null);
    assert.equal(commandSchema.safeParse({ type: "updateItem", id: "other-item", patch: { user_id: LEGACY_USER_ID } }).success, false);
    const token = await f.accounts.login("second", "second-password"); assert.ok(token);
    const response = await command(new Request("http://localhost:3000/api/commands", { method: "POST", headers: { origin: "http://localhost:3000", cookie: `listo_session=${token}` }, body: JSON.stringify({ type: "deleteItem", id: "private-item" }) }));
    assert.equal(response.status, 404);
    assert.ok(f.backend.getItem("private-item"));
  } finally { f.close(); }
});

test("expired sessions and recovery links fail and login throttling is persistent", async () => {
  const f = accountFixture();
  try {
    f.db.prepare("UPDATE sessions SET expires_at=0 WHERE token_hash=?").run(digest(f.token));
    assert.equal(f.accounts.session(f.token), undefined);
    const reset = f.accounts.resetLink("jdelman");
    f.db.exec("UPDATE password_resets SET expires_at=0");
    await assert.rejects(f.accounts.resetPassword(reset, "long-test-password"));
    for (let i=0;i<10;i++) f.accounts.throttle("check");
    assert.throws(() => new Accounts(f.db).throttle("check"), /Too many/);
  } finally { f.close(); }
});

test("a failed migration rolls back without changing legacy records", () => {
  const dir = mkdtempSync(join(tmpdir(), "listo-failed-migration-")), path = join(dir, "legacy.sqlite");
  const original = new RawDatabase(path); migrateLegacy(original);
  original.exec("PRAGMA foreign_keys=OFF; INSERT INTO list_items VALUES ('broken','missing-list','missing-item',0)");
  original.close();
  try {
    assert.throws(() => openListoDatabase(path), /FOREIGN KEY/);
    const check = new RawDatabase(path);
    assert.equal((check.prepare("SELECT MAX(version) v FROM schema_migrations").get() as { v: number }).v, 2);
    assert.equal((check.prepare("SELECT COUNT(*) n FROM list_items").get() as { n: number }).n, 1);
    assert.equal(check.prepare("SELECT name FROM sqlite_master WHERE name='users'").get(), undefined);
    check.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the trusted worker processes both accounts without crossing ownership", async () => {
  const f = accountFixture();
  try {
    const other = await f.accounts.create("worker-user", "worker-test-password");
    const second = new SQLiteBackend(f.db, other.id);
    f.backend.createItem(note("first-job"), ["inbox"]); second.createItem(note("second-job"), ["inbox"]);
    const worker = new SQLiteBackend(f.db, null);
    const { runOne } = await import("../worker/runner");
    const dependencies = { queue: worker, store: worker, workerId: "test", processors: [{ kind: "process-item" as const, process: async (item: { id: string }) => ({ summary: item.id, attributes: {}, processedAt: new Date().toISOString(), processorVersion: "test" }) }] };
    assert.equal(await runOne(dependencies), true); assert.equal(await runOne(dependencies), true);
    assert.equal(f.backend.getDatabase().items[0].metadata.derived?.summary, "first-job");
    assert.equal(second.getDatabase().items[0].metadata.derived?.summary, "second-job");
    assert.equal(f.backend.getDatabase().jobs[0].status, "completed"); assert.equal(second.getDatabase().jobs[0].status, "completed");
    assert.deepEqual(f.db.pragma("foreign_key_check"), []);
  } finally { f.close(); }
});
