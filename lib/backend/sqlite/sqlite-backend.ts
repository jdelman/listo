import { spotifyPlaylistId } from "../../spotify";
import { auditBackend } from "../audit";
import type Sqlite from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { ClaimedJob, ItemProcessorStore, JobQueueBackend, NewItem, StorageBackend } from "../contracts";
import type { Database, Item, ItemMetadata, List, ListItem, ProcessingJob } from "../../types";
import { LEGACY_USER_ID } from "./accounts-migration";
import { openListoDatabase } from "./database";

type ListRow = { system_key: string | null; user_id: string; metadata_json: string; id: string; title: string; description: string; tags_json: string; default_view: List["defaultView"]; created_at: string; updated_at: string };
type ItemRow = { id: string; type: Item["type"]; title: string; description: string; tags_json: string; source_url: string | null; availability_json: string; metadata_json: string; revision: number; created_at: string; updated_at: string };
type ListItemRow = { id: string; list_id: string; item_id: string; position: number };
type JobRow = { id: string; item_id: string; kind: ProcessingJob["kind"]; status: ProcessingJob["status"]; input_revision: number; attempts: number; max_attempts: number; run_at: string; lock_token: string | null; locked_at: string | null; last_error: string | null; created_at: string; updated_at: string };

export class SQLiteBackend implements StorageBackend, JobQueueBackend, ItemProcessorStore {
  constructor(private readonly db: Sqlite.Database = openListoDatabase(), readonly userId: string | null) {
    if (userId !== null && !db.prepare("SELECT id FROM users WHERE id=? AND active=1").get(userId)) throw new Error("Account unavailable");
    if (userId !== null) this.seedInbox();
    return auditBackend(this);
  }

