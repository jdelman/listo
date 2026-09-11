import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { metadataImages, storeThumbnail } from "../lib/processing/thumbnails";
import { FileThumbnailStorage } from "../lib/storage/thumbnail-storage";
import { ItemEnrichmentProcessor } from "../lib/processing/item-processor";
import { completion, enrichment } from "./fixtures/enrichment";
import { GET } from "../app/thumbnails/[key]/route";
import type { Item } from "../lib/types";

const png = Buffer.from(enrichment().thumbnailUrl.split(",")[1], "base64");
const item: Item = { id: "thumbnail", type: "url", title: "A page", description: "", tags: [], sourceUrl: "https://example.com/page", metadata: {}, revision: 1, createdAt: "", updatedAt: "", availability: { external: true, imported: false, localReference: false } };

test("metadata images handle attribute order, entities, relative URLs and priority", () => {
  assert.deepEqual(metadataImages(`<meta content='/twitter.png' name='twitter:image'><meta CONTENT="../photo.png?a=1&amp;b=2" PROPERTY="og:image"><link rel=image_src href=/fallback.jpg><meta property="og:image" content="javascript:bad">`, "https://example.com/articles/page"), ["https://example.com/photo.png?a=1&b=2", "https://example.com/twitter.png", "https://example.com/fallback.jpg"]);
});

test("stores raster bytes idempotently and rejects HTML, oversized content and traversal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "listo-thumbnails-"));
  try {
    const storage = new FileThumbnailStorage(directory);
    const url = await storeThumbnail("https://example.com/image", storage, async () => new Response(png), new AbortController().signal);
    assert.equal(await storage.put(png, "png"), url);
    assert.deepEqual((await storage.read(url.split("/").at(-1)!))?.bytes, png);
    assert.equal(await storage.read("../secret"), null);
    assert.equal(await storage.read(`${"a".repeat(64)}.png`), null);
    await assert.rejects(storeThumbnail("https://example.com/image", storage, async () => new Response("<html>error</html>"), new AbortController().signal), /raster/);
    await assert.rejects(storeThumbnail("https://example.com/image", storage, async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1)), new AbortController().signal), /8 MB/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const brokenMetadata of [false, true]) test(`uses ${brokenMetadata ? "LLM fallback after a broken metadata image" : "metadata before asking LLM for an image"}`, async () => {
  const calls: string[] = [];
  const result = await new ItemEnrichmentProcessor({ apiKey: "test", storage: { async put(bytes) { assert.deepEqual(Buffer.from(bytes), png); return "https://cdn.example.com/stored.png"; } }, fetch: async (url, init) => {
    calls.push(String(url));
    if (url === item.sourceUrl) return new Response('<meta property="og:image" content="/image.png">');
    if (url === "https://example.com/image.png") return brokenMetadata ? new Response("broken", { status: 404 }) : new Response(png);
    const body = JSON.parse(String(init?.body));
    assert.equal(JSON.parse(body.messages[1].content).needsThumbnail, brokenMetadata);
    return completion(enrichment({ thumbnailUrl: brokenMetadata ? enrichment().thumbnailUrl : null }));
  } }).process(item, new AbortController().signal);
  assert.equal(result.specs.thumbnailUrl, "https://cdn.example.com/stored.png");
  assert.deepEqual(calls, [item.sourceUrl, "https://example.com/image.png", "https://openrouter.ai/api/v1/chat/completions"]);
});

test("does not complete enrichment without a usable thumbnail", async () => {
  await assert.rejects(new ItemEnrichmentProcessor({ apiKey: "test", fetch: async () => completion(enrichment({ thumbnailUrl: null })) }).process({ ...item, type: "note", sourceUrl: undefined }, new AbortController().signal), /No usable thumbnail/);
});


test("serves stored images with cache headers and returns 404 for unknown keys", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "listo-thumbnail-route-"));
  const previous = process.env.LISTO_THUMBNAIL_DIR;
  process.env.LISTO_THUMBNAIL_DIR = directory;
  t.after(() => { if (previous === undefined) delete process.env.LISTO_THUMBNAIL_DIR; else process.env.LISTO_THUMBNAIL_DIR = previous; });
  try {
    const url = await new FileThumbnailStorage(directory).put(png, "png");
    const response = await GET(new Request("http://localhost" + url), { params: Promise.resolve({ key: url.split("/").at(-1)! }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.match(response.headers.get("cache-control")!, /immutable/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.equal((await GET(new Request("http://localhost"), { params: Promise.resolve({ key: "missing" }) })).status, 404);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
