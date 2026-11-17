import assert from "node:assert/strict";
import test from "node:test";
import { textLinks } from "../lib/links";

test("recognizes multiple Markdown and bare links while preserving sentence punctuation", () => {
  assert.deepEqual(textLinks("See [Discography](https://example.com/wiki/Juju_(album)), (https://example.com/list), and www.example.com."), [
    { text: "See " },
    { text: "Discography", href: "https://example.com/wiki/Juju_(album)" },
    { text: ", (" },
    { text: "https://example.com/list", href: "https://example.com/list" },
    { text: "), and " },
    { text: "www.example.com", href: "https://www.example.com" },
    { text: "." },
  ]);
  assert.deepEqual(textLinks("[bad](javascript:alert(1))"), [{ text: "[bad](javascript:alert(1))" }]);
});
