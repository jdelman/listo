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

- Data is stored locally in the browser for this first vertical slice.
- Imported files are represented with browser-managed data URLs; this proves the product flow while a desktop filesystem/database layer remains a future architecture step.
- Movie entry is manual in this first slice so the core workflow does not depend on a TMDB credential.
- Styling stays deliberately sparse: Times New Roman, borders, spacing, and basic responsive grids.
