# Item thumbnails

New and reprocessed items download the first usable Open Graph or Twitter metadata image (or reuse an uploaded raster image). Relative metadata URLs resolve against the final page URL. If those fail, enrichment asks the LLM for a relevant direct image URL and downloads that image. A job cannot complete without storing a thumbnail; missing or invalid images use the normal job retry/failure flow. Existing completed items must be reprocessed to acquire thumbnails.

The public URL is persisted as `metadata.thumbnailUrl` in the existing SQLite metadata JSON, alongside the enrichment result. No schema migration is necessary. Item cards display it.

`ThumbnailStorage.put` is the storage boundary. The default `FileThumbnailStorage` writes content-addressed files beneath `data/thumbnails`; set `LISTO_THUMBNAIL_DIR` to use another directory. The Next.js server and worker must use the same directory (and shared persistent volume when run separately). `/thumbnails/:key` serves stored bytes with immutable caching and a fixed image content type. Only PNG, JPEG, GIF, and WebP signatures are accepted, with an 8 MB download limit and a download timeout.

To switch to a CDN or object store, implement `ThumbnailStorage`, inject it into `ItemEnrichmentProcessor`, and return the uploaded object's public URL from `put`. Processing and the database do not depend on the storage provider. Existing filesystem URLs require keeping the local route or migrating those objects and URLs. Files are retained when items are deleted; garbage collection is not currently implemented.

This adapter is for the local Node.js runtime; it is not suitable for Cloudflare Workers' ephemeral filesystem.
