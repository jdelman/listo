import assert from "node:assert/strict";
import test from "node:test";
import { origin, requestOrigin, sameOrigin } from "../lib/auth/origins";
import { go, sessionCookie } from "../lib/auth/http";

function request(target: string, source = target, extra: Record<string, string> = {}) {
  return new Request(`${target}/api/auth/login`, { method: "POST", headers: { origin: source, ...extra } });
}

test("local login accepts the supported hostnames without changing cookie or redirect origin", t => {
  const previous = process.env.LISTO_ORIGIN;
  delete process.env.LISTO_ORIGIN;
  t.after(() => { if (previous === undefined) delete process.env.LISTO_ORIGIN; else process.env.LISTO_ORIGIN = previous; });
  for (const host of ["localhost", "127.0.0.1", "[::1]", "jdsrv", "jdsrv.local"]) {
    const url = `http://${host}:3000`, req = request(url);
    assert.doesNotThrow(() => sameOrigin(req));
    assert.equal(requestOrigin(req), url);
    assert.equal(go("/profile", sessionCookie("token", false, req)).headers.get("location"), "/profile");
    assert.doesNotMatch(sessionCookie("token", false, req), /Secure/);
  }
  // Next's internal request URL can differ from the browser-visible Host header.
  assert.doesNotThrow(() => sameOrigin(request("http://localhost:3000", "http://jdsrv.local:3000", { host: "jdsrv.local:3000" })));
  assert.equal(origin(), "http://localhost:3000", "MCP issuer remains canonical");
});

test("origin protection rejects unrelated sites, alias-to-alias requests, missing origins and forged proxy headers", t => {
  const previous = process.env.LISTO_ORIGIN; process.env.LISTO_ORIGIN = "http://localhost:3000";
  t.after(() => { if (previous === undefined) delete process.env.LISTO_ORIGIN; else process.env.LISTO_ORIGIN = previous; });
  for (const req of [
    request("http://jdsrv.local:3000", "https://evil.example"),
    request("http://jdsrv.local:3000", "http://localhost:3000"),
    request("http://evil.example:3000"),
    request("http://jdsrv.local:3001"),
    request("http://localhost:3000", "null"),
    request("http://localhost:3000", "https://evil.example", { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" }),
    new Request("http://localhost:3000/api/auth/login", { method: "POST" }),
  ]) assert.throws(() => sameOrigin(req), /Invalid request origin/);
});

test("HTTPS deployments retain their canonical origin and Secure cookie requirement", t => {
  const previous = process.env.LISTO_ORIGIN; process.env.LISTO_ORIGIN = "https://lists.example";
  t.after(() => { if (previous === undefined) delete process.env.LISTO_ORIGIN; else process.env.LISTO_ORIGIN = previous; });
  const req = request("https://lists.example");
  assert.doesNotThrow(() => sameOrigin(req));
  assert.match(sessionCookie("token", false, req), /; Secure/);
  assert.throws(() => sameOrigin(request("http://lists.example")));
  assert.throws(() => sameOrigin(request("http://localhost:3000")));
  process.env.LISTO_ORIGIN = "http://jdsrv.local:3000";
  assert.equal(origin(), "http://jdsrv.local:3000");
});
