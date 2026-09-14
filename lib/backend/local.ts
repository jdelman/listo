import { SQLiteBackend } from "./sqlite/sqlite-backend";
import { openListoDatabase } from "./sqlite/database";

export function getLocalBackend(userId: string) {
  return new SQLiteBackend(openListoDatabase(), userId);
}
