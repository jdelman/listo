# Listo progress

## Goal

Build the first genuinely useful local-first release described in `plan.md`, with intentionally minimal responsive styling.

## Milestones

- [x] 1. Set up the TypeScript React application and core data types
- [x] 2. Add local persistence and CRUD operations for lists, items, and placements
- [x] 3. Build responsive list index and ordered mixed-item list detail views
- [x] 4. Add Quick Add classification for notes, URLs, YouTube, images, and PDFs
- [x] 5. Add structured clothing, movie, and general item editors
- [x] 6. Add global search and type/tag/list filtering
- [x] 7. Add standalone static HTML export
- [x] 8. Verify the acceptance workflow, responsive behavior, and production build

## Completed in this release

- Lists can be created, edited, tagged, deleted, searched, and exported.
- Items have durable IDs and can appear in multiple lists with an independent order in each list.
- Item order can be changed by drag-and-drop or keyboard-friendly up/down controls.
- Quick Add recognizes plain text, general URLs, YouTube, Apple Music, SoundCloud, PDF files/links, and image files; Inbox is the fallback destination.
- Notes have a Markdown editor and a basic safe rendered preview.
- Images and PDFs can be imported into browser-managed local storage.
- Clothing supports a photograph, freeform size, preset or arbitrary measurements, string or numeric-looking values, and optional units.
- Movies support title, year, TMDB ID, and a direct TMDB search handoff without requiring an API key.
- Global search covers titles, descriptions, tags, notes, URLs, media/movie fields, sizes, and measurement names/values, with type, list, tag, and offline filters.
- Standalone HTML export preserves mixed-item order, embeds imported assets, and renders clothing measurements dynamically.

## Verification

- Production build: passed
- TypeScript strict check: passed
- Lint: passed with two intentional advisories for browser-imported image data URLs
- Local preview response: HTTP 200
- Responsive breakpoints cover wide, tablet, and phone layouts using only basic grid/flex rules.

## Working notes

- Canonical data is stored in `data/listo.sqlite`; browser storage is used only as a one-time migration source for the previous release.
- Imported files are currently represented with data URLs stored in SQLite. Moving binary assets into a separate local asset directory remains a later storage improvement.
- Movie entry is manual in this first slice so the core workflow does not depend on a TMDB credential.
- Styling stays deliberately sparse: Times New Roman, borders, spacing, and basic responsive grids.

## SQLite storage and worker

- [x] Define backend-neutral storage and job-queue contracts
- [x] Add the SQLite schema, migration runner, and application repository
- [x] Move React persistence from browser storage to the local API
- [x] Import any existing browser database into SQLite on first run
- [x] Add transactional job creation for every new item
- [x] Add a separate worker process with claims, leases, retries, and recovery
- [x] Add an initial item enrichment processor and processing status in the UI
- [x] Add automated storage/queue/worker tests and verify the full build

### Architecture decision

- SQLite is the canonical store for the local application.
- The client uses a backend-neutral command API rather than importing SQLite directly.
- Storage and job execution are expressed as TypeScript interfaces so a future D1/Cloudflare implementation can preserve the same application contract.
- The current hosted version remains unchanged until a hosted storage/worker adapter exists; a local SQLite file cannot be used by a Cloudflare deployment.

### Verification

- SQLite application and queue tests: passed
- Worker processing and stale-lease recovery tests: passed
- End-to-end local API → SQLite → worker → derived metadata flow: passed
- TypeScript strict check: passed
- Production build: passed
- Lint: passed with the same two intentional imported-image advisories

## URL navigation and history

- [x] Give Lists, Inbox, list detail, Search, Quick Add, and item detail stable URLs
- [x] Render the application correctly after a direct visit or page reload on every route
- [x] Use browser history for screen-to-screen navigation
- [x] Preserve list/search filters, edit mode, Quick Add mode/destination, and item return context in query parameters
- [x] Add route round-trip tests and verify every route responds successfully

### Routes

- `/lists` — list index
- `/inbox` — Inbox
- `/lists/:id` — list detail
- `/search` — global search, including active filters
- `/add` — Quick Add, including capture mode and destination
- `/items/:id` — item detail, including edit and return state

### Verification

- URL parsing and state round-trip tests: passed
- All 10 automated flow tests: passed
- Direct HTTP checks for each route: passed
- Browser Back/Forward and state-preserving reload checks: passed
- TypeScript strict check: passed
- Production build: passed
- Lint: passed with the same two intentional imported-image advisories
