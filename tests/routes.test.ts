import assert from "node:assert/strict";
import test from "node:test";
import { Screen, screenFromUrl, urlForScreen } from "../lib/routes";

function parse(url: string) {
  const parsed = new URL(url, "http://listo.test");
  return screenFromUrl(parsed.pathname, parsed.searchParams);
}

test("every primary screen has a stable URL", () => {
  assert.equal(urlForScreen({ name: "lists" }), "/lists");
  assert.equal(urlForScreen({ name: "list", id: "inbox" }), "/inbox");
  assert.equal(urlForScreen({ name: "list", id: "reading list" }), "/lists/reading%20list");
  assert.equal(urlForScreen({ name: "search" }), "/search");
  assert.equal(urlForScreen({ name: "quick" }), "/add");
  assert.equal(urlForScreen({ name: "item", id: "item/one" }), "/items/item%2Fone");
});

test("screen state survives a URL round trip", () => {
  const screens: Screen[] = [
    { name: "lists", tag: "weekend", creating: true },
    { name: "list", id: "abc", query: "blue coat", editing: true },
    { name: "search", query: "22.5", type: "clothing", listId: "abc", tag: "vintage", offline: true },
    { name: "quick", destinationListId: "abc", kind: "movie" },
    { name: "item", id: "item-1", returnTo: "/search?q=coat&tag=wool", editing: true },
  ];

  for (const screen of screens) assert.deepEqual(parse(urlForScreen(screen)), screen);
});

test("root and unknown paths have a safe lists fallback", () => {
  assert.deepEqual(parse("/"), { name: "lists", tag: undefined, creating: false });
  assert.deepEqual(parse("/not-a-screen"), { name: "lists" });
});
