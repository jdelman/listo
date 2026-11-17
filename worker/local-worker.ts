import { hostname } from "node:os";
import { resolve } from "node:path";
import nextEnv from "@next/env";
import { SQLiteBackend } from "../lib/backend/sqlite/sqlite-backend";
import { SpotifyPlaylistProcessor } from "../lib/processing/spotify-playlist";
import { ItemEnrichmentProcessor } from "../lib/processing/item-processor";
import { debugLoggingEnabled, workerLog, safeError } from "../lib/logging";
import { runWorker } from "./runner";
import { readVisiblePage } from "./visible-chrome";

const controller = new AbortController();
const workerId = `${hostname()}:${process.pid}`;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    workerLog("worker.stopping", "Worker shutdown requested", { workerId, signal });
    controller.abort();
  });
}

try {
  nextEnv.loadEnvConfig(process.cwd());
  if (process.argv.includes("--dev")) process.env.LISTO_DEBUG = "1";
  workerLog("worker.starting", "Starting enrichment worker", { workerId, database: resolve(process.env.LISTO_DB_PATH || "data/listo.sqlite") });
  const hasSpotifyClient = process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET;
  if (!hasSpotifyClient && !process.env.OPENROUTER_KEY && !process.env.SPOTIFY_REFRESH_TOKEN && !process.env.SPOTIFY_ACCESS_TOKEN) throw new Error("OPENROUTER_KEY is required for item enrichment");
  const backend = new SQLiteBackend(undefined, null);
  workerLog("worker.ready", "Worker ready to process queued items", { workerId });
  await runWorker({
    queue: backend,
    store: backend,
    processors: [
      new SpotifyPlaylistProcessor(backend),
      new ItemEnrichmentProcessor({
        readVisiblePage,
        onEvent: (description, fields) => workerLog(String(fields?.event || "enrichment.progress"), description, fields),
        debug: debugLoggingEnabled() ? (event, description, fields) => workerLog(event, description, fields, "debug") : undefined,
      }),
    ],
    workerId,
    onEvent: (description, fields) => workerLog(String(fields?.event || "worker.progress"), description, fields, fields?.error ? "error" : "info"),
  }, controller.signal);
  workerLog("worker.stopped", "Worker stopped", { workerId });
} catch (error) {
  workerLog("worker.fatal", "Worker exited after a fatal error", { workerId, error: safeError(error) }, "error");
  process.exitCode = 1;
}
