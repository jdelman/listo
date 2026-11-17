import assert from "node:assert/strict";
import test from "node:test";
import { commandSchema } from "../lib/backend/command-schema";
import { LEGACY_USER_ID } from "../lib/backend/sqlite/accounts-migration";
import { openListoDatabase } from "../lib/backend/sqlite/database";
import { SQLiteBackend } from "../lib/backend/sqlite/sqlite-backend";
import { classify } from "../lib/capture";
import { ItemEnrichmentProcessor } from "../lib/processing/item-processor";
import { runOne } from "../worker/runner";

const id = "1234567890123456789012";
const artistId = "1234567890123456789013";
const image = "https://i.scdn.co/image/cover";
const release = { name: "Record", release_date: "2002-01", images: [{ url: image }] };
const artists = [{ id: artistId, name: "The Band" }];
const availability = { external: false, localReference: false, imported: false };

for (const kind of ["album", "track"] as const) {
  test(`uses a saved Spotify ${kind} link instead of searching the title`, async () => {
    const processor = new ItemEnrichmentProcessor({
      spotifyAccessToken: "fake",
      fetch: async (input) => {
        const { hostname, pathname } = new URL(String(input));
        assert.notEqual(pathname, "/v1/search");
        if (pathname === `/v1/${kind}s/${id}`) return Response.json({ ...release, id, artists, album: release });
        if (hostname === "api.spotify.com" || hostname === "itunes.apple.com" || hostname === "i.scdn.co") return new Response(null, { status: 503 });
        throw new Error(`Unexpected request to ${hostname}${pathname}`);
      },
    });
    const result = await processor.process({
      id, type: kind, title: "The Band - Record", description: "", tags: [],
      sourceUrl: "https://example.com/review",
      metadata: { url: "https://example.com/review", spotifyUrl: `https://open.spotify.com/intl-es/${kind}/${id}?si=share` },
      availability, createdAt: "", updatedAt: "", revision: 1,
    }, new AbortController().signal);
    assert.equal(result.category, kind);
    assert.equal(result.specs.spotifyUrl, `https://open.spotify.com/${kind}/${id}`);
    assert.equal(result.specs.artist, "The Band");
  });
}

test("recognizes Spotify share links and enriches a queued track without OpenRouter", async () => {
  const url = `https://open.spotify.com/intl-es/track/${id}?si=share`;
  const type = classify(url);
  assert.equal(type, "track");
  assert.equal(classify(url.replace("/track/", "/album/")), "album");
  assert.equal(classify(url.replace("spotify.com", "spotify.com.example")), "url");
  const command = commandSchema.parse({ type: "createItem", listIds: ["inbox"], item: {
    id: "song", type, title: "open.spotify.com", description: "My description",
    tags: ["Favorite", "Indie Rock"], sourceUrl: url, availability: { ...availability, external: true }, metadata: {},
  } });
  assert.equal(command.type, "createItem");
  if (command.type !== "createItem") return;
  const db = openListoDatabase(":memory:");
  try {
    const backend = new SQLiteBackend(db, LEGACY_USER_ID);
    backend.createItem({ ...command.item, type }, command.listIds);
    const processor = new ItemEnrichmentProcessor({
      apiKey: "", spotifyAccessToken: "fake", youtubeApiKey: "fake",
      storage: { put: async (bytes, extension) => {
        assert.equal(extension, "png");
        assert.ok(bytes.length);
        return "/thumbnails/cover.png";
      } },
      fetch: async (input, init) => {
        const address = new URL(String(input));
        if (address.hostname === "api.spotify.com") assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fake");
        if (address.pathname === `/v1/tracks/${id}`) return Response.json({ id, name: "Song", artists, album: release });
        if (address.pathname === `/v1/artists/${artistId}`) return Response.json({ genres: ["indie rock", "dream pop"] });
        if (address.href === image) return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
        if (address.hostname === "itunes.apple.com") return Response.json({ results: [
          { trackName: "Song", artistName: "Another artist", trackViewUrl: "https://music.apple.com/us/album/wrong/1?i=2" },
          { trackName: "Song", artistName: "The Band", trackViewUrl: "https://music.apple.com/us/album/record/3?i=4" },
        ] });
        if (address.hostname === "www.googleapis.com") return Response.json({ items: [
          { id: { videoId: "abcdefghijk" }, snippet: { title: "Song", channelTitle: "The Band - Topic" } },
        ] });
        throw new Error(`Unexpected request to ${address.origin}${address.pathname}`);
      },
    });
    await runOne({ queue: backend, store: backend, workerId: "test", processors: [processor] });
    assert.equal(backend.getDatabase().jobs[0].status, "completed");
    const item = backend.getItem("song")!;
    assert.equal(item.title, "Song");
    assert.equal(item.metadata.title, "Song");
    assert.equal(item.metadata.artist, "The Band");
    assert.equal(item.description, "My description");
    assert.equal(item.metadata.year, 2002);
    assert.equal(item.metadata.thumbnailUrl, "/thumbnails/cover.png");
    assert.equal(item.metadata.spotifyUrl, `https://open.spotify.com/track/${id}`);
    assert.equal(item.metadata.appleMusicUrl, "https://music.apple.com/us/album/record/3?i=4");
    assert.equal(item.metadata.youtubeUrl, "https://www.youtube.com/watch?v=abcdefghijk");
    assert.deepEqual(item.tags, ["Favorite", "Indie Rock", "dream pop"]);
  } finally { db.close(); }
});

test("looks up a named album and completes when optional data is unavailable", async () => {
  const processor = new ItemEnrichmentProcessor({
    spotifyAccessToken: "fake", youtubeApiKey: "fake",
    fetch: async (input) => {
      const { hostname, pathname, searchParams } = new URL(String(input));
      if (pathname === "/v1/search") {
        assert.equal(searchParams.get("type"), "album");
        return Response.json({ albums: { items: [{ ...release, id, artists }] } });
      }
      if (pathname === `/v1/albums/${id}`) return Response.json({ ...release, id, artists });
      assert.notEqual(hostname, "www.googleapis.com");
      return new Response(null, { status: 503 });
    },
  });
  const result = await processor.process({
    id, type: "album", title: "The Band - Record", description: "", tags: [], metadata: {},
    availability, createdAt: "", updatedAt: "", revision: 1,
  }, new AbortController().signal);
  assert.equal(result.category, "album");
  assert.equal(result.specs.title, "Record");
  assert.equal(result.specs.artist, "The Band");
  assert.equal(result.summary, "Album by The Band, released in 2002.");
  assert.equal(result.specs.spotifyUrl, `https://open.spotify.com/album/${id}`);
  assert.equal(result.specs.youtubeUrl, undefined);
});
