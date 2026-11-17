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
  assert.equal(result.title, "Hello world — café 😀");
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


test("leaves the title unchanged when the page title is missing or blank", async () => {
  for (const html of ["<p>No title</p>", "<title> \n &nbsp; </title>"]) {
    const result = await new ItemEnrichmentProcessor({ apiKey: "test", fetch: async (url) =>
      url === "https://openrouter.ai/api/v1/chat/completions" ? completion(enrichment()) : new Response(html),
    }).process({ ...baseItem, type: "url", sourceUrl: "https://example.com" }, new AbortController().signal);
    assert.equal(result.title, undefined);
  }
});

test("discards a browser challenge and enriches from citations on other sites", async () => {
  const sourceUrl = "https://musicbrainz.org/release-group/album";
  const alternateUrl = "https://record-label.example/albums/giant-steps";
  const events: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    if (url === sourceUrl) return new Response(`
      <title>Verifying your browser</title>
      <meta property="og:image" content="https://musicbrainz.org/challenge.png">
      <body>Verification text must never reach enrichment.</body>`);
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    if (body.tools) {
      assert.deepEqual(body.tools[0].parameters.excluded_domains, ["musicbrainz.org"]);
      assert.deepEqual(JSON.parse(body.messages[1].content), { itemTitle: "Giant Steps" });
      return Response.json({ choices: [{ message: { content: alternateUrl, annotations: [
        { type: "url_citation", url_citation: { url: "https://www.musicbrainz.org/other", content: "Blocked host excerpt" } },
        { type: "url_citation", url_citation: { url: "https://blocked.example/album", title: "Just a moment...", content: "Blocked alternate excerpt" } },
        { type: "url_citation", url_citation: { url: "https://unrelated.example/album", content: "Unrelated excerpt", uncited: true } },
        { type: "url_citation", url_citation: { url: alternateUrl, content: "Giant Steps was recorded by John Coltrane.", uncited: true } },
      ] } }] });
    }
    const { pageContent } = JSON.parse(body.messages[1].content);
    assert.equal(pageContent, `${alternateUrl}\nGiant Steps was recorded by John Coltrane.`);
    return completion(enrichment({ category: "media", description: "An album by John Coltrane.", thumbnailUrl: null }));
  };
  const result = await new ItemEnrichmentProcessor({
    apiKey: "test",
    fetch: fetcher,
    onEvent: (_description, fields) => { if (typeof fields?.event === "string") events.push(fields.event); },
  }).process({ ...baseItem, type: "url", title: "Giant Steps", sourceUrl }, new AbortController().signal);
  assert.equal(result.title, undefined);
  assert.equal(result.attributes.fetchedTitle, undefined);
  assert.equal(result.specs.thumbnailUrl, undefined);
  assert.equal(result.summary, "An album by John Coltrane.");
  assert.deepEqual(result.attributes.enrichmentSources, [alternateUrl]);
  assert.ok(events.includes("enrichment.source_blocked"));
  assert.ok(events.includes("enrichment.alternate_sources"));
  assert.ok(!events.includes("enrichment.source_completed"));
});

test("leaves enrichment unsaved when an access block has no usable alternate source", async () => {
  const sourceUrl = "https://example.com/item";
  const fetcher: typeof fetch = async (url, init) => {
    if (url === sourceUrl) return new Response("", { status: 403 });
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.ok(JSON.parse(String(init?.body)).tools, "only the search request should run");
    return Response.json({ choices: [{ message: { annotations: [
      { type: "url_citation", url_citation: { url: "https://another.example/item" } },
    ] } }] });
  };
  await assert.rejects(
    new ItemEnrichmentProcessor({ apiKey: "test", fetch: fetcher })
      .process({ ...baseItem, type: "url", sourceUrl }, new AbortController().signal),
    /no usable alternate source/,
  );
});

test("finds a Spotify album for a music note and saves enrichment without cover art", async () => {
  const spotifyUrl = "https://open.spotify.com/album/46VoobaZCtFPReElOHFEqq";
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    if (!body.tools) return completion(enrichment({ category: "album", thumbnailUrl: null }));
    assert.deepEqual(body.tools[0].parameters.allowed_domains, ["open.spotify.com"]);
    assert.match(body.messages[0].content, /album/);
    return Response.json({ choices: [{ message: { content: spotifyUrl, annotations: [
      { type: "url_citation", url_citation: { url: "https://open.spotify.com/track/3QroYcCSekAcQQzHk4fEcL", content: "Juju, a song by Wayne Shorter" } },
      { type: "url_citation", url_citation: { url: spotifyUrl, content: "JuJu, an album by Wayne Shorter", uncited: true } },
    ] } }] });
  };
  const result = await new ItemEnrichmentProcessor({ apiKey: "test", fetch: fetcher })
    .process({ ...baseItem, title: "Wayne Shorter - Juju" }, new AbortController().signal);
  assert.equal(result.specs.spotifyUrl, spotifyUrl);
  assert.equal(result.category, "album");
  assert.equal(result.specs.thumbnailUrl, undefined);
});

test("an uploaded item image is kept out of the enrichment request", async () => {
  const processor = new ItemEnrichmentProcessor({
    apiKey: "test",
    fetch: async (url, init) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      const input = JSON.parse(body.messages[1].content);
      assert.equal(input.needsThumbnail, false);
      assert.equal(input.item.metadata.imageDataUrl, undefined);
      return completion(enrichment({ category: "image" }));
    },
  });
  const result = await processor.process({
    ...baseItem, type: "image", metadata: { imageDataUrl: "data:image/png;base64,iVBORw0KGgo=" },
  }, new AbortController().signal);
  assert.equal(result.category, "image");
});
