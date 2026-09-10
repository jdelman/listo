import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { openListoDatabase } from "../lib/backend/sqlite/database";
import { SQLiteBackend } from "../lib/backend/sqlite/sqlite-backend";
import { ItemEnrichmentProcessor } from "../lib/processing/item-processor";
import { completion, enrichment } from "./fixtures/enrichment";
import { runOne } from "../worker/runner";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "listo-test-"));
  const database = openListoDatabase(join(directory, "listo.sqlite"));
  const backend = new SQLiteBackend(database);
  return {
    backend,
    database,
    close() { database.close(); rmSync(directory, { recursive: true, force: true }); },
  };
}

function note(id = randomUUID()) {
  return {
    id,
    type: "note" as const,
    title: "A useful note",
    description: "Background processing should be durable.",
    tags: ["test"],
    availability: { external: false, localReference: false, imported: false },
    metadata: { markdown: "# SQLite\nA local queue keeps item creation and job creation together." },
  };
}

test("creating an item stores its placement and job atomically", () => {
  const context = fixture();
  try {
    const item = note();
    const job = context.backend.createItem(item, ["inbox"]);
    const state = context.backend.getDatabase();
    assert.equal(state.items[0].id, item.id);
    assert.equal(state.listItems[0].itemId, item.id);
    assert.equal(job.status, "queued");
    assert.equal(state.jobs[0].itemId, item.id);
    assert.equal(state.jobs[0].inputRevision, 1);
  } finally { context.close(); }
});

test("the worker claims, processes, and completes a job", async () => {
  const context = fixture();
  try {
    const item = note();
    context.backend.createItem(item, ["inbox"]);
    const worked = await runOne({
      queue: context.backend,
      store: context.backend,
      processors: [new ItemEnrichmentProcessor({ apiKey: "test", fetch: async () => completion(enrichment({ category: "clothing", specs: { ...enrichment().specs, size: "M", price: 42 } })) })],
      workerId: "test-worker",
    });
    assert.equal(worked, true);
    const state = context.backend.getDatabase();
    assert.equal(state.jobs[0].status, "completed");
    assert.equal(state.items[0].type, "clothing");
    assert.equal(state.items[0].metadata.size, "M");
    assert.equal(state.items[0].metadata.price, 42);
    assert.equal(state.items[0].description, enrichment().description);
    assert.equal(state.items[0].metadata.markdown, item.metadata.markdown);
    assert.match(state.items[0].metadata.derived?.summary ?? "", /useful note/i);
    assert.equal(state.items[0].metadata.derived?.processorVersion, "openrouter:openai/gpt-5.6-luna:v1");
  } finally { context.close(); }
});

test("expired worker leases return jobs to the queue", () => {
  const context = fixture();
  try {
    context.backend.createItem(note(), ["inbox"]);
    const claimed = context.backend.claim("crashed-worker", 1_000);
    assert.ok(claimed);
    context.database.prepare("UPDATE jobs SET locked_at = ? WHERE id = ?").run(new Date(0).toISOString(), claimed.id);
    assert.equal(context.backend.recoverExpired(1_000), 1);
    const replacement = context.backend.claim("replacement-worker", 1_000);
    assert.equal(replacement?.id, claimed.id);
  } finally { context.close(); }
});

test("does not overwrite a concurrent edit with enrichment", () => {
  const context = fixture();
  try {
    const item = note();
    context.backend.createItem(item, ["inbox"]);
    context.backend.updateItem(item.id, { description: "Edited by user" });
    assert.equal(context.backend.saveDerivedMetadata(item.id, 1, { summary: "LLM summary", category: "clothing", specs: { size: "M" }, attributes: {}, processedAt: new Date().toISOString(), processorVersion: "test" }), false);
    assert.equal(context.backend.getItem(item.id)?.description, "Edited by user");
    assert.equal(context.backend.getItem(item.id)?.type, "note");
  } finally { context.close(); }
});

test("LLM failure retries without changing the item", async () => {
  const context = fixture();
  try {
    const item = note();
    context.backend.createItem(item, ["inbox"]);
    await runOne({ queue: context.backend, store: context.backend, workerId: "test", processors: [new ItemEnrichmentProcessor({ apiKey: "test", fetch: async () => new Response("error", { status: 503 }) })] });
    assert.equal(context.backend.getItem(item.id)?.description, item.description);
    assert.equal(context.backend.getDatabase().jobs[0].status, "queued");
  } finally { context.close(); }
});

test("worker events identify the item, job, attempt and retry outcome", async () => {
  const context = fixture();
  try {
    const item = note();
    const job = context.backend.createItem(item, ["inbox"]);
    const events: { message: string; fields?: import("../lib/logging").LogFields }[] = [];
    await runOne({ queue: context.backend, store: context.backend, workerId: "test", processors: [{ kind: "process-item", process: async () => { throw new Error("source unavailable"); } }], onEvent: (message, fields) => events.push({ message, fields }) });
    assert.equal(events[0].fields?.event, "job.started");
    assert.equal(events[0].fields?.jobId, job.id);
    assert.equal(events[0].fields?.itemId, item.id);
    assert.equal(events[1].fields?.attempt, 1);
    assert.equal(events[1].fields?.retry, true);
    assert.equal(events[1].fields?.error, "source unavailable");
  } finally { context.close(); }
});

test("worker retries a queue error instead of exiting", async () => {
  const { runWorker } = await import("../worker/runner");
  const context = fixture();
  const controller = new AbortController();
  let claims = 0;
  const events: string[] = [];
  try {
    await runWorker({ queue: { claim: () => { claims++; if (claims === 1) throw new Error("database busy"); controller.abort(); return null; }, complete() {}, fail() {}, recoverExpired: () => 0 }, store: context.backend, processors: [], workerId: "test", pollMs: 1, onEvent: (message) => events.push(message) }, controller.signal);
    assert.equal(claims, 2);
    assert.match(events[0], /queue operation failed/);
  } finally { context.close(); }
});
