import type Database from "better-sqlite3";
import { digest, secret } from "./accounts";
import { SpotifySecrets } from "./spotify-secrets";
import { requestSpotifyToken, spotifyConfigured } from "../processing/spotify-auth";

export const SPOTIFY_CALLBACK = "/api/spotify/callback";
const SCOPES = "playlist-read-private playlist-read-collaborative";
const STATE_TTL_MS = 10 * 60_000;
const statePattern = /^[\w-]{43}$/;

export function spotifyCallback(browserOrigin: string) {
  const url = new URL(SPOTIFY_CALLBACK, browserOrigin);
  if (url.protocol === "https:") return url;
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  if (url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname)) return url;
}

type StoredTokens = { accessToken: string; refreshToken: string };
type Connection = { tokens: string; expires_at: number };

export class SpotifyConnections {
  constructor(private readonly db: Database.Database, private readonly secrets = new SpotifySecrets(`${db.name}.spotify-key`)) {}

  connected(userId: string) {
    return Boolean(this.db.prepare("SELECT 1 FROM spotify_connections WHERE user_id=?").get(userId));
  }

  disconnect(userId: string) {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM spotify_authorizations WHERE user_id=?").run(userId);
      this.db.prepare("DELETE FROM spotify_connections WHERE user_id=?").run(userId);
    })();
  }

  start(userId: string, session: string, browserOrigin: string) {
    if (!spotifyConfigured()) throw new Error("Spotify app credentials are missing.");
    const callback = spotifyCallback(browserOrigin);
    if (!callback) throw new Error("Open Listo over HTTPS or on the server at its loopback address to connect Spotify.");
    const state = secret();
    const now = Date.now();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM spotify_authorizations WHERE expires_at<=?").run(now);
      this.db.prepare(`
        INSERT INTO spotify_authorizations(user_id,state_hash,session_hash,browser_origin,expires_at)
        VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET
        state_hash=excluded.state_hash, session_hash=excluded.session_hash, browser_origin=excluded.browser_origin,
        expires_at=excluded.expires_at, result=NULL, claimed=0
      `).run(userId, digest(state), digest(session), browserOrigin, now + STATE_TTL_MS);
    })();
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({
      response_type: "code", client_id: process.env.SPOTIFY_CLIENT_ID!, scope: SCOPES,
      redirect_uri: callback.href, state, show_dialog: "true",
    }).toString();
    return url;
  }

  callback(state: string, callbackOrigin: string, code: string | null) {
    if (!statePattern.test(state) || (code && code.length > 4096)) return;
    const hash = digest(state);
    const pending = this.db.prepare("SELECT browser_origin FROM spotify_authorizations WHERE state_hash=? AND expires_at>? AND result IS NULL AND claimed=0")
      .get(hash, Date.now()) as { browser_origin: string } | undefined;
    if (!pending || spotifyCallback(pending.browser_origin)?.origin !== callbackOrigin) return;
    // Return to the originating Listo hostname before exchanging the code. This also
    // works when the browser's Listo session cookie is scoped to localhost.
    const result = code ? this.secrets.encrypt(code, `spotify-code:${hash}`) : "denied";
    const saved = this.db.prepare("UPDATE spotify_authorizations SET result=? WHERE state_hash=? AND result IS NULL AND claimed=0")
      .run(result, hash);
    if (saved.changes) return new URL(`/api/spotify/finish?state=${state}`, pending.browser_origin);
  }

  async finish(userId: string, session: string, browserOrigin: string, state: string, request: typeof fetch, signal: AbortSignal) {
    if (!statePattern.test(state)) return "invalid";
    const hash = digest(state);
    const sessionHash = digest(session);
    const pending = this.db.prepare(`
      UPDATE spotify_authorizations SET claimed=1, result=NULL
      WHERE state_hash=? AND user_id=? AND session_hash=? AND browser_origin=?
        AND expires_at>? AND result IS NOT NULL AND claimed=0
    `);
    // Read and clear the encrypted code in a single write transaction.
    const result = this.db.transaction(() => {
      const row = this.db.prepare("SELECT result FROM spotify_authorizations WHERE state_hash=?").get(hash) as { result: string | null } | undefined;
      const claimed = pending.run(hash, userId, sessionHash, browserOrigin, Date.now());
      return claimed.changes ? row?.result : undefined;
    }).immediate();
    if (!result) return "invalid";
    try {
      if (result === "denied") return "denied";
      const code = this.secrets.decrypt(result, `spotify-code:${hash}`);
      const token = await requestSpotifyToken(new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: spotifyCallback(browserOrigin)!.href,
      }), request, signal);
      if (typeof token.refresh_token !== "string" || !token.refresh_token) throw new Error("Spotify did not return a refresh token");
      const encrypted = this.secrets.encrypt(JSON.stringify({ accessToken: token.access_token, refreshToken: token.refresh_token }), `spotify-tokens:${userId}`);
      const saved = this.db.transaction(() => {
        const active = this.db.prepare(`
          SELECT 1 FROM spotify_authorizations a JOIN sessions s ON s.token_hash=a.session_hash
          JOIN users u ON u.id=a.user_id
          WHERE a.state_hash=? AND a.claimed=1 AND a.expires_at>? AND s.expires_at>? AND u.active=1
        `).get(hash, Date.now(), Date.now());
        if (!active) return false;
        this.db.prepare(`
          INSERT INTO spotify_connections VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET
          tokens=excluded.tokens, expires_at=excluded.expires_at
        `).run(userId, encrypted, Date.now() + token.expires_in * 1000);
        return true;
      }).immediate();
      return saved ? "connected" : "invalid";
    } finally {
      this.db.prepare("DELETE FROM spotify_authorizations WHERE state_hash=?").run(hash);
    }
  }

  async accessToken(userId: string, request: typeof fetch, signal: AbortSignal): Promise<string | undefined> {
    const get = () => this.db.prepare("SELECT tokens, expires_at FROM spotify_connections WHERE user_id=?").get(userId) as Connection | undefined;
    const current = get();
    if (!current) return;
    const context = `spotify-tokens:${userId}`;
    const read = (value: Connection) => JSON.parse(this.secrets.decrypt(value.tokens, context)) as StoredTokens;
    const tokens = read(current);
    if (current.expires_at > Date.now() + 60_000) return tokens.accessToken;
    const refreshed = await requestSpotifyToken(new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken }), request, signal);
    const next = this.secrets.encrypt(JSON.stringify({
      accessToken: refreshed.access_token,
      refreshToken: typeof refreshed.refresh_token === "string" && refreshed.refresh_token ? refreshed.refresh_token : tokens.refreshToken,
    }), context);
    const updated = this.db.prepare("UPDATE spotify_connections SET tokens=?, expires_at=? WHERE user_id=? AND tokens=?")
      .run(next, Date.now() + refreshed.expires_in * 1000, userId, current.tokens);
    if (updated.changes) return refreshed.access_token;
    const latest = get();
    if (!latest) throw new Error("Spotify was disconnected during import");
    return read(latest).accessToken;
  }
}
