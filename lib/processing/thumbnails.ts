import { decodeHTML } from "entities";
import type { ThumbnailStorage } from "../storage/thumbnail-storage";

export function metadataImages(html: string, baseUrl: string): string[] {
  const candidates: { rank: number; url: string }[] = [];
  for (const tag of html.matchAll(/<(?:meta|link)\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const match of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[match[1].toLowerCase()] = decodeHTML(match[2] ?? match[3] ?? match[4]);
    }
    const name = (attrs.property || attrs.name || attrs.rel || "").toLowerCase();
    const rank = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src", "image_src"].indexOf(name);
    if (rank < 0) continue;
    try {
      const url = new URL(attrs.content || attrs.href, baseUrl);
      if (["https:", "http:"].includes(url.protocol)) candidates.push({ rank, url: url.href });
    } catch { /* Skip malformed metadata and try the next image. */ }
  }
  return [...new Set(candidates.sort((a, b) => a.rank - b.rank).map(({ url }) => url))];
}

export async function storeThumbnail(url: string, storage: ThumbnailStorage, request: typeof fetch, signal: AbortSignal) {
  if (!/^https?:\/\//i.test(url) && !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(url)) throw new Error("Unsupported thumbnail URL");
  const response = url.startsWith("data:")
    ? new Response(Buffer.from(url.split(",")[1], "base64"))
    : await request(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]) });
  if (!response.ok || !response.body) throw new Error("Thumbnail download failed");
  const limit = 8 * 1024 * 1024;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Thumbnail exceeds 8 MB");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  const extension = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "jpg"
    : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) ? "gif"
    : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "webp" : null;
  if (!extension) throw new Error("Thumbnail is not a supported raster image");
  return storage.put(bytes, extension);
}
