export type ItemType = "note" | "url" | "media" | "pdf" | "image" | "movie" | "clothing";
export type ViewMode = "list" | "compact" | "gallery" | "playlist" | "document" | "table";

export type Measurement = { id: string; name: string; value: string | number; unit?: "in" | "cm" };

export type ItemMetadata = {
  price?: number;
  currency?: string;
  brand?: string;
  material?: string;
  color?: string;
  markdown?: string;
  url?: string;
  platform?: "youtube" | "apple_music" | "soundcloud" | "other";
  platformId?: string;
  fileName?: string;
  dataUrl?: string;
  mimeType?: string;
  tmdbId?: number;
  year?: number;
  name?: string;
  size?: string;
  measurements?: Measurement[];
  derived?: {
    summary: string;
    category?: ItemType;
    specs?: Partial<Omit<ItemMetadata, "derived">>;
    attributes: Record<string, string | number | string[]>;
    processedAt: string;
    processorVersion: string;
  };
};

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ProcessingJob = {
  id: string;
  itemId: string;
  kind: "process-item";
  status: JobStatus;
  inputRevision: number;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  lockedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

export type Item = {
  id: string;
  type: ItemType;
  title: string;
  description: string;
  tags: string[];
  sourceUrl?: string;
  availability: { external: boolean; localReference: boolean; imported: boolean };
  createdAt: string;
  updatedAt: string;
  revision: number;
  metadata: ItemMetadata;
};

export type List = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  defaultView: ViewMode;
  createdAt: string;
  updatedAt: string;
};

export type ListItem = { id: string; listId: string; itemId: string; position: number };
export type Database = { lists: List[]; items: Item[]; listItems: ListItem[]; jobs: ProcessingJob[] };

export const ITEM_LABELS: Record<ItemType, string> = {
  note: "Note", url: "Website", media: "Media", pdf: "PDF", image: "Image", movie: "Movie", clothing: "Clothing",
};

export const MEASUREMENT_PRESETS = ["chest", "sleeve", "length", "collar", "waist", "hem", "inseam", "outseam", "thigh"];

export const uid = () => {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};
export const now = () => new Date().toISOString();
export const splitTags = (value: string) => [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
