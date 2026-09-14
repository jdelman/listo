import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { StorageBackend } from "../lib/backend/contracts";
import { classify, mediaPlatform, youtubeId } from "../lib/capture";
import { uid } from "../lib/types";

const id = z.string().trim().min(1);
const pagination = { offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) };
function result(data: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data };
}
function missing(listId: string) {
  return { isError: true, content: [{ type: "text" as const, text: `List not found: ${listId}. Use list_lists to find a valid list ID.` }] };
}

export function createMcpServer(backend: StorageBackend, scopes = ["listo:read", "listo:write"]) {
  const server = new McpServer({ name: "listo", version: "0.1.0" });
  server.registerTool("list_lists", {
    description: "Fetch Listo lists, including Inbox, with IDs and item counts.",
    inputSchema: pagination,
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ offset, limit }) => {
    if (!scopes.includes("listo:read")) return { isError: true, content: [{ type: "text" as const, text: "Read permission required" }] };
    const db = await backend.getDatabase();
    return result({ lists: db.lists.slice(offset, offset + limit).map((list) => ({ ...list, itemCount: db.listItems.filter((entry) => entry.listId === list.id).length })), total: db.lists.length, offset });
  });
  server.registerTool("get_list", {
    description: "Fetch a Listo list and its items in list order. Use list_lists to discover IDs.",
    inputSchema: { listId: id, ...pagination },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ listId, offset, limit }) => {
    if (!scopes.includes("listo:read")) return { isError: true, content: [{ type: "text" as const, text: "Read permission required" }] };
    const db = await backend.getDatabase();
    const list = db.lists.find((entry) => entry.id === listId);
    if (!list) return missing(listId);
    const placements = db.listItems.filter((entry) => entry.listId === listId).sort((a, b) => a.position - b.position);
    const items = new Map(db.items.map((item) => [item.id, item]));
    return result({ list, items: placements.slice(offset, offset + limit).map((entry) => items.get(entry.itemId)), total: placements.length, offset });
  });
  server.registerTool("add_item", {
    description: "Create a note or URL item in an existing Listo list and queue normal enrichment. Each call creates a new item. Defaults to Inbox; URL types are detected automatically.",
    inputSchema: {
      listId: id.default("inbox"), title: z.string().trim().min(1).max(1000),
      description: z.string().max(100000).default(""), tags: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
      markdown: z.string().max(100000).optional(),
      url: z.string().url().refine((value) => /^https?:\/\//i.test(value), "URL must use HTTP or HTTPS").optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ listId, title, description, tags, markdown, url }) => {
    if (!scopes.includes("listo:write")) return { isError: true, content: [{ type: "text" as const, text: "Write permission required" }] };
    if (!(await backend.getDatabase()).lists.some((list) => list.id === listId)) return missing(listId);
    const type = url ? classify(url) : "note";
    const itemId = uid();
    await backend.createItem({
      id: itemId, type, title, description, tags: [...new Set(tags)], sourceUrl: url,
      availability: { external: Boolean(url), localReference: false, imported: false },
      metadata: { ...(markdown !== undefined || !url ? { markdown: markdown ?? description } : {}), ...(url ? { url } : {}), ...(type === "media" && url ? { platform: mediaPlatform(url), platformId: youtubeId(url) } : {}) },
    }, [listId]);
    const item = (await backend.getDatabase()).items.find((entry) => entry.id === itemId);
    return result({ item, listId });
  });
  return server;
}
