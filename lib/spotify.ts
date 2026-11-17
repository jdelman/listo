/** Recognize only actual Spotify playlist URLs, including localized share links. */
export function spotifyPlaylistId(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "open.spotify.com" || url.username || url.password || url.port) return;
    return url.pathname.match(/^\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]{22})\/?$/)?.[1];
  } catch { return; }
}

export function spotifyMusic(value?: string) {
  const url = value ? URL.parse(value.trim()) : null;
  if (!url || !["http:", "https:"].includes(url.protocol) || url.hostname !== "open.spotify.com" || url.username || url.password || url.port) return;
  const match = url.pathname.match(/^\/(?:intl-[a-z-]+\/)?(album|track)\/([A-Za-z0-9]{22})\/?$/);
  if (!match) return;
  const kind = match[1] === "album" ? "album" : "track";
  return { kind, id: match[2], url: `https://open.spotify.com/${kind}/${match[2]}` } as const;
}

export function spotifyMusicUrl(value?: string, kind?: "album" | "track"): string | undefined {
  const music = spotifyMusic(value);
  if (music && (!kind || music.kind === kind)) return music.url;
}
