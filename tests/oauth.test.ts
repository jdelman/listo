import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthTokens, OAuthClientInformationMixed } from "@modelcontextprotocol/sdk/shared/auth.js";
import { accountFixture } from "./account-fixture";
import { OAuthService } from "../lib/auth/oauth";
import { LEGACY_USER_ID } from "../lib/backend/sqlite/accounts-migration";
import { secret, digest } from "../lib/auth/accounts";
import { POST as mcp } from "../app/mcp/route";
import { POST as oauth } from "../app/oauth/[action]/route";
import { GET as resource } from "../app/.well-known/oauth-protected-resource/route";
import { GET as metadata } from "../app/.well-known/oauth-authorization-server/route";
const issuer = "http://localhost:3000";
const headers = { "content-type": "application/x-www-form-urlencoded" };

async function authorize(service: OAuthService, userId = LEGACY_USER_ID, scope = "listo:read listo:write") {
  const client = service.register({ client_name: "Test client", redirect_uris: ["http://127.0.0.1:12345/callback"] });
  const verifier = secret();
  const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: "code", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"), resource: service.resource, scope, state: "state-test" });
  const callback = new URL(await service.authorize(params, { id: userId, username: "test" }, true));
  assert.equal(callback.searchParams.get("state"), "state-test");
  const exchange = new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, code: callback.searchParams.get("code")!, code_verifier: verifier, redirect_uri: client.redirect_uris[0], resource: service.resource });
  return { exchange, params, client };
}

test("OAuth binds codes to PKCE, redirect, resource and user; refresh reuse and revocation disable access", async () => {
  const f = accountFixture();
  try {
    const service = new OAuthService(issuer, f.accounts);
    const first = await authorize(service);
    const tokens = await service.token(first.exchange, headers) as OAuthTokens;
    assert.ok(tokens.access_token); assert.ok(tokens.refresh_token);
    assert.equal(service.access(tokens.access_token)?.userId, LEGACY_USER_ID);
    assert.equal(new OAuthService("https://different.example", f.accounts).access(tokens.access_token), null);
    await assert.rejects(service.token(first.exchange, headers));
    const refresh = new URLSearchParams({ grant_type: "refresh_token", client_id: first.client.client_id, refresh_token: tokens.refresh_token!, resource: service.resource });
    const updated = await service.token(refresh, headers) as OAuthTokens;
    assert.notEqual(updated.refresh_token, tokens.refresh_token);
    await assert.rejects(service.token(refresh, headers));
    assert.equal(service.access(updated.access_token), null);
    for (const [key, value] of [["code_verifier", "x".repeat(43)], ["redirect_uri", "https://evil.example/callback"], ["resource", "https://evil.example/mcp"]]) {
      const next = await authorize(service); next.exchange.set(key, value);
      await assert.rejects(service.token(next.exchange, headers));
    }
    const denied = await authorize(service);
    const denial = new URL(await service.authorize(denied.params, { id: LEGACY_USER_ID, username: "jdelman" }, false));
    assert.equal(denial.searchParams.get("error"), "access_denied");
    denied.params.set("code_challenge_method", "plain"); assert.throws(() => service.authorization(denied.params));
    const valid = await authorize(service); const last = await service.token(valid.exchange, headers) as OAuthTokens;
    service.revoke(last.refresh_token!, valid.client.client_id); assert.equal(service.access(last.access_token), null);
    const stored = JSON.stringify(f.db.prepare("SELECT * FROM oauth_tokens").all());
    assert.doesNotMatch(stored, new RegExp(tokens.access_token));
    const exp = await authorize(service); const expToken = await service.token(exp.exchange, headers) as OAuthTokens;
    f.db.prepare("UPDATE oauth_tokens SET access_expires=0 WHERE access_hash=?").run(digest(expToken.access_token)); assert.equal(service.access(expToken.access_token), null);
  } finally { f.close(); }
});

