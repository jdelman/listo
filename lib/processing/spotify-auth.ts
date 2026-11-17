type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number };

export function spotifyConfigured() {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

export async function requestSpotifyToken(body: URLSearchParams, request: typeof fetch, signal: AbortSignal) {
  const { SPOTIFY_CLIENT_ID: clientId, SPOTIFY_CLIENT_SECRET: clientSecret } = process.env;
  if (!clientId || !clientSecret) throw new Error("Spotify client credentials are missing");
  const response = await request("https://accounts.spotify.com/api/token", {
    method: "POST", signal, redirect: "error", body,
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` },
  });
  if (!response.ok) throw new Error(`Spotify token request failed (HTTP ${response.status})`);
  const data = await response.json() as TokenResponse;
  if (typeof data.access_token !== "string" || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
    throw new Error("Spotify returned an invalid access token");
  }
  return data;
}

export async function spotifyAccessToken(request: typeof fetch, signal: AbortSignal, { playlist = false } = {}) {
  const { SPOTIFY_REFRESH_TOKEN: refreshToken, SPOTIFY_ACCESS_TOKEN: accessToken } = process.env;
  if (!refreshToken && accessToken) return accessToken;
  if (!spotifyConfigured() || (playlist && !refreshToken)) {
    throw new Error(playlist ? "Connect Spotify in Profile to import playlists" : "Configure Spotify credentials to look up albums and tracks");
  }
  const body = refreshToken
    ? new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken })
    : new URLSearchParams({ grant_type: "client_credentials" });
  return (await requestSpotifyToken(body, request, signal)).access_token;
}
