import { auditBackend } from "../audit";
import type Sqlite from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ClaimedJob, ItemProcessorStore, JobQueueBackend, NewItem, StorageBackend } from "../contracts";
import type { Database, Item, ItemMetadata, List, ListItem, ProcessingJob } from "../../types";
import { openListoDatabase } from "./database";

type ListRow = { id: string; title: string; description: string; tags_json: string; default_view: List["defaultView"]; created_at: string; updated_at: string };
type ItemRow = { id: string; type: Item["type"]; title: string; description: string; tags_json: string; source_url: string | null; availability_json: string; metadata_json: string; revision: number; created_at: string; updated_at: string };
type ListItemRow = { id: string; list_id: string; item_id: string; position: number };
type JobRow = { id: string; item_id: string; kind: ProcessingJob["kind"]; status: ProcessingJob["status"]; input_revision: number; attempts: number; max_attempts: number; run_at: string; lock_token: string | null; locked_at: string | null; last_error: string | null; created_at: string; updated_at: string };

export class SQLiteBackend implements StorageBackend, JobQueueBackend, ItemProcessorStore {
  constructor(private readonly db: Sqlite.Database = openListoDatabase()) {
    this.seedInbox();
    return auditBackend(this);
  }

  getDatabase(): Database {
    return {
      lists: (this.db.prepare("SELECT * FROM lists ORDER BY created_at").all() as ListRow[]).map(toList),
      items: (this.db.prepare("SELECT * FROM items ORDER BY created_at").all() as ItemRow[]).map(toItem),
      listItems: (this.db.prepare("SELECT * FROM list_items ORDER BY list_id, position").all() as ListItemRow[]).map(toListItem),
      jobs: (this.db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all() as JobRow[]).map(toJob),
    };
  }

  getItem(id: string): Item | null {
    const row = this.db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow | undefined;
    return row ? toItem(row) : null;
  }

  importDatabase(database: Database): void {
    this.db.transaction(() => {
      for (const list of database.lists) this.insertList(list, true);
      for (const item of database.items) {
        const normalized = { ...item, revision: item.revision || 1 };
        this.insertItem(normalized, true);
        this.enqueueItemJob(item.id, normalized.revision, true);
      }
      for (const placement of database.listItems) {
        this.db.prepare("INSERT OR IGNORE INTO list_items(id, list_id, item_id, position) VALUES (?, ?, ?, ?)").run(placement.id, placement.listId, placement.itemId, placement.position);
      }
    })();
  }

  createList(list: List): void { this.insertList(list, false); }

  updateList(id: string, patch: Partial<List>): void {
    const current = this.db.prepare("SELECT * FROM lists WHERE id = ?").get(id) as ListRow | undefined;
    if (!current) throw new Error("List not found");
    const list = { ...toList(current), ...patch, id, updatedAt: new Date().toISOString() };
    this.db.prepare("UPDATE lists SET title = ?, description = ?, tags_json = ?, default_view = ?, updated_at = ? WHERE id = ?")
      .run(list.title, list.description, JSON.stringify(list.tags), list.defaultView, list.updatedAt, id);
  }

  deleteList(id: string): void {
    if (id !== "inbox") this.db.prepare("DELETE FROM lists WHERE id = ?").run(id);
  }

  createItem(item: NewItem, listIds: string[]): ProcessingJob {
    const timestamp = new Date().toISOString();
    const full: Item = { ...item, revision: item.revision || 1, createdAt: item.createdAt || timestamp, updatedAt: item.updatedAt || timestamp };
    return this.db.transaction(() => {
      this.insertItem(full, false);
      const placement = this.db.prepare("INSERT INTO list_items(id, list_id, item_id, position) VALUES (?, ?, ?, ?)");
      for (const listId of listIds.length ? listIds : ["inbox"]) {
        const row = this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM list_items WHERE list_id = ?").get(listId) as { position: number };
        placement.run(randomUUID(), listId, full.id, row.position);
      }
      return this.enqueueItemJob(full.id, full.revision, false);
    })();
  }

