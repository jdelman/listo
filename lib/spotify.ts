/** Recognize only actual Spotify playlist URLs, including localized share links. */
export function spotifyPlaylistId(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname !== "open.spotify.com" || url.username || url.password || url.port) return;
    return url.pathname.match(/^\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]{22})\/?$/)?.[1];
  } catch { return; }
}
