# Spotify playlist imports

Paste an `https://open.spotify.com/playlist/...` share URL into Quick Add and save it. Localized `/intl-xx/playlist/...` URLs and query parameters are supported. Saving queues an `import-spotify-playlist` job automatically, including items created through the storage API. The worker creates a separate list named after the Spotify playlist. The source item links to that list and shows the existing job status/error display.

## Worker configuration

Add server-only credentials to `.env.local` and restart the worker:

```dotenv
SPOTIFY_CLIENT_ID=your-app-client-id
SPOTIFY_CLIENT_SECRET=your-app-client-secret
SPOTIFY_REFRESH_TOKEN=your-user-refresh-token
```

Obtain the refresh token through Spotify's [Authorization Code flow](https://developer.spotify.com/documentation/web-api/tutorials/code-flow), authorizing the account that can access the playlists. Request `playlist-read-private` and `playlist-read-collaborative` for private and collaborative playlists. An existing short-lived user token can alternatively be provided as `SPOTIFY_ACCESS_TOKEN`. A client-credentials token alone is not a substitute for user authorization. Tokens are never placed in list metadata or browser responses. This feature uses configured worker credentials; it does not add a browser sign-in flow.

Spotify's app mode and account restrictions still apply; inaccessible playlists produce a visible job error. See the [current playlist items endpoint](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items) and [Spotify's API changes](https://developer.spotify.com/documentation/web-api/references/changes/february-2026).

The worker can run with Spotify credentials alone; `OPENROUTER_KEY` is still needed for ordinary item enrichment. Imported Spotify tracks are stored directly without AI enrichment.

## Stored data and recovery

- Each track becomes a media item with `trackName`, `artist`, `artists`, `spotifyUrl`, `url`, `platform: "spotify"`, `platformId`, and `thumbnailUrl`. Title and description also show the song and artists in existing views.
- Playlist title, plain-text description, source URL, Spotify ID, snapshot ID, and cover thumbnail are stored on the list. Lists use playlist view by default.
- Album image URLs are used directly. If missing, the worker tries Spotify oEmbed artwork and downloads it to the existing content-addressed thumbnail store. If Spotify supplies no usable artwork, the item imports without a thumbnail.
- Pagination preserves playlist order and repeated tracks. Null entries, local files, and episodes are skipped and counted in the completion summary.
- Each track is committed separately. Job retries reuse existing positions without duplicating items or overwriting edits. Writes check the worker lease and source revision. Deleting the imported list stops subsequent writes.
- If Spotify changes the playlist snapshot during a partial import, the job reports an error instead of mixing versions. Paste the URL again to create a fresh import; the partial list remains available for review or deletion.
- SQLite migration 2 adds list metadata without altering existing list or item contents.