  updateItem(id: string, patch: Partial<Item>): void {
    const current = this.getItem(id);
    if (!current) throw new Error("Item not found");
    const item = { ...current, ...patch, id, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    this.db.prepare(`UPDATE items SET type = ?, title = ?, description = ?, tags_json = ?, source_url = ?, availability_json = ?, metadata_json = ?, revision = ?, updated_at = ? WHERE id = ?`)
      .run(item.type, item.title, item.description, JSON.stringify(item.tags), item.sourceUrl ?? null, JSON.stringify(item.availability), JSON.stringify(item.metadata), item.revision, item.updatedAt, id);
  }

  deleteItem(id: string): void { this.db.prepare("DELETE FROM items WHERE id = ?").run(id); }

  setItemLists(itemId: string, listIds: string[]): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM list_items WHERE item_id = ?").run(itemId);
      const insert = this.db.prepare("INSERT INTO list_items(id, list_id, item_id, position) VALUES (?, ?, ?, ?)");
      for (const listId of listIds) {
        const row = this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM list_items WHERE list_id = ?").get(listId) as { position: number };
        insert.run(randomUUID(), listId, itemId, row.position);
      }
    })();
  }

  removeFromList(listId: string, itemId: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM list_items WHERE list_id = ? AND item_id = ?").run(listId, itemId);
      this.normalizeList(listId);
    })();
  }

  moveItem(listId: string, itemId: string, direction: -1 | 1): void {
    this.db.transaction(() => {
      const entries = this.listEntries(listId);
      const from = entries.findIndex((entry) => entry.itemId === itemId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= entries.length) return;
      [entries[from], entries[to]] = [entries[to], entries[from]];
      this.writePositions(entries);
    })();
  }

  reorderItem(listId: string, draggedId: string, targetId: string): void {
    this.db.transaction(() => {
      const entries = this.listEntries(listId);
      const from = entries.findIndex((entry) => entry.itemId === draggedId);
      const to = entries.findIndex((entry) => entry.itemId === targetId);
      if (from < 0 || to < 0 || from === to) return;
      const [entry] = entries.splice(from, 1);
      entries.splice(to, 0, entry);
      this.writePositions(entries);
    })();
  }

  claim(workerId: string, leaseMs: number): ClaimedJob | null {
    const claim = this.db.transaction(() => {
      this.recoverExpired(leaseMs);
      const now = new Date().toISOString();
      const row = this.db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND run_at <= ? ORDER BY created_at LIMIT 1").get(now) as JobRow | undefined;
      if (!row) return null;
      const lockToken = `${workerId}:${randomUUID()}`;
      const changed = this.db.prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1, lock_token = ?, locked_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
        .run(lockToken, now, now, row.id);
      if (changed.changes !== 1) return null;
      const claimed = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(row.id) as JobRow;
      return { ...toJob(claimed), lockToken };
    });
    return claim.immediate();
  }

  complete(jobId: string, lockToken: string): void {
    this.db.prepare("UPDATE jobs SET status = 'completed', lock_token = NULL, locked_at = NULL, last_error = NULL, updated_at = ? WHERE id = ? AND lock_token = ?")
      .run(new Date().toISOString(), jobId, lockToken);
  }

  fail(jobId: string, lockToken: string, error: unknown): void {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ? AND lock_token = ?").get(jobId, lockToken) as JobRow | undefined;
    if (!row) return;
    const terminal = row.attempts >= row.max_attempts;
    const delaySeconds = Math.min(300, 2 ** row.attempts);
    const runAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
    this.db.prepare("UPDATE jobs SET status = ?, run_at = ?, lock_token = NULL, locked_at = NULL, last_error = ?, updated_at = ? WHERE id = ? AND lock_token = ?")
      .run(terminal ? "failed" : "queued", runAt, errorMessage(error), new Date().toISOString(), jobId, lockToken);
  }

  recoverExpired(leaseMs: number): number {
    const cutoff = new Date(Date.now() - leaseMs).toISOString();
    const result = this.db.prepare("UPDATE jobs SET status = 'queued', lock_token = NULL, locked_at = NULL, updated_at = ? WHERE status = 'running' AND locked_at < ?")
      .run(new Date().toISOString(), cutoff);
    return result.changes;
  }

  saveDerivedMetadata(itemId: string, inputRevision: number, derived: NonNullable<ItemMetadata["derived"]>): boolean {
    const item = this.getItem(itemId);
    if (!item || item.revision !== inputRevision) return false;
    const metadata = { ...item.metadata, ...derived.specs, derived };
    const result = this.db.prepare("UPDATE items SET metadata_json = ?, updated_at = ?, type = ?, description = ? WHERE id = ? AND revision = ?")
      .run(JSON.stringify(metadata), derived.processedAt, derived.category ?? item.type, derived.summary, itemId, inputRevision);
    return result.changes === 1;
  }

  private seedInbox() {
    const timestamp = new Date().toISOString();
    this.db.prepare("INSERT OR IGNORE INTO lists(id, title, description, tags_json, default_view, created_at, updated_at) VALUES ('inbox', 'Inbox', 'Everything can land here first.', '[]', 'list', ?, ?)").run(timestamp, timestamp);
  }

  private insertList(list: List, ignore: boolean) {
    this.db.prepare(`INSERT ${ignore ? "OR IGNORE " : ""}INTO lists(id, title, description, tags_json, default_view, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(list.id, list.title, list.description, JSON.stringify(list.tags), list.defaultView, list.createdAt, list.updatedAt);
  }

  private insertItem(item: Item, ignore: boolean) {
    this.db.prepare(`INSERT ${ignore ? "OR IGNORE " : ""}INTO items(id, type, title, description, tags_json, source_url, availability_json, metadata_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.id, item.type, item.title, item.description, JSON.stringify(item.tags), item.sourceUrl ?? null, JSON.stringify(item.availability), JSON.stringify(item.metadata), item.revision || 1, item.createdAt, item.updatedAt);
  }

  private enqueueItemJob(itemId: string, inputRevision: number, ignore: boolean): ProcessingJob {
    const timestamp = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`INSERT ${ignore ? "OR IGNORE " : ""}INTO jobs(id, item_id, kind, status, input_revision, attempts, max_attempts, run_at, created_at, updated_at) VALUES (?, ?, 'process-item', 'queued', ?, 0, 5, ?, ?, ?)`)
      .run(id, itemId, inputRevision, timestamp, timestamp, timestamp);
    const row = this.db.prepare("SELECT * FROM jobs WHERE item_id = ? AND kind = 'process-item' AND input_revision = ?").get(itemId, inputRevision) as JobRow;
    return toJob(row);
  }

  private listEntries(listId: string) {
    return (this.db.prepare("SELECT * FROM list_items WHERE list_id = ? ORDER BY position").all(listId) as ListItemRow[]).map(toListItem);
  }

  private normalizeList(listId: string) { this.writePositions(this.listEntries(listId)); }

  private writePositions(entries: ListItem[]) {
    const update = this.db.prepare("UPDATE list_items SET position = ? WHERE id = ?");
    entries.forEach((entry, position) => update.run(position, entry.id));
  }
}

function toList(row: ListRow): List { return { id: row.id, title: row.title, description: row.description, tags: JSON.parse(row.tags_json), defaultView: row.default_view, createdAt: row.created_at, updatedAt: row.updated_at }; }
function toItem(row: ItemRow): Item { return { id: row.id, type: row.type, title: row.title, description: row.description, tags: JSON.parse(row.tags_json), sourceUrl: row.source_url ?? undefined, availability: JSON.parse(row.availability_json), metadata: JSON.parse(row.metadata_json), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function toListItem(row: ListItemRow): ListItem { return { id: row.id, listId: row.list_id, itemId: row.item_id, position: row.position }; }
function toJob(row: JobRow): ProcessingJob { return { id: row.id, itemId: row.item_id, kind: row.kind, status: row.status, inputRevision: row.input_revision, attempts: row.attempts, maxAttempts: row.max_attempts, runAt: row.run_at, lockedAt: row.locked_at ?? undefined, lastError: row.last_error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }; }
function errorMessage(error: unknown) { return (error instanceof Error ? error.message : String(error)).slice(0, 2000); }
