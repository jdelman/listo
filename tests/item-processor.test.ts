import assert from "node:assert/strict";
import test from "node:test";
import { ItemEnrichmentProcessor } from "../lib/processing/item-processor";
import type { Item } from "../lib/types";

test("decodes URL escapes and HTML entities in all extracted page text", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(`
    <title>Hello%20world &mdash; caf%C3%A9 &#x1F600;</title>
    <meta name="description" content="Tom%20%26amp%3B%20Jerry &copy; &#8212; &#37;20done">
    <body><p>Body%20text &euro; &hellip; A+B 100% legit %ZZ %FF%20end</p></body>
  `));
  const item = {
    id: "test", type: "url", title: "Fallback", description: "", tags: [],
    sourceUrl: "https://example.com", metadata: {}, revision: 1,
    createdAt: "", updatedAt: "",
    availability: { external: true, localReference: false, imported: false },
  } satisfies Item;
  const result = await new ItemEnrichmentProcessor().process(item, new AbortController().signal);
  assert.equal(result.attributes.fetchedTitle, "Hello world — café 😀");
  assert.equal(result.attributes.fetchedDescription, "Tom & Jerry © — done");
  assert.match(result.summary, /Body text € … A\+B 100% legit %ZZ %FF end/);
  assert.doesNotMatch(result.summary, /%20|&mdash;|&euro;/);
});
