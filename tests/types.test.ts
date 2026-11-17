import assert from "node:assert/strict";
import test from "node:test";
import { uid } from "../lib/types";

test("uid creates unique RFC 4122 version 4 identifiers without randomUUID", () => {
  const values = new Set(Array.from({ length: 100 }, () => uid()));
  assert.equal(values.size, 100);
  for (const value of values) assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
