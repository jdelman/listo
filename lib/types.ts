export type ItemType = "note" | "url" | "media" | "pdf" | "image" | "movie" | "clothing";
export type ViewMode = "list" | "compact" | "gallery" | "playlist" | "document" | "table";

export type Measurement = { id: string; name: string; value: string | number; unit?: "in" | "cm" };

export type ItemMetadata = {
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
export type Database = { lists: List[]; items: Item[]; listItems: ListItem[] };

export const ITEM_LABELS: Record<ItemType, string> = {
  note: "Note", url: "Website", media: "Media", pdf: "PDF", image: "Image", movie: "Movie", clothing: "Clothing",
};

export const MEASUREMENT_PRESETS = ["chest", "sleeve", "length", "collar", "waist", "hem", "inseam", "outseam", "thigh"];

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const splitTags = (value: string) => [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
