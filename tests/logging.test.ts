import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLogger, safeError } from "../lib/logging";
import { auditBackend } from "../lib/backend/audit";

test("logs matching structured events to stderr and separate files", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "listo-logs-"));
  const lines: string[] = [];
  t.mock.method(console, "error", (line: string) => lines.push(line));
  try {
    createLogger("application", directory)("application.createItem", "Create item", { id: "item-1" });
    createLogger("worker", directory)("job.started", "Process item", { itemId: "item-1", jobId: "job-1" });
    assert.equal(readFileSync(join(directory, "application.log"), "utf8"), `${lines[0]}\n`);
    assert.equal(readFileSync(join(directory, "worker.log"), "utf8"), `${lines[1]}\n`);
    assert.equal(JSON.parse(lines[1]).jobId, "job-1");
    assert.ok(JSON.parse(lines[1]).timestamp);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("file failures preserve the operation and report the failure to console", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "listo-logs-"));
  const lines: string[] = [];
  t.mock.method(console, "error", (line: string) => lines.push(line));
  try {
    const file = join(directory, "not-a-directory");
    writeFileSync(file, "");
    assert.doesNotThrow(() => createLogger("worker", file)("worker.ready", "Worker ready"));
    assert.equal(JSON.parse(lines[1]).event, "logging.write_failed");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("audits sync and async successes and failures without recording item contents", async () => {
  const events: unknown[][] = [];
  const backend = auditBackend({
    createItem: (item: { id: string; description: string }) => item.id,
    updateItem: async () => { throw new Error("update failed"); },
    deleteItem: () => { throw new Error("delete failed"); },
  }, (...event) => events.push(event));
  assert.equal(backend.createItem({ id: "item-1", description: "private content" }), "item-1");
  await assert.rejects(backend.updateItem(), /update failed/);
  assert.throws(() => backend.deleteItem(), /delete failed/);
  assert.equal(events.length, 3);
  assert.match(JSON.stringify(events), /item-1/);
  assert.doesNotMatch(JSON.stringify(events), /private content/);
  assert.equal(events[1][3], "error");
});

test("redacts credentials from errors", () => {
  const previous = process.env.LISTO_TEST_SECRET;
  process.env.LISTO_TEST_SECRET = "example-private-key";
  try { assert.equal(safeError(new Error("example-private-key Bearer abc123")), "[redacted] Bearer [redacted]"); }
  finally { if (previous === undefined) delete process.env.LISTO_TEST_SECRET; else process.env.LISTO_TEST_SECRET = previous; }
});

test("browser events validate input and reject cross-origin requests", async (t) => {
  const { POST } = await import("../app/api/events/route");
  t.mock.method(console, "error", () => {});
  const request = (body: unknown, origin = "http://jdsrv.local:3000") => new Request("http://jdsrv.local:3000/api/events", { method: "POST", headers: { origin }, body: JSON.stringify(body) });
  assert.equal((await POST(request({ action: "activate", control: "Export HTML", path: "/lists/example" }))).status, 204);
  assert.equal((await POST(request({ action: "activate", path: "/lists" }, "https://other.example"))).status, 403);
  assert.equal((await POST(request({ action: "unknown", path: "/lists" }))).status, 400);
  assert.equal((await POST(request({ action: "navigate", path: "/search?q=private" }))).status, 400);
  assert.equal((await POST(request({ action: "activate", control: "x".repeat(3000), path: "/lists" }))).status, 413);
});
