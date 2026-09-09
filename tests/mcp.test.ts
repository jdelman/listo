import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openListoDatabase } from "../lib/backend/sqlite/database";
import { SQLiteBackend } from "../lib/backend/sqlite/sqlite-backend";

test("stdio MCP discovers tools, reads ordered lists, persists additions, and rejects invalid writes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "listo-mcp-"));
  const path = join(directory, "test.sqlite");
  const database = openListoDatabase(path);
  const backend = new SQLiteBackend(database);
  const timestamp = new Date().toISOString();
  backend.createList({ id: "reading", title: "Reading", description: "", tags: [], defaultView: "list", createdAt: timestamp, updatedAt: timestamp });
  const client = new Client({ name: "listo-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", join(process.cwd(), "node_modules/tsx/dist/loader.mjs"), join(process.cwd(), "mcp/stdio.ts")],
    cwd: tmpdir(), env: { ...process.env as Record<string, string>, LISTO_DB_PATH: path }, stderr: "pipe",
  });
  try {
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), ["add_item", "get_list", "list_lists"]);
    const lists = await client.callTool({ name: "list_lists", arguments: {} });
    const listData = z.object({ total: z.number().int().nonnegative() }).parse(lists.structuredContent);
    assert.equal(listData.total, 2);
    for (const title of ["First", "Second"]) {
      const added = await client.callTool({ name: "add_item", arguments: { listId: "reading", title, url: "https://example.com", tags: ["read", "read"] } });
      assert.ok(!added.isError);
    }
    const fetched = await client.callTool({ name: "get_list", arguments: { listId: "reading", offset: 1, limit: 1 } });
    const fetchedData = z.object({
      total: z.number().int().nonnegative(),
      items: z.array(z.object({ title: z.string() })),
    }).parse(fetched.structuredContent);
    assert.equal(fetchedData.total, 2);
    assert.equal(fetchedData.items.length, 1);
    assert.equal(fetchedData.items[0].title, "Second");
    await client.callTool({ name: "add_item", arguments: { title: "Inbox note", markdown: "Hello" } });
    const state = backend.getDatabase();
    assert.equal(state.items.length, 3);
    assert.equal(state.jobs.length, 3);
    assert.deepEqual(state.items[0].tags, ["read"]);
    assert.ok(state.listItems.some((entry) => entry.listId === "inbox"));
    for (const args of [{ listId: "missing", title: "No" }, { title: " " }, { title: "Bad URL", url: "file:///etc/passwd" }]) {
      assert.equal((await client.callTool({ name: "add_item", arguments: args })).isError, true);
    }
    assert.equal((await client.callTool({ name: "get_list", arguments: { listId: "missing" } })).isError, true);
    assert.equal(backend.getDatabase().items.length, 3);
    assert.equal(backend.getDatabase().jobs.length, 3);
  } finally {
    await client.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
