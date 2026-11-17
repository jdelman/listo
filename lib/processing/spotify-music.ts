import { decodeHTML } from "entities";
import { spotifyMusic } from "../spotify";
import type { ThumbnailStorage } from "../storage/thumbnail-storage";
import type { Item, ItemMetadata } from "../types";
import { spotifyAccessToken } from "./spotify-auth";
import { storeThumbnail } from "./thumbnails";

type CatalogItem = {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album?: Release;
} & Release;

type Release = {
  name: string;
  images?: { url: string }[];
  release_date?: string;
  genres?: string[];
};

type AppleResult = {
  artistName?: string;
  trackName?: string;
  collectionName?: string;
  trackViewUrl?: string;
  collectionViewUrl?: string;
  primaryGenreName?: string;
};

type YouTubeResult = { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } };

const normalize = (value = "") => decodeHTML(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
type MusicEnrichment = NonNullable<ItemMetadata["derived"]> & { specs: Partial<ItemMetadata> };

const spotifyId = /^[A-Za-z0-9]{22}$/;

export async function enrichSpotifyMusic(
  item: Item,
  { request, storage, signal, accessToken, youtubeKey }: {
    request: typeof fetch; storage: ThumbnailStorage; signal: AbortSignal; accessToken?: string; youtubeKey?: string;
  },
): Promise<MusicEnrichment | undefined> {
  const source = spotifyMusic(item.sourceUrl) || spotifyMusic(item.metadata.url) || spotifyMusic(item.metadata.spotifyUrl);
  const kind = item.type === "album" || item.type === "track" ? item.type : source?.kind;
  if (!kind) return;
  if (source && source.kind !== kind) throw new Error(`This Spotify link points to a ${source.kind}. Save it as a ${source.kind} to enrich it.`);

  const timeout = () => AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  const token = accessToken ?? await spotifyAccessToken(request, timeout());
  const get = async <T>(path: string): Promise<T> => {
    const response = await request(`https://api.spotify.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: timeout(), redirect: "error",
    });
    if (!response.ok) throw new Error(`Spotify catalog returned HTTP ${response.status}`);
    return response.json() as Promise<T>;
  };
  const optional = async <T>(lookup: () => Promise<T>) => {
    try { return await lookup(); }
    catch { signal.throwIfAborted(); return undefined; }
  };
  const sourceId = await (async () => {
    if (source) return source.id;
    const params = new URLSearchParams({ q: item.title, type: kind, limit: "10", market: "US" });
    const results = await get<Partial<Record<"albums" | "tracks", { items: CatalogItem[] }>>>(`search?${params}`);
    const matches = results[kind === "album" ? "albums" : "tracks"]?.items.filter((entry) => {
      const title = normalize(item.title);
      return title === normalize(entry.name) || entry.artists.some(({ name }) =>
        title === normalize(`${entry.name} ${name}`) || title === normalize(`${name} ${entry.name}`));
    }) ?? [];
    const identities = new Set(matches.map((entry) => JSON.stringify([normalize(entry.name), entry.artists.map(({ name }) => normalize(name))])));
    if (identities.size !== 1 || !spotifyId.test(matches[0].id)) {
      throw new Error(`Could not identify the Spotify ${kind}. Use a Spotify link or include the artist in the title.`);
    }
    return matches[0].id;
  })();

  const result = await get<CatalogItem>(`${kind}s/${sourceId}?market=US`);
  if (!result.name || !Array.isArray(result.artists)) throw new Error("Spotify returned incomplete music metadata");
  const spotifyUrl = `https://open.spotify.com/${kind}/${sourceId}`;
  const release = kind === "album" ? result : result.album;
  const artists = result.artists.map(({ name }) => name).filter(Boolean);
  const artist = artists.join(", ");
  const yearText = release?.release_date?.match(/^\d{4}/)?.[0];
  const year = yearText ? Number(yearText) : undefined;
  const query = [result.name, artists[0]].filter(Boolean).join(" ");

  const [thumbnailUrl, artistGenres, apple, youtubeUrl] = await Promise.all([
    optional(async () => {
      for (const { url } of release?.images ?? []) {
        const image = URL.parse(url);
        if (image?.origin !== "https://i.scdn.co") continue;
        const saved = await optional(() => storeThumbnail(url, storage, request, signal));
        if (saved) return saved;
      }
    }),
    Promise.all([...new Set(result.artists.map(({ id }) => id).filter((id) => spotifyId.test(id)))].slice(0, 3).map((id) =>
      optional(() => get<{ genres?: string[] }>(`artists/${id}`)))),
    optional(async () => {
      const params = new URLSearchParams({ term: query, country: "US", media: "music", entity: kind === "album" ? "album" : "song", limit: "25" });
      const response = await request(`https://itunes.apple.com/search?${params}`, { signal: timeout(), redirect: "error" });
      if (!response.ok) return;
      const data = await response.json() as { results?: AppleResult[] };
      return data.results?.find((entry) => normalize(kind === "album" ? entry.collectionName : entry.trackName) === normalize(result.name)
        && artists.some((name) => normalize(name) === normalize(entry.artistName)));
    }),
    kind === "track" && youtubeKey ? optional(async () => {
      const params = new URLSearchParams({ key: youtubeKey, q: query, type: "video", part: "snippet", videoCategoryId: "10", maxResults: "5" });
      const response = await request(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal: timeout(), redirect: "error" });
      if (!response.ok) return;
      const data = await response.json() as { items?: YouTubeResult[] };
      const match = data.items?.find(({ id, snippet }) =>
        /^[\w-]{11}$/.test(id?.videoId ?? "") && normalize(snippet?.title).includes(normalize(result.name))
        && artists.some((name) => normalize(snippet?.channelTitle).includes(normalize(name))));
      if (match?.id?.videoId) return `https://www.youtube.com/watch?v=${match.id.videoId}`;
    }) : undefined,
  ]);

  const appleUrl = URL.parse((kind === "album" ? apple?.collectionViewUrl : apple?.trackViewUrl) ?? "");
  const appleMusicUrl = appleUrl && ["https://music.apple.com", "https://itunes.apple.com"].includes(appleUrl.origin)
    ? `https://music.apple.com${appleUrl.pathname}${appleUrl.search}` : undefined;
  const genres = [...(release?.genres ?? []), ...artistGenres.flatMap((entry) => entry?.genres ?? [])];
  if (!genres.length && apple?.primaryGenreName && apple.primaryGenreName !== "Music") genres.push(apple.primaryGenreName);
  const tags = [...new Set(genres.map((genre) => genre.trim()).filter((genre) => genre && genre.length <= 100))];
  const details = [artist ? `${kind === "album" ? "Album" : "Track"} by ${artist}` : undefined,
    kind === "track" && release?.name ? `from ${release.name}` : undefined,
    year ? `released in ${year}` : undefined].filter(Boolean);
  const summary = item.description.trim() || (details.length ? `${details.join(", ")}.` : result.name);
  return {
    title: result.name, summary, category: kind, tags,
    specs: {
      spotifyUrl, appleMusicUrl, youtubeUrl, thumbnailUrl: thumbnailUrl ?? item.metadata.thumbnailUrl, year,
      artist, artists, platform: "spotify", platformId: sourceId, trackName: kind === "track" ? result.name : undefined,
    },
    attributes: {}, processedAt: new Date().toISOString(), processorVersion: "spotify:v1",
  };
}
