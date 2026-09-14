import { openListoDatabase } from "../backend/sqlite/database";
function references(value: unknown): string[] {
  if (typeof value === "string") return value.match(/\/thumbnails\/[a-f0-9]{64}\.(?:png|jpg|gif|webp)/g) ?? [];
  if (value && typeof value === "object") return Object.values(value).flatMap(references);
  return [];
}
export function ownsThumbnail(userId: string, path: string) {
  const db = openListoDatabase();
  for (const table of ["items", "lists"]) {
    const rows = db.prepare(`SELECT metadata_json FROM ${table} WHERE user_id=?`).all(userId) as { metadata_json: string }[];
    if (rows.some(row => references(JSON.parse(row.metadata_json)).includes(path))) return true;
  }
  return false;
}
export function validateThumbnailReferences(userId: string, value: unknown) {
  for (const path of new Set(references(value))) if (!ownsThumbnail(userId, path)) throw new Error("Thumbnail not found");
}
