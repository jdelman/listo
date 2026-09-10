import { hostname } from "node:os";
import { resolve } from "node:path";
import { SQLiteBackend } from "../lib/backend/sqlite/sqlite-backend";
import { ItemEnrichmentProcessor } from "../lib/processing/item-processor";
import { workerLog, safeError } from "../lib/logging";
import { runWorker } from "./runner";

const controller = new AbortController();
const workerId = `${hostname()}:${process.pid}`;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    workerLog("worker.stopping", "Worker shutdown requested", { workerId, signal });
    controller.abort();
  });
}

try {
  const { default: nextEnv } = await import("@next/env");
  nextEnv.loadEnvConfig(process.cwd());
  workerLog("worker.starting", "Starting enrichment worker", { workerId, database: resolve(process.env.LISTO_DB_PATH || "data/listo.sqlite") });
  if (!process.env.OPENROUTER_KEY) throw new Error("OPENROUTER_KEY is required for item enrichment");
  const backend = new SQLiteBackend();
  workerLog("worker.ready", "Worker ready to process queued items", { workerId });
  await runWorker({
    queue: backend,
    store: backend,
    processors: [new ItemEnrichmentProcessor({ onEvent: (description, fields) => workerLog(String(fields?.event || "enrichment.progress"), description, fields) })],
    workerId,
    onEvent: (description, fields) => workerLog(String(fields?.event || "worker.progress"), description, fields, fields?.error ? "error" : "info"),
  }, controller.signal);
  workerLog("worker.stopped", "Worker stopped", { workerId });
} catch (error) {
  workerLog("worker.fatal", "Worker exited after a fatal error", { workerId, error: safeError(error) }, "error");
  process.exitCode = 1;
}
