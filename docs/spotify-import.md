# Spotify playlist imports

Paste an `https://open.spotify.com/playlist/...` share URL into Quick Add and save it. Localized `/intl-xx/playlist/...` URLs and query parameters are supported. Saving queues an `import-spotify-playlist` job automatically, including items created through the storage API. The worker creates a separate list named after the Spotify playlist. The source item links to that list and shows the existing job status/error display.

## Connect Spotify in Profile

Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` for the web app and worker. In your Spotify app settings, register the exact callback URL. For Listo at `http://localhost:3000` or `http://127.0.0.1:3000`, register `http://127.0.0.1:3000/api/spotify/callback`. For an HTTPS installation, register your Listo origin followed by `/api/spotify/callback`. Spotify requires an HTTPS address or an explicit loopback IP, so use HTTPS for a remote installation. [Spotify redirect URI requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)

Open Profile → Connected applications → Spotify → Connect, then authorize playlist access. Listo uses the connected account for that user's playlist jobs and refreshes access automatically. Disconnect from Profile to remove the local credentials. An import that already failed can be run again by saving the playlist URL again.

Tokens are encrypted in SQLite. Listo creates an owner-only key file alongside the database, with `.spotify-key` appended to the database filename. Keep that key separate from database backups and retain it when migrating the installation. Without the original key, reconnect Spotify to replace the encrypted credentials. The original Listo account can still use the legacy `SPOTIFY_REFRESH_TOKEN` or `SPOTIFY_ACCESS_TOKEN` worker setting if it has no Profile connection.

Spotify app mode and account restrictions still apply. In Development Mode, the connected Spotify user must be allowed in the app settings, and playlist items are limited to playlists the user owns or collaborates on. [Spotify Development Mode migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)

## Stored data and recovery

- Each track becomes a media item with `trackName`, `artist`, `artists`, `spotifyUrl`, `url`, `platform: "spotify"`, `platformId`, and `thumbnailUrl`. Title and description also show the song and artists in existing views.
- Playlist title, plain-text description, source URL, Spotify ID, snapshot ID, and cover thumbnail are stored on the list. Lists use playlist view by default.
- Album image URLs are used directly. If missing, the worker tries Spotify oEmbed artwork and downloads it to the existing content-addressed thumbnail store. If Spotify supplies no usable artwork, the item imports without a thumbnail.
- Pagination preserves playlist order and repeated tracks. Null entries, local files, and episodes are skipped and counted in the completion summary.
- Each track is committed separately. Job retries reuse existing positions without duplicating items or overwriting edits. Writes check the worker lease and source revision. Deleting the imported list stops subsequent writes.
- If Spotify changes the playlist snapshot during a partial import, the job reports an error instead of mixing versions. Paste the URL again to create a fresh import; the partial list remains available for review or deletion.
- SQLite migration 2 adds list metadata without altering existing list or item contents.
