import { hostname } from "node:os";
import { SQLiteBackend } from "../lib/backend/sqlite/sqlite-backend";
import { ItemEnrichmentProcessor } from "../lib/processing/item-processor";
import { runWorker } from "./runner";

const { default: nextEnv } = await import("@next/env");
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.OPENROUTER_KEY) throw new Error("OPENROUTER_KEY is required for item enrichment");
const backend = new SQLiteBackend();
const controller = new AbortController();
const workerId = `${hostname()}:${process.pid}`;

process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());

console.log("Listo worker ready");
await runWorker({
  queue: backend,
  store: backend,
  processors: [new ItemEnrichmentProcessor()],
  workerId,
  onEvent: (message) => console.log(`[worker] ${message}`),
}, controller.signal);