test("real MCP SDK client completes discovery, dynamic registration, PKCE, tool use, refresh and revocation", async () => {
  const f = accountFixture();
  const service = new OAuthService(issuer, f.accounts);
  let tokens: OAuthTokens | undefined, info: OAuthClientInformationMixed | undefined, verifier = "", authorization: URL | undefined;
  const provider: OAuthClientProvider = {
    redirectUrl: "http://127.0.0.1:12345/callback",
    clientMetadata: { client_name: "SDK integration", redirect_uris: ["http://127.0.0.1:12345/callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
    clientInformation: () => info, saveClientInformation: value => { info = value; },
    tokens: () => tokens, saveTokens: value => { tokens = value; },
    redirectToAuthorization: url => { authorization = url; },
    saveCodeVerifier: value => { verifier = value; }, codeVerifier: () => verifier,
  };
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init), path = new URL(request.url).pathname;
    if (path.startsWith("/.well-known/oauth-protected-resource")) return resource();
    if (path === "/.well-known/oauth-authorization-server") return metadata();
    if (path.startsWith("/oauth/")) return oauth(request, { params: Promise.resolve({ action: path.split("/").at(-1)! }) });
    if (path === "/mcp") return mcp(request);
    return new Response(null, { status: 404 });
  };
  const transport = new StreamableHTTPClientTransport(new URL(service.resource), { authProvider: provider, fetch: fetcher });
  const client = new Client({ name: "integration-test", version: "1" });
  try {
    await assert.rejects(client.connect(transport));
    assert.ok(authorization);
    const callback = new URL(await service.authorize(authorization.searchParams, { id: LEGACY_USER_ID, username: "jdelman" }, true));
    await transport.finishAuth(callback.searchParams.get("code")!);
    const connectedTransport = new StreamableHTTPClientTransport(new URL(service.resource), { authProvider: provider, fetch: fetcher });
    await client.connect(connectedTransport);
    assert.equal((await client.listTools()).tools.length, 3);
    const added = await client.callTool({ name: "add_item", arguments: { title: "Through OAuth" } });
    assert.ok(!added.isError);
    assert.equal(f.backend.getDatabase().items[0].title, "Through OAuth");
    const refresh = new URLSearchParams({ grant_type: "refresh_token", client_id: info!.client_id, refresh_token: tokens!.refresh_token!, resource: service.resource });
    tokens = await service.token(refresh, headers) as OAuthTokens;
    assert.ok(!(await client.callTool({ name: "list_lists", arguments: {} })).isError);
    service.revoke(tokens.access_token, info!.client_id);
    const rejected = await mcp(new Request(service.resource, { headers: { authorization: `Bearer ${tokens.access_token}` } }));
    assert.equal(rejected.status, 401);
  } finally { await client.close(); await transport.close(); f.close(); }
});

test("MCP scope and user boundaries apply to every authenticated HTTP request", async () => {
  const f = accountFixture();
  try {
    const other = await f.accounts.create("other", "other-test-password");
    f.backend.createItem({ id: "private", type: "note", title: "private", tags: [], description: "", metadata: {}, availability: { external: false, localReference: false, imported: false } }, ["inbox"]);
    const service = new OAuthService(issuer, f.accounts), auth = await authorize(service, other.id, "listo:read");
    const tokens = await service.token(auth.exchange, headers) as OAuthTokens;
    const request = (name: string, args: Record<string, unknown> = {}) => new Request(service.resource, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tokens.access_token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    assert.equal((await mcp(request("add_item", { title: "forbidden" }))).status, 403);
    const response = await mcp(request("get_list", { listId: "inbox" }));
    assert.equal(response.status, 200); assert.doesNotMatch(await response.text(), /private/);
    assert.equal((await mcp(new Request(service.resource, { headers: { cookie: f.cookie, "mcp-session-id": "forged" } }))).status, 401);
  } finally { f.close(); }
});
