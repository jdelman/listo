import { LEGACY_USER_ID } from "../lib/backend/sqlite/accounts-migration";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openListoDatabase } from "../lib/backend/sqlite/database";
import { SQLiteBackend } from "../lib/backend/sqlite/sqlite-backend";
import { commandSchema } from "../lib/backend/command-schema";
import type { List } from "../lib/types";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "listo-flows-"));
  const database = openListoDatabase(join(directory, "listo.sqlite"));
  const backend = new SQLiteBackend(database, LEGACY_USER_ID);
  return { backend, close() { database.close(); rmSync(directory, { recursive: true, force: true }); } };
}

function list(id: string): List {
  const timestamp = new Date().toISOString();
  return { id, title: id, description: "", tags: [], defaultView: "list", createdAt: timestamp, updatedAt: timestamp };
}

function note(id: string, title: string) {
  return { id, type: "note" as const, title, description: "", tags: [], availability: { external: false, localReference: false, imported: false }, metadata: { markdown: title } };
}

test("list and item CRUD, ordering, and multi-list membership remain consistent", () => {
  const context = fixture();
  try {
    context.backend.createList(list("alpha"));
    context.backend.createList(list("beta"));
    context.backend.createItem(note("first", "First"), ["alpha"]);
    context.backend.createItem(note("second", "Second"), ["alpha"]);

    context.backend.moveItem("alpha", "second", -1);
    let state = context.backend.getDatabase();
    assert.deepEqual(state.listItems.filter((entry) => entry.listId === "alpha").map((entry) => entry.itemId), ["second", "first"]);

    context.backend.setItemLists("first", ["alpha", "beta"]);
    state = context.backend.getDatabase();
    assert.deepEqual(state.listItems.filter((entry) => entry.itemId === "first").map((entry) => entry.listId).sort(), ["alpha", "beta"]);

    context.backend.removeFromList("alpha", "first");
    context.backend.updateList("beta", { title: "Renamed" });
    context.backend.updateItem("first", { tags: ["edited"] });
    state = context.backend.getDatabase();
    assert.equal(state.lists.find((entry) => entry.id === "beta")?.title, "Renamed");
    assert.deepEqual(state.items.find((entry) => entry.id === "first")?.tags, ["edited"]);
    assert.equal(state.items.find((entry) => entry.id === "first")?.revision, 2);
    assert.deepEqual(state.listItems.filter((entry) => entry.itemId === "first").map((entry) => entry.listId), ["beta"]);

    context.backend.deleteList("beta");
    assert.ok(context.backend.getItem("first"), "deleting a list must not delete the underlying item");
    context.backend.deleteItem("first");
    state = context.backend.getDatabase();
    assert.equal(state.items.some((entry) => entry.id === "first"), false);
    assert.equal(state.jobs.some((entry) => entry.itemId === "first"), false);
  } finally { context.close(); }
});

test("grid view is accepted by commands and persisted per list", () => {
  const context = fixture();
  try {
    context.backend.createList(list("grid-list"));
    context.backend.createList(list("other-list"));
    const command = commandSchema.parse({ type: "updateList", id: "grid-list", patch: { defaultView: "grid" } });
    assert.equal(command.type, "updateList");
    if (command.type !== "updateList") throw new Error("Expected updateList");
    context.backend.updateList(command.id, command.patch);
    const state = context.backend.getDatabase();
    assert.equal(state.lists.find((entry) => entry.id === "grid-list")?.defaultView, "grid");
    assert.equal(state.lists.find((entry) => entry.id === "other-list")?.defaultView, "list");
  } finally { context.close(); }
});
