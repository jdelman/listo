import { safeError, type LogFields } from "../lib/logging";
import type { ItemProcessorStore, JobQueueBackend } from "../lib/backend/contracts";
import type { JobProcessor } from "../lib/processing/contracts";

export type WorkerDependencies = {
  queue: JobQueueBackend;
  store: ItemProcessorStore;
  processors: JobProcessor[];
  workerId: string;
  leaseMs?: number;
  pollMs?: number;
  onEvent?: (message: string, fields?: LogFields) => void;
};

export async function runOne(dependencies: WorkerDependencies, signal = new AbortController().signal) {
  const leaseMs = dependencies.leaseMs ?? 5 * 60_000;
  const job = await dependencies.queue.claim(dependencies.workerId, leaseMs);
  if (!job) return false;

  const started = Date.now();
  const fields = { jobId: job.id, itemId: job.itemId, attempt: job.attempts, maxAttempts: job.maxAttempts, workerId: dependencies.workerId };
  dependencies.onEvent?.("Claimed item for processing", { ...fields, event: "job.started" });
  const processor = dependencies.processors.find((candidate) => candidate.kind === job.kind);
  try {
    if (!processor) throw new Error(`No processor registered for ${job.kind}`);
    const item = await dependencies.store.getItem(job.itemId);
    if (!item) throw new Error("Item no longer exists");
    if (item.revision !== job.inputRevision) {
      await dependencies.queue.complete(job.id, job.lockToken);
      dependencies.onEvent?.("Skipped outdated item revision", { ...fields, event: "job.skipped" });
      return true;
    }
    const derived = await processor.process(item, signal);
    const saved = await dependencies.store.saveDerivedMetadata(item.id, job.inputRevision, derived);
    if (!saved) throw new Error("Item changed before processing completed");
    await dependencies.queue.complete(job.id, job.lockToken);
    dependencies.onEvent?.("Completed item enrichment", { ...fields, event: "job.completed", durationMs: Date.now() - started });
  } catch (error) {
    await dependencies.queue.fail(job.id, job.lockToken, error);
    dependencies.onEvent?.(job.attempts >= job.maxAttempts ? "Item enrichment failed; attempts exhausted" : "Item enrichment failed; retry scheduled", { ...fields, event: "job.failed", error: safeError(error), durationMs: Date.now() - started, retry: job.attempts < job.maxAttempts });
  }
  return true;
}

export async function runWorker(dependencies: WorkerDependencies, signal: AbortSignal) {
  const pollMs = dependencies.pollMs ?? 1_000;
  while (!signal.aborted) {
    try {
      const worked = await runOne(dependencies, signal);
      if (!worked) await wait(pollMs, signal);
    } catch (error) {
      dependencies.onEvent?.("Worker queue operation failed; retrying", { event: "worker.queue_error", workerId: dependencies.workerId, error: safeError(error) });
      await wait(pollMs, signal);
    }
  }
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timeout); signal.removeEventListener("abort", done); resolve(); };
    const timeout = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
    if (signal.aborted) done();
  });
}
