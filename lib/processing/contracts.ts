import type { Item, ProcessingJob } from "../types";

export interface JobProcessor {
  readonly kind: ProcessingJob["kind"];
  process(item: Item, signal: AbortSignal): Promise<NonNullable<Item["metadata"]["derived"]>>;
}
