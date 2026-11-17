import type { Item } from "./types";

export function uploadedItemImage(item: Item) {
  return [item.metadata.imageDataUrl, item.metadata.dataUrl].find(
    (value) => typeof value === "string" && /^data:image\/[\w.+-]+;base64,/i.test(value),
  );
}
