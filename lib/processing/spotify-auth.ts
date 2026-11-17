export async function spotifyAccessToken(request: typeof fetch, signal: AbortSignal, { playlist = false } = {}) {
  const { SPOTIFY_CLIENT_ID: clientId, SPOTIFY_CLIENT_SECRET: clientSecret, SPOTIFY_REFRESH_TOKEN: refreshToken, SPOTIFY_ACCESS_TOKEN: accessToken } = process.env;
  if (!refreshToken && accessToken) return accessToken;
  if (!clientId || !clientSecret || (playlist && !refreshToken)) {
    throw new Error(playlist
      ? "Configure Spotify credentials with a refresh token or access token to import playlists"
      : "Configure Spotify credentials to look up albums and tracks");
  }
  const body = refreshToken
    ? new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken })
    : new URLSearchParams({ grant_type: "client_credentials" });
  const response = await request("https://accounts.spotify.com/api/token", {
    method: "POST", signal, redirect: "error", body,
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
  });
  if (!response.ok) throw new Error(`Spotify token request failed (HTTP ${response.status})`);
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Spotify did not return an access token");
  return data.access_token;
}
