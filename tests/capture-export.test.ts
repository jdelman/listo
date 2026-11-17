import assert from "node:assert/strict";
import test from "node:test";
import { classify, mediaPlatform, youtubeId } from "../lib/capture";
import { renderListHtml } from "../lib/export";
import type { Item, List } from "../lib/types";

test("Quick Add classifies supported text, URLs, media, PDFs, and images", () => {
  assert.equal(classify("a plain note"), "note");
  assert.equal(classify("https://example.com"), "url");
  assert.equal(classify("https://youtu.be/dQw4w9WgXcQ"), "media");
  assert.equal(classify("https://example.com/reference.pdf"), "pdf");
  assert.equal(classify("", { name: "photo.jpg", type: "image/jpeg" }), "image");
  assert.equal(classify("", { name: "paper.pdf", type: "application/pdf" }), "pdf");
  assert.equal(mediaPlatform("https://music.apple.com/us/album/example"), "apple_music");
  assert.equal(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("static export preserves order, escapes content, and renders dynamic clothing measurements", () => {
  const timestamp = new Date().toISOString();
  const list: List = { id: "list", title: "Tweed & Jackets", description: "<reference>", tags: [], defaultView: "list", createdAt: timestamp, updatedAt: timestamp };
  const base = { description: "", tags: [], availability: { external: false, localReference: false, imported: false }, revision: 1, createdAt: timestamp, updatedAt: timestamp };
  const items: Item[] = [
    { ...base, id: "note", type: "note", title: "First", metadata: { markdown: "Opening note" } },
    { ...base, id: "coat", type: "clothing", title: "Second coat", metadata: { size: "40R", measurements: [{ id: "shoulder", name: "shoulder", value: 18.25, unit: "in" }] } },
  ];
  const html = renderListHtml(list, items);
  assert.ok(html.indexOf("First") < html.indexOf("Second coat"));
  assert.match(html, /Tweed &amp; Jackets/);
  assert.match(html, /&lt;reference&gt;/);
  assert.match(html, /shoulder/);
  assert.match(html, /18\.25 in/);
});
