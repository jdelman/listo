import assert from "node:assert/strict";
import test from "node:test";
import { ItemEnrichmentProcessor } from "../lib/processing/item-processor";
import { completion, enrichment } from "./fixtures/enrichment";
import type { Item } from "../lib/types";

test("decodes URL escapes and HTML entities in all extracted page text", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      const body = JSON.parse(String(init?.body));
      const input = JSON.parse(body.messages[1].content);
      assert.equal(input.url, "https://example.com");
      assert.equal(body.model, "openai/gpt-5.6-luna");
      assert.equal(body.response_format.json_schema.strict, true);
      return completion(enrichment({ description: input.pageContent }));
    }
    return new Response(`
    <title>Hello%20world &mdash; caf%C3%A9 &#x1F600;</title>
    <meta name="description" content="Tom%20%26amp%3B%20Jerry &copy; &#8212; &#37;20done">
    <body><p>Body%20text &euro; &hellip; A+B 100% legit %ZZ %FF%20end</p></body>
  `); });
  const item = {
    id: "test", type: "url", title: "Fallback", description: "", tags: [],
    sourceUrl: "https://example.com", metadata: {}, revision: 1,
    createdAt: "", updatedAt: "",
    availability: { external: true, localReference: false, imported: false },
  } satisfies Item;
  const result = await new ItemEnrichmentProcessor({ apiKey: "test-key" }).process(item, new AbortController().signal);
  assert.equal(result.attributes.fetchedTitle, "Hello world — café 😀");
  assert.equal(result.attributes.fetchedDescription, "Tom & Jerry © — done");
  assert.match(result.summary, /Body text € … A\+B 100% legit %ZZ %FF end/);
  assert.doesNotMatch(result.summary, /%20|&mdash;|&euro;/);
});

const baseItem = { id: "test", type: "note", title: "Test", description: "", tags: [], metadata: {}, revision: 1, createdAt: "", updatedAt: "", availability: { external: false, localReference: false, imported: false } } satisfies Item;

test("extracts clothing fields and preserves product JSON-LD in the prompt", async () => {
  const result = await new ItemEnrichmentProcessor({ apiKey: "test", fetch: async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (url !== "https://openrouter.ai/api/v1/chat/completions") return new Response('<p>Shirt</p><script type="application/ld+json">{"price":42}</script>');
    assert.match(String(init?.body), /price/);
    return completion(enrichment({ category: "clothing", specs: { ...enrichment().specs, size: "M", price: 42, currency: "USD", measurements: [{ name: "chest", value: 40, unit: "in" }] } }));
  } }).process({ ...baseItem, type: "clothing", sourceUrl: "https://example.com/shirt" }, new AbortController().signal);
  assert.equal(result.category, "clothing");
  assert.equal(result.specs.size, "M");
  assert.equal(result.specs.price, 42);
  assert.equal(result.specs.measurements?.[0].unit, "in");
  assert.ok(result.specs.measurements?.[0].id);
});

test("rejects invalid categories, malformed JSON, truncated output and API errors", async () => {
  for (const response of [completion(enrichment({ category: "unknown" })), new Response('{"choices":[{"finish_reason":"stop","message":{"content":"invalid"}}]}'), new Response('{"choices":[{"finish_reason":"length"}]}'), new Response("unavailable", { status: 429 })]) {
    await assert.rejects(new ItemEnrichmentProcessor({ apiKey: "test", fetch: async () => response }).process(baseItem, new AbortController().signal));
  }
});

test("requires a key before fetching source content", async () => {
  await assert.rejects(new ItemEnrichmentProcessor({ apiKey: "", fetch: async () => { throw new Error("should not fetch"); } }).process(baseItem, new AbortController().signal), /OPENROUTER_KEY/);
});
