import { decodeHTML } from "entities";
import type { ClaimedJob } from "../backend/contracts";
import type { Item, List } from "../types";
import { spotifyPlaylistId } from "../spotify";
import { FileThumbnailStorage, type ThumbnailStorage } from "../storage/thumbnail-storage";
import { storeThumbnail } from "./thumbnails";
import type { JobProcessor } from "./contracts";

type Track = { id: string; type: string; name: string; is_local?: boolean; artists: { name: string }[]; album?: { images?: { url: string }[] } };
type Page = { items: { track?: Track | null; item?: Track | null; is_local?: boolean }[]; next: string | null; total: number };
type Playlist = { name: string; description: string; images?: { url: string }[]; snapshot_id: string };
interface ImportStore { getItem(id: string): Item | null; saveSpotifyImport(job: ClaimedJob, list: List, track?: Item, position?: number): void }

export class SpotifyPlaylistProcessor implements JobProcessor {
  readonly kind = "import-spotify-playlist" as const;
  constructor(private readonly store: ImportStore, private readonly options: { fetch?: typeof fetch; accessToken?: string; storage?: ThumbnailStorage } = {}) {}

  async process(item: Item, signal: AbortSignal, job?: ClaimedJob) {
    if (!job) throw new Error("Spotify imports require a claimed worker job");
    const id = spotifyPlaylistId(item.sourceUrl || item.metadata.url || item.metadata.markdown || "");
    if (!id) throw new Error("Invalid Spotify playlist URL");
    const request = this.options.fetch ?? fetch;
    // Bound an attempt below the queue lease; subsequent attempts resume stored positions.
    signal = AbortSignal.any([signal, AbortSignal.timeout(240_000)]);
    const token = await this.accessToken(request, signal);
    const get = async <T>(url: string): Promise<T> => {
      const parsed = new URL(url);
      if (parsed.origin !== "https://api.spotify.com" || !parsed.pathname.startsWith(`/v1/playlists/${id}`)) throw new Error("Invalid Spotify pagination URL");
      const response = await request(url, { headers: { Authorization: `Bearer ${token}` }, signal, redirect: "error" });
      if (!response.ok) throw new Error(`Spotify returned HTTP ${response.status}. ${response.status === 401 || response.status === 403 ? "Check Spotify authorization and playlist access." : "The worker will retry the import."}`);
      return response.json() as Promise<T>;
    };
    const base = `https://api.spotify.com/v1/playlists/${id}`;
    const playlist = await get<Playlist>(base);
    if (typeof playlist.name !== "string" || !playlist.snapshot_id) throw new Error("Spotify returned incomplete playlist metadata");
    const sourceUrl = `https://open.spotify.com/playlist/${id}`;
    const timestamp = new Date().toISOString();
    const list: List = {
      id: `spotify-${item.id}`, title: playlist.name,
      description: decodeHTML((playlist.description || "").replace(/<[^>]*>/g, "")), tags: [], defaultView: "playlist",
      createdAt: timestamp, updatedAt: timestamp,
      metadata: { sourceUrl, spotifyPlaylistId: id, spotifySnapshotId: playlist.snapshot_id, thumbnailUrl: await this.thumbnail(playlist.images, sourceUrl, request, signal) },
    };
    this.store.saveSpotifyImport(job, list);
    let next: string | null = `${base}/items?limit=50`;
    let position = 0;
    let imported = 0;
    let skipped = 0;
    const visited = new Set<string>();
    while (next) {
      signal.throwIfAborted();
      if (visited.has(next)) throw new Error("Spotify returned repeated pagination");
      visited.add(next);
      const page: Page = await get<Page>(next);
      if (!Array.isArray(page.items) || !(page.next === null || typeof page.next === "string")) throw new Error("Spotify returned incomplete playlist items");
      for (const entry of page.items) {
        const track = entry?.item ?? entry?.track;
        const index = position++;
        if (!track || entry.is_local || track.is_local || track.type !== "track" || !/^[A-Za-z0-9]{22}$/.test(track.id)) { skipped++; continue; }
        const url = `https://open.spotify.com/track/${track.id}`;
        const artists = track.artists.map((artist) => artist.name);
        const trackItemId = `${list.id}-${index}`;
        if (this.store.getItem(trackItemId)) {
          this.store.saveSpotifyImport(job, list);
          imported++;
          continue;
        }
        const thumbnailUrl = await this.thumbnail(track.album?.images, url, request, signal);
        signal.throwIfAborted();
        this.store.saveSpotifyImport(job, list, {
          id: trackItemId, type: "media", title: track.name, description: artists.join(", "), tags: [], sourceUrl: url,
          availability: { external: true, localReference: Boolean(thumbnailUrl?.startsWith("/thumbnails/")), imported: true },
          createdAt: timestamp, updatedAt: timestamp, revision: 1,
          metadata: { trackName: track.name, artist: artists.join(", "), artists, spotifyUrl: url, url, platform: "spotify", platformId: track.id, thumbnailUrl },
        }, index);
        imported++;
      }
      next = page.next;
    }
    const latest = await get<Playlist>(base);
    if (latest.snapshot_id !== playlist.snapshot_id) throw new Error("Spotify playlist changed during import; paste the playlist again for a fresh import");
    return { summary: `Imported ${imported} tracks from ${playlist.name}.${skipped ? ` Skipped ${skipped} unavailable, local, or non-track entries.` : ""}`, category: "media" as const,
      specs: { platform: "spotify" as const, platformId: id, importedListId: list.id, thumbnailUrl: list.metadata?.thumbnailUrl },
      attributes: { imported, skipped }, processedAt: new Date().toISOString(), processorVersion: "spotify-playlist:v1" };
  }

  private async accessToken(request: typeof fetch, signal: AbortSignal) {
    if (this.options.accessToken) return this.options.accessToken;
    const { SPOTIFY_CLIENT_ID: clientId, SPOTIFY_CLIENT_SECRET: clientSecret, SPOTIFY_REFRESH_TOKEN: refreshToken, SPOTIFY_ACCESS_TOKEN: accessToken } = process.env;
    if (!refreshToken) {
      if (accessToken) return accessToken;
      throw new Error("Configure SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and SPOTIFY_REFRESH_TOKEN (or SPOTIFY_ACCESS_TOKEN) to import playlists");
    }
    if (!clientId || !clientSecret) throw new Error("Spotify token refresh requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET");
    const response = await request("https://accounts.spotify.com/api/token", { method: "POST", signal, redirect: "error",
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }) });
    if (!response.ok) throw new Error(`Spotify token refresh failed (HTTP ${response.status}); check Spotify credentials`);
    const data = await response.json() as { access_token?: string };
    if (!data.access_token) throw new Error("Spotify did not return an access token");
    return data.access_token;
  }

  private async thumbnail(images: { url: string }[] | undefined, sourceUrl: string, request: typeof fetch, signal: AbortSignal) {
    const direct = images?.find(({ url }) => /^https:\/\//.test(url))?.url;
    if (direct) return direct;
    // oEmbed can provide artwork when the track's album images are absent. Cache that fallback locally.
    try {
      const response = await request(`https://open.spotify.com/oembed?url=${encodeURIComponent(sourceUrl)}`, { signal, redirect: "error" });
      if (!response.ok) return undefined;
      const data = await response.json() as { thumbnail_url?: string };
      if (data.thumbnail_url) return await storeThumbnail(data.thumbnail_url, this.options.storage ?? new FileThumbnailStorage(), request, signal);
    } catch { signal.throwIfAborted(); }
    return undefined;
  }
}
