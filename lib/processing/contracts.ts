import type { ClaimedJob } from "../backend/contracts";
import type { Item, ProcessingJob } from "../types";

export interface JobProcessor {
  readonly kind: ProcessingJob["kind"];
  process(item: Item, signal: AbortSignal, job?: ClaimedJob): Promise<NonNullable<Item["metadata"]["derived"]>>;
}
