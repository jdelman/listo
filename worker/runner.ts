import type { ItemProcessorStore, JobQueueBackend } from "../lib/backend/contracts";
import type { JobProcessor } from "../lib/processing/contracts";

export type WorkerDependencies = {
  queue: JobQueueBackend;
  store: ItemProcessorStore;
  processors: JobProcessor[];
  workerId: string;
  leaseMs?: number;
  pollMs?: number;
  onEvent?: (message: string) => void;
};

export async function runOne(dependencies: WorkerDependencies, signal = new AbortController().signal) {
  const leaseMs = dependencies.leaseMs ?? 5 * 60_000;
  const job = await dependencies.queue.claim(dependencies.workerId, leaseMs);
  if (!job) return false;

  const processor = dependencies.processors.find((candidate) => candidate.kind === job.kind);
  try {
    if (!processor) throw new Error(`No processor registered for ${job.kind}`);
    const item = await dependencies.store.getItem(job.itemId);
    if (!item) throw new Error("Item no longer exists");
    if (item.revision !== job.inputRevision) {
      await dependencies.queue.complete(job.id, job.lockToken);
      dependencies.onEvent?.(`Skipped stale job ${job.id}`);
      return true;
    }
    const derived = await processor.process(item, signal);
    const saved = await dependencies.store.saveDerivedMetadata(item.id, job.inputRevision, derived);
    if (!saved) throw new Error("Item changed before processing completed");
    await dependencies.queue.complete(job.id, job.lockToken);
    dependencies.onEvent?.(`Completed ${job.kind} for ${item.title}`);
  } catch (error) {
    await dependencies.queue.fail(job.id, job.lockToken, error);
    dependencies.onEvent?.(`Failed ${job.kind}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return true;
}

export async function runWorker(dependencies: WorkerDependencies, signal: AbortSignal) {
  const pollMs = dependencies.pollMs ?? 1_000;
  while (!signal.aborted) {
    const worked = await runOne(dependencies, signal);
    if (!worked) await wait(pollMs, signal);
  }
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
}