  getDatabase(): Database {
    return {
      lists: (this.db.prepare("SELECT * FROM lists WHERE user_id = ? ORDER BY created_at").all(this.requireUser()) as ListRow[]).map(row => ({ ...toList(row), id: row.system_key === "inbox" ? "inbox" : row.id })),
      items: (this.db.prepare("SELECT * FROM items WHERE user_id = ? ORDER BY created_at").all(this.requireUser()) as ItemRow[]).map(toItem),
      listItems: (this.db.prepare("SELECT * FROM list_items WHERE user_id = ? ORDER BY list_id, position").all(this.requireUser()) as ListItemRow[]).map(row => ({ ...toListItem(row), listId: row.list_id === this.inboxId() ? "inbox" : row.list_id })),
      jobs: (this.db.prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC").all(this.requireUser()) as JobRow[]).map(toJob),
    };
  }

  getItem(id: string): Item | null {
    const row = this.db.prepare("SELECT * FROM items WHERE id = ? AND (? IS NULL OR user_id=?)").get(id, this.userId, this.userId) as ItemRow | undefined;
    return row ? toItem(row) : null;
  }

  importDatabase(database: Database): void {
    this.db.transaction(() => {
      const lists = new Map<string, string>();
      const items = new Map<string, string>();
      for (const list of database.lists) {
        const id = list.id === "inbox" ? this.inboxId() : randomUUID();
        lists.set(list.id, id);
        if (list.id !== "inbox") this.insertList({ ...list, id }, false);
      }
      for (const item of database.items) items.set(item.id, randomUUID());
      for (const item of database.items) {
        const id = items.get(item.id)!;
        const metadata = { ...item.metadata };
        if (metadata.importedListId) metadata.importedListId = lists.get(metadata.importedListId);
        this.insertItem({ ...item, id, metadata, revision: item.revision || 1 }, false);
        this.enqueueItemJob(id, item.revision || 1, false);
      }
      for (const placement of database.listItems) {
        const listId = lists.get(placement.listId), itemId = items.get(placement.itemId);
        if (!listId || !itemId) throw new Error("Invalid imported membership");
        this.db.prepare("INSERT INTO list_items(id, list_id, item_id, position, user_id) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), listId, itemId, placement.position, this.requireUser());
      }
    })();
  }

  createList(list: List): void { this.insertList(list, false); }

  updateList(id: string, patch: Partial<List>): void {
    id = this.ownedList(id);
    const current = this.db.prepare("SELECT * FROM lists WHERE id = ?").get(id) as ListRow | undefined;
    if (!current) throw new Error("List not found");
    const list = { ...toList(current), ...patch, id, updatedAt: new Date().toISOString() };
    this.db.prepare("UPDATE lists SET title = ?, description = ?, tags_json = ?, default_view = ?, updated_at = ?, metadata_json = ? WHERE id = ?")
      .run(list.title, list.description, JSON.stringify(list.tags), list.defaultView, list.updatedAt, JSON.stringify(list.metadata ?? {}), id);
  }

  deleteList(id: string): void {
    id = this.ownedList(id);
    if (id !== this.inboxId()) this.db.prepare("DELETE FROM lists WHERE id = ?").run(id);
  }

  createItem(item: NewItem, listIds: string[]): ProcessingJob {
    const timestamp = new Date().toISOString();
    const full: Item = { ...item, revision: item.revision || 1, createdAt: item.createdAt || timestamp, updatedAt: item.updatedAt || timestamp };
    return this.db.transaction(() => {
      listIds = (listIds.length ? listIds : ["inbox"]).map(id => this.ownedList(id));
      this.insertItem(full, false);
      const placement = this.db.prepare("INSERT INTO list_items(id, list_id, item_id, position, user_id) VALUES (?, ?, ?, ?, ?)");
      for (const listId of listIds.length ? listIds : ["inbox"]) {
        const row = this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM list_items WHERE list_id = ?").get(listId) as { position: number };
        placement.run(randomUUID(), listId, full.id, row.position, this.requireUser());
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

  deleteItem(id: string): void { this.ownedItem(id); this.db.prepare("DELETE FROM items WHERE id = ?").run(id); }

  setItemLists(itemId: string, listIds: string[]): void {
    this.db.transaction(() => {
      this.ownedItem(itemId);
      listIds = listIds.map(id => this.ownedList(id));
      this.db.prepare("DELETE FROM list_items WHERE item_id = ?").run(itemId);
      const insert = this.db.prepare("INSERT INTO list_items(id, list_id, item_id, position, user_id) VALUES (?, ?, ?, ?, ?)");
      for (const listId of listIds) {
        const row = this.db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM list_items WHERE list_id = ?").get(listId) as { position: number };
        insert.run(randomUUID(), listId, itemId, row.position, this.requireUser());
      }
    })();
  }

  removeFromList(listId: string, itemId: string): void {
    listId = this.ownedList(listId); this.ownedItem(itemId);
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM list_items WHERE list_id = ? AND item_id = ?").run(listId, itemId);
      this.normalizeList(listId);
    })();
  }

  moveItem(listId: string, itemId: string, direction: -1 | 1): void {
    listId = this.ownedList(listId); this.ownedItem(itemId);
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
    listId = this.ownedList(listId); this.ownedItem(draggedId); this.ownedItem(targetId);
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
      const row = this.db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND run_at <= ? AND (? IS NULL OR user_id=?) ORDER BY created_at LIMIT 1").get(now, this.userId, this.userId) as JobRow | undefined;
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

  /** Each write is fenced by the current lease and input revision. Retried positions are idempotent. */
  saveSpotifyImport(job: ClaimedJob, list: List, track?: Item, position?: number): void {
    const owner = this.db.prepare("SELECT user_id FROM jobs WHERE id=? AND lock_token=?").get(job.id, job.lockToken) as { user_id: string } | undefined;
    if (!owner || (this.userId !== null && owner.user_id !== this.userId)) throw new Error("Job owner or lease changed");
    if (this.userId === null) return new SQLiteBackend(this.db, owner.user_id).saveSpotifyImport(job, list, track, position);
    this.db.transaction(() => {
      const active = this.db.prepare("SELECT id FROM jobs WHERE id = ? AND lock_token = ? AND status = 'running'").get(job.id, job.lockToken);
      if (!active || this.getItem(job.itemId)?.revision !== job.inputRevision) throw new Error("Spotify import lease or source item changed");
      const existing = this.db.prepare("SELECT * FROM lists WHERE id = ?").get(list.id) as ListRow | undefined;
      if (existing && existing.user_id !== this.userId) throw new Error("List not found");
      if (existing && toList(existing).metadata?.spotifySnapshotId !== list.metadata?.spotifySnapshotId) throw new Error("Spotify playlist changed since partial import; paste the playlist again for a fresh import");
      if (!existing) {
        const source = this.getItem(job.itemId)!;
        if (source.metadata.importedListId) throw new Error("Imported list was deleted");
        this.insertList(list, false);
        this.db.prepare("UPDATE items SET metadata_json = ? WHERE id = ?").run(JSON.stringify({ ...source.metadata, importedListId: list.id }), source.id);
      }
      if (track) {
        this.insertItem(track, true);
        this.db.prepare("INSERT OR IGNORE INTO list_items(id, list_id, item_id, position, user_id) VALUES (?, ?, ?, ?, ?)").run(track.id, list.id, track.id, position, this.requireUser());
      }
      this.db.prepare("UPDATE jobs SET locked_at = ? WHERE id = ? AND lock_token = ?").run(new Date().toISOString(), job.id, job.lockToken);
    })();
  }

  private requireUser(): string {
    if (!this.userId) throw new Error("User context required");
    return this.userId;
  }

  private inboxId(): string {
    const row = this.db.prepare("SELECT id FROM lists WHERE user_id=? AND system_key='inbox'").get(this.requireUser()) as { id: string };
    return row.id;
  }

  private ownedList(id: string): string {
    if (id === "inbox") id = this.inboxId();
    if (!this.db.prepare("SELECT id FROM lists WHERE id=? AND user_id=?").get(id, this.requireUser())) throw new Error("List not found");
    return id;
  }

  private ownedItem(id: string): void {
    if (!this.getItem(id)) throw new Error("Item not found");
  }

  private seedInbox() {
    const timestamp = new Date().toISOString();
    const id = this.userId === LEGACY_USER_ID ? "inbox" : randomUUID();
    this.db.prepare("INSERT OR IGNORE INTO lists(id, user_id, system_key, title, description, tags_json, default_view, created_at, updated_at) VALUES (?, ?, 'inbox', 'Inbox', 'Everything can land here first.', '[]', 'list', ?, ?)").run(id, this.requireUser(), timestamp, timestamp);
  }

  private insertList(list: List, ignore: boolean) {
    this.db.prepare(`INSERT ${ignore ? "OR IGNORE " : ""}INTO lists(user_id, id, title, description, tags_json, default_view, created_at, updated_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(this.requireUser(), list.id, list.title, list.description, JSON.stringify(list.tags), list.defaultView, list.createdAt, list.updatedAt, JSON.stringify(list.metadata ?? {}));
  }

  private insertItem(item: Item, ignore: boolean) {
    const existing = this.db.prepare("SELECT user_id FROM items WHERE id=?").get(item.id) as { user_id: string } | undefined;
    if (existing && existing.user_id !== this.userId) throw new Error("Item not found");
    this.db.prepare(`INSERT ${ignore ? "OR IGNORE " : ""}INTO items(user_id, id, type, title, description, tags_json, source_url, availability_json, metadata_json, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(this.requireUser(), item.id, item.type, item.title, item.description, JSON.stringify(item.tags), item.sourceUrl ?? null, JSON.stringify(item.availability), JSON.stringify(item.metadata), item.revision || 1, item.createdAt, item.updatedAt);
  }

  private enqueueItemJob(itemId: string, inputRevision: number, ignore: boolean): ProcessingJob {
    const timestamp = new Date().toISOString();
    const id = randomUUID();
    const item = this.getItem(itemId);
    const kind = spotifyPlaylistId(item?.sourceUrl || item?.metadata.url || item?.metadata.markdown || "") ? "import-spotify-playlist" : "process-item";
    this.db.prepare(`INSERT ${ignore ? "OR IGNORE " : ""}INTO jobs(user_id, id, item_id, kind, status, input_revision, attempts, max_attempts, run_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, 0, 5, ?, ?, ?)`)
      .run(this.requireUser(), id, itemId, kind, inputRevision, timestamp, timestamp, timestamp);
    const row = this.db.prepare("SELECT * FROM jobs WHERE item_id = ? AND kind = ? AND input_revision = ?").get(itemId, kind, inputRevision) as JobRow;
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

function toList(row: ListRow): List { return { metadata: JSON.parse(row.metadata_json), id: row.id, title: row.title, description: row.description, tags: JSON.parse(row.tags_json), defaultView: row.default_view, createdAt: row.created_at, updatedAt: row.updated_at }; }
function toItem(row: ItemRow): Item { return { id: row.id, type: row.type, title: row.title, description: row.description, tags: JSON.parse(row.tags_json), sourceUrl: row.source_url ?? undefined, availability: JSON.parse(row.availability_json), metadata: JSON.parse(row.metadata_json), revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }; }
function toListItem(row: ListItemRow): ListItem { return { id: row.id, listId: row.list_id, itemId: row.item_id, position: row.position }; }
function toJob(row: JobRow): ProcessingJob { return { id: row.id, itemId: row.item_id, kind: row.kind, status: row.status, inputRevision: row.input_revision, attempts: row.attempts, maxAttempts: row.max_attempts, runAt: row.run_at, lockedAt: row.locked_at ?? undefined, lastError: row.last_error ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }; }
function errorMessage(error: unknown) { return (error instanceof Error ? error.message : String(error)).slice(0, 2000); }
