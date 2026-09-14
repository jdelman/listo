import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openListoDatabase } from "../lib/backend/sqlite/database";
import { SQLiteBackend } from "../lib/backend/sqlite/sqlite-backend";
import { spotifyPlaylistId } from "../lib/spotify";
import { SpotifyPlaylistProcessor } from "../lib/processing/spotify-playlist";
import { runOne } from "../worker/runner";

const id = "1234567890123456789012";
const url = `https://open.spotify.com/playlist/${id}?si=share`;
const image = "https://i.scdn.co/image/cover";
const track = { id, type: "track", name: "Song", artists: [{ name: "Artist one" }, { name: "Artist two" }], album: { images: [{ url: image }] } };
const playlist = { name: "Favorites", description: "Some <b>songs</b> &amp; more", images: [{ url: image }], snapshot_id: "one" };
const json = (data: unknown) => Response.json(data);
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "listo-spotify-"));
  const db = openListoDatabase(join(directory, "test.sqlite"));
  const backend = new SQLiteBackend(db);
  const job = backend.createItem({ id: "source", type: "url", title: url, description: "", tags: [], sourceUrl: url, metadata: {}, availability: { external: true, imported: false, localReference: false } }, ["inbox"]);
  return { backend, db, job, close() { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("recognizes Spotify playlist share URLs without accepting lookalike hosts or tracks", () => {
  assert.equal(spotifyPlaylistId(` ${url} `), id);
  assert.equal(spotifyPlaylistId(`https://open.spotify.com/intl-es/playlist/${id}/`), id);
  for (const value of [url.replace("open.spotify.com", "open.spotify.com.evil.test"), url.replace("playlist", "track"), "https://open.spotify.com/playlist/nope", url.replace("https", "http"), url.replace("open.spotify.com", "user@open.spotify.com")]) assert.equal(spotifyPlaylistId(value), undefined);
});

test("imports paginated tracks in order, preserves repeated songs, metadata and direct thumbnails", async () => {
  const f = fixture();
  try {
    assert.equal(f.job.kind, "import-spotify-playlist");
    const requests: string[] = [];
    const processor = new SpotifyPlaylistProcessor(f.backend, { accessToken: "fake", fetch: async (input, init) => {
      const address = String(input); requests.push(address);
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer fake");
      if (address.includes("offset=50")) return json({ items: [{ item: track }, { item: null }, { item: { ...track, type: "episode" } }], next: null, total: 4 });
      if (address.includes("/items?")) return json({ items: [{ item: track }], next: `https://api.spotify.com/v1/playlists/${id}/items?offset=50`, total: 4 });
      return json(playlist);
    } });
    await runOne({ queue: f.backend, store: f.backend, workerId: "test", processors: [processor] });
    const state = f.backend.getDatabase();
    assert.equal(state.jobs[0].status, "completed");
    assert.equal(state.jobs.length, 1, "Imported tracks must not be sent to AI enrichment");
    const list = state.lists.find((list) => list.id === "spotify-source")!;
    assert.equal(list.title, "Favorites");
    assert.equal(list.description, "Some songs & more");
    assert.equal(list.metadata?.thumbnailUrl, image);
    assert.equal(list.defaultView, "playlist");
    const entries = state.listItems.filter((entry) => entry.listId === list.id);
    assert.deepEqual(entries.map((entry) => entry.position), [0, 1]);
    for (const entry of entries) {
      const item = state.items.find((item) => item.id === entry.itemId)!;
      assert.equal(item.title, "Song");
      assert.deepEqual(item.metadata.artists, ["Artist one", "Artist two"]);
      assert.equal(item.metadata.spotifyUrl, `https://open.spotify.com/track/${id}`);
      assert.equal(item.metadata.thumbnailUrl, image);
    }
    assert.equal(requests.length, 4);
    assert.equal(f.backend.getItem("source")?.metadata.derived?.attributes.skipped, 2);
  } finally { f.close(); }
});

test("a failed page retries without duplicating previously imported tracks", async () => {
  const f = fixture(); let fail = true;
  try {
    const processor = new SpotifyPlaylistProcessor(f.backend, { accessToken: "fake", fetch: async (input) => {
      const address = String(input);
      if (address.includes("offset=50")) return fail ? new Response(null, { status: 429 }) : json({ items: [{ track }], next: null, total: 2 });
      if (address.includes("/items?")) return json({ items: [{ track }], next: `https://api.spotify.com/v1/playlists/${id}/items?offset=50`, total: 2 });
      return json(playlist);
    } });
    const dependencies = { queue: f.backend, store: f.backend, workerId: "test", processors: [processor] };
    await runOne(dependencies);
    assert.equal(f.backend.getDatabase().jobs[0].status, "queued");
    assert.equal(f.backend.getDatabase().items.length, 2);
    fail = false;
    f.db.prepare("UPDATE jobs SET run_at = ?").run(new Date(0).toISOString());
    await runOne(dependencies);
    assert.equal(f.backend.getDatabase().jobs[0].status, "completed");
    assert.equal(f.backend.getDatabase().items.length, 3);
  } finally { f.close(); }
});

test("missing album image downloads oEmbed fallback into thumbnail storage", async () => {
  const f = fixture(); let saved = 0;
  try {
    const processor = new SpotifyPlaylistProcessor(f.backend, { accessToken: "fake", storage: { put: async (bytes, extension) => { saved++; assert.equal(extension, "png"); assert.ok(bytes.length); return "/thumbnails/fallback.png"; } }, fetch: async (input) => {
      const address = String(input);
      if (address.includes("/oembed?")) return json({ thumbnail_url: image });
      if (address === image) return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      if (address.includes("/items?")) return json({ items: [{ item: { ...track, album: { images: [] } } }], next: null, total: 1 });
      return json(playlist);
    } });
    await runOne({ queue: f.backend, store: f.backend, workerId: "test", processors: [processor] });
    assert.equal(f.backend.getDatabase().jobs[0].status, "completed");
    assert.equal(saved, 1);
    assert.equal(f.backend.getItem("spotify-source-0")?.metadata.thumbnailUrl, "/thumbnails/fallback.png");
  } finally { f.close(); }
});

test("expired lease cannot write tracks and changed source revisions cannot create lists", () => {
  const f = fixture();
  try {
    const job = f.backend.claim("worker", 300000)!;
    const list = { id: "spotify-source", title: "Test", description: "", tags: [], defaultView: "playlist" as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    f.backend.updateItem("source", { title: "Edited" });
    assert.throws(() => f.backend.saveSpotifyImport(job, list), /changed/);
    f.backend.fail(job.id, job.lockToken, "retry");
    assert.throws(() => f.backend.saveSpotifyImport(job, list), /changed/);
    assert.equal(f.backend.getDatabase().lists.length, 1);
  } finally { f.close(); }
});

test("rejects pagination to another host without leaking the access token", async () => {
  const f = fixture();
  try {
    const processor = new SpotifyPlaylistProcessor(f.backend, { accessToken: "fake", fetch: async (input) => {
      assert.ok(String(input).startsWith("https://api.spotify.com/"));
      return String(input).includes("/items?") ? json({ items: [], next: "https://evil.test/", total: 1 }) : json(playlist);
    } });
    await runOne({ queue: f.backend, store: f.backend, workerId: "test", processors: [processor] });
    assert.match(f.backend.getDatabase().jobs[0].lastError || "", /pagination URL/);
  } finally { f.close(); }
});

test("refreshes configured user credentials without exposing them in saved data", async () => {
  const f = fixture();
  const keys = ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET", "SPOTIFY_REFRESH_TOKEN", "SPOTIFY_ACCESS_TOKEN"] as const;
  const previous = keys.map((key) => process.env[key]);
  try {
    process.env.SPOTIFY_CLIENT_ID = "client";
    process.env.SPOTIFY_CLIENT_SECRET = "secret";
    process.env.SPOTIFY_REFRESH_TOKEN = "refresh";
    let refreshed = false;
    const processor = new SpotifyPlaylistProcessor(f.backend, { fetch: async (input, init) => {
      if (String(input).includes("/api/token")) {
        refreshed = true;
        assert.equal(init?.method, "POST");
        assert.equal(String(init?.body), "grant_type=refresh_token&refresh_token=refresh");
        return json({ access_token: "fresh-token" });
      }
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer fresh-token");
      return String(input).includes("/items?") ? json({ items: [], next: null, total: 0 }) : json(playlist);
    } });
    await runOne({ queue: f.backend, store: f.backend, workerId: "test", processors: [processor] });
    assert.equal(refreshed, true);
    assert.equal(f.backend.getDatabase().jobs[0].status, "completed");
    assert.doesNotMatch(JSON.stringify(f.backend.getDatabase()), /fresh-token|secret|refresh/);
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    f.close();
  }
});

test("migrates existing lists and preserves playlist metadata through edits and database export", () => {
  const directory = mkdtempSync(join(tmpdir(), "listo-spotify-migration-"));
  const path = join(directory, "test.sqlite");
  let db = openListoDatabase(path);
  try {
    const backend = new SQLiteBackend(db);
    backend.updateList("inbox", { title: "My inbox" });
    // Reconstruct a version-1 database with real preexisting content.
    db.exec("ALTER TABLE lists DROP COLUMN metadata_json; DELETE FROM schema_migrations WHERE version = 2");
    db.close();
    db = openListoDatabase(path);
    const migrated = new SQLiteBackend(db);
    assert.equal(migrated.getDatabase().lists[0].title, "My inbox");
    assert.deepEqual(migrated.getDatabase().lists[0].metadata, {});
    migrated.updateList("inbox", { metadata: { thumbnailUrl: image, sourceUrl: url } });
    migrated.updateList("inbox", { title: "Still here" });
    assert.equal(migrated.getDatabase().lists[0].metadata?.thumbnailUrl, image);
    assert.equal((db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version, 2);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("a deleted list or changed playlist snapshot cannot be silently recreated or mixed", () => {
  const f = fixture();
  try {
    const job = f.backend.claim("worker", 300000)!;
    const list = { id: "spotify-source", title: "Test", description: "", tags: [], defaultView: "playlist" as const, metadata: { spotifySnapshotId: "one" }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    f.backend.saveSpotifyImport(job, list);
    assert.throws(() => f.backend.saveSpotifyImport(job, { ...list, metadata: { spotifySnapshotId: "two" } }), /playlist changed/);
    f.backend.deleteList(list.id);
    assert.throws(() => f.backend.saveSpotifyImport(job, list), /deleted/);
    assert.equal(f.backend.getDatabase().lists.length, 1);
  } finally { f.close(); }
});
