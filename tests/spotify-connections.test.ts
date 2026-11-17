import assert from "node:assert/strict";
import { statSync } from "node:fs";
import test from "node:test";
import { GET, POST } from "../app/api/spotify/[action]/route";
import { digest, secret } from "../lib/auth/accounts";
import { SpotifyConnections } from "../lib/auth/spotify-connections";
import { LEGACY_USER_ID } from "../lib/backend/sqlite/accounts-migration";
import { SQLiteBackend } from "../lib/backend/sqlite/sqlite-backend";
import { SpotifyPlaylistProcessor } from "../lib/processing/spotify-playlist";
import { runOne } from "../worker/runner";
import { accountFixture } from "./account-fixture";

const browser = "http://localhost:3000";
const callback = "http://127.0.0.1:3000/api/spotify/callback";
const context = (action: string) => ({ params: Promise.resolve({ action }) });
const sessionCookie = (token: string) => `listo_session=${token}`;

test("Spotify consent returns to the initiating session and encrypts per-user playlist credentials", async (t) => {
  const f = accountFixture();
  t.after(() => f.close());
  for (const [key, value] of Object.entries({ SPOTIFY_CLIENT_ID: "test-client", SPOTIFY_CLIENT_SECRET: "test-secret" })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const user = await f.accounts.create("spotify-user", "a secure test password");
  const token = secret();
  f.db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(digest(token), user.id, Date.now() + 60_000);
  const cookie = sessionCookie(token);
  const post = (action: string, origin = browser) => POST(new Request(`${browser}/api/spotify/${action}`, {
    method: "POST", headers: { origin, cookie },
  }), context(action));
  assert.equal((await post("connect", "https://untrusted.test")).status, 403);
  const begin = await post("connect");
  assert.equal(begin.status, 303);
  const consent = new URL(begin.headers.get("location")!);
  assert.equal(consent.origin, "https://accounts.spotify.com");
  assert.equal(consent.searchParams.get("redirect_uri"), callback);
  assert.equal(consent.searchParams.get("scope"), "playlist-read-private playlist-read-collaborative");
  const state = consent.searchParams.get("state")!;
  const receive = (url: string) => GET(new Request(url), context("callback"));
  assert.equal((await receive(`${browser}/api/spotify/callback?state=${state}&code=authorization-code`)).headers.get("location"), "/profile?spotify=invalid");
  const accepted = await receive(`${callback}?state=${state}&code=authorization-code`);
  const finish = accepted.headers.get("location")!;
  assert.equal(new URL(finish).origin, browser);
  assert.ok(!finish.includes("authorization-code"));
  assert.doesNotMatch(JSON.stringify(f.db.prepare("SELECT * FROM spotify_authorizations").all()), /authorization-code/);
  const finishWith = (session: string) => GET(new Request(finish, { headers: { cookie: session } }), context("finish"));
  assert.equal((await finishWith(f.cookie)).headers.get("location"), "/profile?spotify=invalid");

  const exchange = t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    assert.equal(input, "https://accounts.spotify.com/api/token");
    const body = new URLSearchParams(String(init.body));
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), "authorization-code");
    assert.equal(body.get("redirect_uri"), callback);
    return Response.json({ access_token: "user-access", refresh_token: "user-refresh", expires_in: 3600 });
  });
  assert.equal((await finishWith(cookie)).headers.get("location"), "/profile?spotify=connected");
  assert.equal((await finishWith(cookie)).headers.get("location"), "/profile?spotify=invalid");
  assert.equal(exchange.mock.callCount(), 1);

  const connections = new SpotifyConnections(f.db);
  assert.equal(connections.connected(user.id), true);
  assert.equal(connections.connected(LEGACY_USER_ID), false);
  assert.doesNotMatch(JSON.stringify(f.db.prepare("SELECT * FROM spotify_connections").all()), /user-access|user-refresh/);
  assert.equal(statSync(`${f.db.name}.spotify-key`).mode & 0o777, 0o600);

  f.db.prepare("UPDATE spotify_connections SET expires_at=0 WHERE user_id=?").run(user.id);
  const backend = new SQLiteBackend(f.db, user.id);
  const queue = new SQLiteBackend(f.db, null);
  const url = "https://open.spotify.com/playlist/1234567890123456789012";
  backend.createItem({ id: "playlist", type: "url", sourceUrl: url, title: "Playlist", description: "",
    tags: [], metadata: {}, availability: { external: true, localReference: false, imported: false } }, ["inbox"]);
  const processor = new SpotifyPlaylistProcessor(queue, { fetch: async (input, init) => {
    const address = new URL(String(input));
    if (address.host === "accounts.spotify.com") {
      assert.equal(String(init?.body), "grant_type=refresh_token&refresh_token=user-refresh");
      return Response.json({ access_token: "refreshed-access", expires_in: 3600 });
    }
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer refreshed-access");
    return address.pathname.endsWith("/items") ? Response.json({ items: [], total: 0, next: null })
      : Response.json({ name: "My playlist", description: "", snapshot_id: "snapshot" });
  } });
  await runOne({ queue, store: queue, processors: [processor], workerId: "spotify-test" });
  assert.equal(backend.getDatabase().jobs[0].status, "completed");
  assert.ok(backend.getDatabase().lists.some((list) => list.title === "My playlist"));
  assert.equal(await connections.accessToken(user.id, fetch, AbortSignal.timeout(1000)), "refreshed-access");

  assert.equal((await post("disconnect")).headers.get("location"), "/profile?spotify=disconnected");
  assert.equal(connections.connected(user.id), false);
  assert.equal(await connections.accessToken(user.id, fetch, AbortSignal.timeout(1000)), undefined);
});
