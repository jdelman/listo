import type { Database, Item, ItemMetadata, List, ProcessingJob } from "../types";

export type NewItem = Omit<Item, "createdAt" | "updatedAt" | "revision"> & { createdAt?: string; updatedAt?: string; revision?: number };

export interface StorageBackend {
  getDatabase(): Promise<Database> | Database;
  importDatabase(database: Database): Promise<void> | void;
  createList(list: List): Promise<void> | void;
  updateList(id: string, patch: Partial<List>): Promise<void> | void;
  deleteList(id: string): Promise<void> | void;
  createItem(item: NewItem, listIds: string[]): Promise<ProcessingJob> | ProcessingJob;
  updateItem(id: string, patch: Partial<Item>): Promise<void> | void;
  deleteItem(id: string): Promise<void> | void;
  setItemLists(itemId: string, listIds: string[]): Promise<void> | void;
  removeFromList(listId: string, itemId: string): Promise<void> | void;
  moveItem(listId: string, itemId: string, direction: -1 | 1): Promise<void> | void;
  reorderItem(listId: string, draggedId: string, targetId: string): Promise<void> | void;
}

export type ClaimedJob = ProcessingJob & { lockToken: string };

export interface JobQueueBackend {
  claim(workerId: string, leaseMs: number): Promise<ClaimedJob | null> | ClaimedJob | null;
  complete(jobId: string, lockToken: string): Promise<void> | void;
  fail(jobId: string, lockToken: string, error: unknown): Promise<void> | void;
  recoverExpired(leaseMs: number): Promise<number> | number;
}

export interface ItemProcessorStore {
  getItem(id: string): Promise<Item | null> | Item | null;
  saveDerivedMetadata(itemId: string, inputRevision: number, derived: NonNullable<ItemMetadata["derived"]>): Promise<boolean> | boolean;
}

export type StorageCommand =
  | { type: "importDatabase"; database: Database }
  | { type: "createList"; list: List }
  | { type: "updateList"; id: string; patch: Partial<List> }
  | { type: "deleteList"; id: string }
  | { type: "createItem"; item: NewItem; listIds: string[] }
  | { type: "updateItem"; id: string; patch: Partial<Item> }
  | { type: "deleteItem"; id: string }
  | { type: "setItemLists"; itemId: string; listIds: string[] }
  | { type: "removeFromList"; listId: string; itemId: string }
  | { type: "moveItem"; listId: string; itemId: string; direction: -1 | 1 }
  | { type: "reorderItem"; listId: string; draggedId: string; targetId: string };
