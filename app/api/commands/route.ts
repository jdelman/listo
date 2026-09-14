import { limitedBody, requestUser, sameOrigin, authError } from "@/lib/auth/http";
import { commandSchema } from "@/lib/backend/command-schema";
import { validateThumbnailReferences } from "@/lib/auth/thumbnails";
import type { StorageCommand } from "@/lib/backend/contracts";
import { getLocalBackend } from "@/lib/backend/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = requestUser(request);
  if (!user) return authError("Sign in required", 401);
  if (request.headers.get("x-listo-user") && request.headers.get("x-listo-user") !== user.username) return authError("Account changed. Reload the page.", 409);
  try { sameOrigin(request); } catch { return authError("Invalid request origin", 403); }
  try {
    const body = await limitedBody(request, 25_000_000);
    if (body.length > 25_000_000) return authError("Import is too large", 413);
    const parsed = commandSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return authError("Invalid command", 400);
    const command = parsed.data as StorageCommand;
    validateThumbnailReferences(user.id, command);
    const backend = getLocalBackend(user.id);
    let result: unknown;
    switch (command.type) {
      case "importDatabase": result = backend.importDatabase(command.database); break;
      case "createList": result = backend.createList(command.list); break;
      case "updateList": result = backend.updateList(command.id, command.patch); break;
      case "deleteList": result = backend.deleteList(command.id); break;
      case "createItem": result = backend.createItem(command.item, command.listIds); break;
      case "updateItem": result = backend.updateItem(command.id, command.patch); break;
      case "deleteItem": result = backend.deleteItem(command.id); break;
      case "setItemLists": result = backend.setItemLists(command.itemId, command.listIds); break;
      case "removeFromList": result = backend.removeFromList(command.listId, command.itemId); break;
      case "moveItem": result = backend.moveItem(command.listId, command.itemId, command.direction); break;
      case "reorderItem": result = backend.reorderItem(command.listId, command.draggedId, command.targetId); break;
      default: return Response.json({ error: "Unknown command" }, { status: 400 });
    }
    return Response.json({ ok: true, result });
  } catch (error) {
    return authError(error instanceof Error && /not found/i.test(error.message) ? "Record not found" : "Command could not be completed", error instanceof Error && /not found/i.test(error.message) ? 404 : 400);
  }
}
