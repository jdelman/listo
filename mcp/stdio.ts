import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server";

// Resolve the default database and .env.local independently of the client's cwd.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
nextEnv.loadEnvConfig(process.cwd(), false, { info: console.error, error: console.error });
const { openListoDatabase } = await import("../lib/backend/sqlite/database");
const { SQLiteBackend } = await import("../lib/backend/sqlite/sqlite-backend");
const database = openListoDatabase();
const username = process.env.LISTO_MCP_USER;
if (!username) throw new Error("Set LISTO_MCP_USER to the local account for this trusted stdio client");
const user = database.prepare("SELECT id FROM users WHERE username=? COLLATE NOCASE AND active=1").get(username) as { id: string } | undefined;
if (!user) throw new Error("MCP account unavailable");
const server = createMcpServer(new SQLiteBackend(database, user.id));
const transport = new StdioServerTransport();
server.server.onclose = () => database.close();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void server.close(); });
}
await server.connect(transport);
process.stdin.once("end", () => { void server.close(); });
