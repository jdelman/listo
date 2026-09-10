import { applicationLog, safeError, type Logger, type LogFields } from "../logging";

const descriptions: Record<string, string> = {
  getDatabase: "Read application state", getItem: "Read item", importDatabase: "Import database",
  createList: "Create list", updateList: "Update list", deleteList: "Delete list",
  createItem: "Create item and queue enrichment", updateItem: "Update item", deleteItem: "Delete item",
  setItemLists: "Change item list memberships", removeFromList: "Remove item from list",
  moveItem: "Move item in list", reorderItem: "Reorder item in list",
  saveDerivedMetadata: "Save item enrichment",
};

// Instrument the shared boundary so browser and MCP operations have the same audit trail.
// Bind to the original target to avoid logging internal reads and queue polling.
export function auditBackend<T extends object>(backend: T, log: Logger = applicationLog): T {
  return new Proxy(backend, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const action = String(property);
      if (!descriptions[action]) return value.bind(target);
      return (...args: unknown[]) => {
        const started = Date.now();
        const fields: LogFields = { action };
        if (typeof args[0] === "string") fields.id = args[0];
        if (args[0] && typeof args[0] === "object" && "id" in args[0] && typeof args[0].id === "string") fields.id = args[0].id;
        if (typeof args[1] === "string") fields.relatedId = args[1];
        if (Array.isArray(args[1]) && args[1].every((id) => typeof id === "string")) fields.listIds = args[1];
        const success = (result: unknown) => {
          log(`application.${action}`, descriptions[action], { ...fields, outcome: result === false ? "skipped" : "succeeded", durationMs: Date.now() - started });
          return result;
        };
        const failure = (error: unknown): never => {
          log(`application.${action}`, descriptions[action], { ...fields, outcome: "failed", durationMs: Date.now() - started, error: safeError(error) }, "error");
          throw error;
        };
        try {
          const result = value.apply(target, args);
          return result instanceof Promise ? result.then(success, failure) : success(result);
        } catch (error) { return failure(error); }
      };
    },
  });
}
