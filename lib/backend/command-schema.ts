import { z } from "zod";
const id = z.string().min(1).max(256);
const text = z.string().max(100_000);
const tags = z.array(z.string().min(1).max(100)).max(100);
const metadata = z.record(z.unknown());
const list = z.object({ id, title: z.string().min(1).max(1000), description: text, tags,
  defaultView: z.enum(["list", "grid", "compact", "gallery", "playlist", "document", "table"]),
  createdAt: z.string(), updatedAt: z.string(), metadata: metadata.optional() }).strict();
const item = z.object({ id, type: z.enum(["note", "url", "media", "pdf", "image", "movie", "clothing"]),
  title: z.string().min(1).max(1000), description: text, tags, sourceUrl: z.string().max(10000).optional(),
  availability: z.object({ external: z.boolean(), localReference: z.boolean(), imported: z.boolean() }).strict(),
  metadata, revision: z.number().int().positive().optional(), createdAt: z.string().optional(), updatedAt: z.string().optional() }).strict();
const editableList = list.omit({ id: true, createdAt: true }).partial();
const editableItem = item.omit({ id: true, createdAt: true, revision: true }).partial();
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("createList"), list }).strict(),
  z.object({ type: z.literal("updateList"), id, patch: editableList }).strict(),
  z.object({ type: z.literal("deleteList"), id }).strict(),
  z.object({ type: z.literal("createItem"), item, listIds: z.array(id).max(1000) }).strict(),
  z.object({ type: z.literal("updateItem"), id, patch: editableItem }).strict(),
  z.object({ type: z.literal("deleteItem"), id }).strict(),
  z.object({ type: z.literal("setItemLists"), itemId: id, listIds: z.array(id).max(1000) }).strict(),
  z.object({ type: z.literal("removeFromList"), listId: id, itemId: id }).strict(),
  z.object({ type: z.literal("moveItem"), listId: id, itemId: id, direction: z.union([z.literal(-1), z.literal(1)]) }).strict(),
  z.object({ type: z.literal("reorderItem"), listId: id, draggedId: id, targetId: id }).strict(),
  z.object({ type: z.literal("importDatabase"), database: z.object({ lists: z.array(list), items: z.array(item),
    listItems: z.array(z.object({ id, listId: id, itemId: id, position: z.number().int().nonnegative() }).strict()), jobs: z.array(z.unknown()).optional() }).strict() }).strict(),
]);
