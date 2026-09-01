# Personal Lists App — Product and Implementation Plan

## 1. Product concept

Build a personal knowledge, media, and curation application organized around **ordered heterogeneous lists**.

A list can contain different kinds of items intermixed:

* Notes
* URLs / websites
* Songs and videos
* PDFs
* Images / photographs
* Movies
* Clothing

The app should optimize for four activities:

1. **Capture** something with as little friction as possible.
2. **Organize** things into ordered lists and tags.
3. **Retrieve** anything through metadata and full-text search.
4. **Publish/export** any list as a self-contained static website.

Lists are not merely folders. They are ordered compositions analogous to playlists, notebooks, reading lists, research dossiers, moodboards, or small websites.

---

# 2. Core principles

## 2.1 Lists are the primary organizational object

A list:

* has a title
* can have an optional description
* has tags
* contains an ordered sequence of items
* allows heterogeneous item types
* can be manually reordered
* can be searched
* can be exported
* can optionally have a preferred display mode

Potential display modes:

* standard list
* compact list
* gallery
* playlist
* document / essay
* table

Do not make lists equivalent to folders.

An item may appear in multiple lists.

Its position is therefore a property of the relationship between `List` and `Item`, not of the item itself.

Conceptually:

```text
List
  ↕
ListItem
  ↕
Item
```

`ListItem` contains at least:

```text
listId
itemId
position
```

This also leaves room later for list-specific annotations or display settings.

---

# 3. Core data model

## List

```ts
type List = {
  id: string
  title: string
  description?: string

  tags: string[]

  defaultView?:
    | "list"
    | "compact"
    | "gallery"
    | "playlist"
    | "document"
    | "table"

  createdAt: Date
  updatedAt: Date
}
```

## Item

Use a common item abstraction with type-specific metadata.

```ts
type Item = {
  id: string

  type:
    | "note"
    | "url"
    | "media"
    | "pdf"
    | "image"
    | "movie"
    | "clothing"

  title?: string
  description?: string

  tags: string[]

  sourceUrl?: string
  sourcePath?: string

  importedAssetId?: string

  extractedText?: string

  createdAt: Date
  updatedAt: Date

  metadata: ItemMetadata
}
```

An item can be:

* externally referenced
* locally referenced
* imported into application-managed storage
* both externally referenced and imported

Track this explicitly rather than inferring it.

For example:

```ts
type Availability = {
  external: boolean
  localReference: boolean
  imported: boolean
}
```

---

# 4. Item types

## 4.1 Note

Markdown-based note/document.

Requirements:

* Markdown editing
* headings
* lists
* tables
* links
* code blocks
* images
* embedded media
* raw HTML support
* rich media embedding

Example:

```ts
type NoteMetadata = {
  markdown: string
}
```

Notes should be fully indexed for search.

Raw HTML should be sanitized appropriately when rendered or exported.

---

# 4.2 URL / Website

Represents an arbitrary webpage.

Store:

```ts
type UrlMetadata = {
  url: string

  canonicalUrl?: string

  siteName?: string
  faviconUrl?: string

  fetchedTitle?: string
  fetchedDescription?: string

  screenshotAssetId?: string
  archivedHtmlAssetId?: string
}
```

On addition, attempt to retrieve:

* page title
* description
* favicon
* OpenGraph metadata
* canonical URL

Later versions may support:

* readable-text extraction
* page screenshots
* offline webpage snapshots
* archived HTML

Search should eventually include extracted webpage text.

---

# 4.3 Song / Video / Audio Media

Use one generalized media item.

Initial supported platforms:

* YouTube
* Apple Music
* SoundCloud

Architecture should permit adding:

* Spotify
* Vimeo
* Bandcamp
* local audio
* local video
* other providers

Example:

```ts
type MediaMetadata = {
  platform:
    | "youtube"
    | "apple_music"
    | "soundcloud"
    | "other"

  platformId?: string

  url: string

  artist?: string
  creator?: string
  album?: string

  durationSeconds?: number

  thumbnailAssetId?: string

  playableInline?: boolean
  playableExternally?: boolean
}
```

A media-heavy list can be switched into **playlist mode**.

Playlist mode should:

* render playable media prominently
* maintain list order
* provide next/previous controls
* autoplay the next item where platform/browser restrictions permit
* skip or gracefully handle non-playable items

Do not assume cross-provider autoplay will always work.

---

# 4.4 PDF

```ts
type PdfMetadata = {
  pageCount?: number
  author?: string

  extractedText?: string
  ocrText?: string
}
```

PDFs may be:

* external URLs
* local filesystem references
* imported application assets

Eventually:

* extract embedded text
* OCR scanned pages
* index all text
* potentially store per-page text

OCR is not required for the first working version.

---

# 4.5 Image / Photograph

```ts
type ImageMetadata = {
  width?: number
  height?: number

  caption?: string
  altText?: string

  exif?: Record<string, unknown>

  ocrText?: string

  detectedObjects?: Array<{
    label: string
    confidence?: number
  }>
}
```

Images may be local or remote.

Eventually index:

* filename
* captions
* tags
* EXIF metadata
* OCR text
* basic object-detection labels

Object detection is explicitly a later-phase feature.

---

# 4.6 Movie

TMDB ID is the canonical external identifier.

```ts
type MovieMetadata = {
  tmdbId: number

  title: string
  originalTitle?: string
  year?: number

  posterAssetId?: string

  imdbId?: string

  externalLinks?: {
    tmdb?: string
    imdb?: string
    letterboxd?: string
    commonSenseMedia?: string
    plex?: string
  }
}
```

Movie creation should support searching by title/year and selecting a TMDB result.

TMDB metadata may provide:

* title
* year
* poster
* overview
* directors
* cast
* runtime
* genres

Do not make every possible movie field part of the core schema. Keep fetched metadata extensible.

---

# 4.7 Clothing

Clothing is a first-class item type.

Use an extensible measurement model from the beginning.

```ts
type Measurement = {
  name: string
  value: string | number
  unit?: "in" | "cm"
}

type ClothingMetadata = {
  name: string

  imageAssetId?: string

  size?: string

  measurements: Measurement[]
}
```

## Size

`size` must remain freeform.

Examples:

```text
S
M
L
XL
38
40R
15.5 / 34
31
31x30
3
EU 50
UK 9
```

Do not model size as an enum.

## Measurements

Measurements are stored as arbitrary records rather than fixed database fields.

Examples:

```ts
[
  {
    name: "chest",
    value: 22.5,
    unit: "in"
  },
  {
    name: "sleeve",
    value: 25,
    unit: "in"
  },
  {
    name: "length",
    value: 30,
    unit: "in"
  }
]
```

The initial UI should expose these common measurement names:

* chest
* sleeve
* length
* collar
* waist
* hem
* inseam
* outseam
* thigh

Users must also be able to add arbitrary measurements.

Examples:

* shoulder
* rise
* front rise
* back rise
* knee
* leg opening
* cuff
* pit-to-pit
* back length
* neck-to-cuff

Do not require a database migration when new measurement types are introduced.

The UI may offer common measurement names as presets/autocomplete values, but `name` should remain freeform.

## Measurement units

For numeric measurements, support:

* inches
* centimeters

The app should preserve the original entered unit.

Do not silently convert and overwrite user-entered values.

Conversion for display can be added later.

A string value should also be permitted when necessary for unusual or approximate measurements.

Examples:

```text
~23
22 1/2
23 stretched
```

## Optional clothing metadata

Potential later fields:

```ts
type ExtendedClothingMetadata = {
  brand?: string
  model?: string
  category?: string
  color?: string
  material?: string
  condition?: string

  purchaseUrl?: string
  purchasePrice?: number
  purchaseCurrency?: string
  purchaseDate?: Date

  notes?: string
}
```

These fields are not mandatory for MVP.

---

# 5. Tags

Both lists and items can have tags.

Tags should be simple strings initially.

Examples:

```text
photography
music
research
to-read
outerwear
vintage
movies
family
reference
```

Do not automatically copy list tags onto items.

Search must nevertheless support queries such as:

```text
items contained within lists tagged "photography"
```

Tag inheritance should therefore be a search/query concept rather than destructive propagation.

---

# 6. Search

Search is a first-class feature.

## Global search

Search across:

* item title
* item description
* tags
* list names
* list descriptions
* note text
* webpage extracted text
* PDF text
* PDF OCR
* image OCR
* image object labels
* movie metadata
* media metadata
* clothing name
* clothing size
* clothing measurement names
* clothing measurement values
* optional clothing metadata

## Filters

Support filters such as:

```text
type
list
tag
imported/offline
date created
date modified
```

Examples:

```text
"Eggleston"
type:image

"ambient"
type:media
tag:music

type:clothing
tag:jacket
size:40

type:clothing
measurement:chest
"22.5"

type:pdf
"phenomenology"
```

Advanced search syntax is not required initially, but the underlying search system should make these filters possible.

For clothing measurements, indexing should flatten measurement records into searchable text/fields without changing the canonical extensible data model.

---

# 7. Inbox / catch-all list

Create a special default list called something like:

```text
Inbox
```

Every quick-add action can safely fall back to the Inbox.

This is important because users should never need to decide where something belongs before saving it.

Workflow:

```text
capture
↓
classify
↓
suggest destination
↓
save
```

If classification or list selection fails:

```text
save to Inbox
```

---

# 8. Quick Add

Quick Add is one of the highest-priority interfaces.

The input should behave roughly like:

```text
Paste URL, type a note, search for a movie, or drop a file…
```

Accept:

* plain text
* URLs
* files
* images
* PDFs
* movie titles
* media URLs

The system should heuristically classify the input.

Examples:

```text
youtube.com/... → media / YouTube
music.apple.com/... → media / Apple Music
soundcloud.com/... → media / SoundCloud
*.pdf → PDF
image file → image
normal URL → website
plain text → note
```

For uncertain cases, choose a safe default rather than forcing a modal workflow.

After classification:

1. derive metadata
2. suggest item title
3. suggest destination list
4. optionally suggest tags
5. save

The user should be able to override classification.

Clothing will initially use a dedicated structured entry form rather than heuristic classification.

---

# 9. Capture integrations

Eventually expose the Quick Add operation through a simple stable API.

That API should permit something equivalent to:

```text
POST /items
```

This enables:

* macOS Shortcuts
* iOS Shortcuts
* iOS share sheet
* Siri/voice capture
* browser extensions
* command-line tools
* future integrations

Example voice interaction:

```text
"Add Blue in Green by Miles Davis to Jazz References"
```

Do not build sophisticated natural-language voice parsing in the first version.

A Shortcut can initially gather:

* input
* optional destination list
* optional note

and submit it to the same Quick Add endpoint.

---

# 10. Offline/import model

External references should remain lightweight by default.

An item can later be explicitly **imported**.

Examples:

## Web page

Normal:

```text
URL reference
```

Imported:

```text
URL
+
archived page/assets
```

## PDF

Normal:

```text
https://example.com/paper.pdf
```

Imported:

```text
local application copy of PDF
```

## Image

Normal:

```text
filesystem path or remote URL
```

Imported:

```text
application-managed original image
```

The UI should distinguish:

```text
Linked
Imported
Linked + Imported
Unavailable
```

Search should support:

```text
offline only
```

---

# 11. Static website export

Every list should be exportable as a static website.

This is a core feature rather than an afterthought.

Typical output:

```text
export/
├── index.html
├── assets/
│   ├── images/
│   ├── pdfs/
│   ├── thumbnails/
│   └── attachments/
├── styles.css
└── metadata.json
```

The result should:

* work without a server
* use relative paths
* preserve list ordering
* include imported assets when permitted
* retain external links
* produce usable HTML
* have reasonable default typography/design
* work well on mobile

Initial export templates:

## Standard

Mixed-media cards in list order.

## Gallery

Image-forward presentation.

## Document

Render items as a continuous composition.

Especially useful for:

```text
note
image
note
song
movie
PDF
note
```

which can become a curated article/zine.

## Playlist

Media-oriented layout.

## Clothing rendering

Clothing items should render cleanly in static exports.

At minimum display:

* image
* name
* size
* measurements

Measurements should be rendered dynamically from the measurement array rather than assuming a fixed schema.

Example:

```text
Chest       22.5 in
Sleeve      25 in
Length      30 in
Shoulder    18.25 in
```

Do not require JavaScript frameworks in the exported result unless genuinely necessary.

Prefer simple durable HTML/CSS/JS.

---

# 12. UI structure

Initial application navigation:

```text
Lists
Inbox
Search
Quick Add
```

## Lists screen

Display:

* title
* description
* tags
* item count
* modified date

Allow filtering by tag.

## List screen

Show heterogeneous items in manual order.

Allow:

* drag-and-drop reordering
* adding an item
* removing an item from the list
* moving/copying to another list
* editing tags
* changing display mode
* searching within the list
* exporting

## Item screen

Show:

* primary content/preview
* metadata
* tags
* source
* import status
* lists containing the item

## Clothing item screen

Show:

* image
* name
* size
* measurements
* optional metadata
* tags
* lists containing the item

Measurement editing should support:

* common measurement presets
* arbitrary custom names
* numeric or text values
* optional unit
* adding/removing measurements
* reordering measurements if useful

## Search screen

Global query plus filters.

---

# 13. Important behavioral decisions

## An item may belong to multiple lists

Do not duplicate the underlying item.

Use a join relationship.

## Removing an item from a list does not necessarily delete it

These should be separate actions:

```text
Remove from this list
Delete item everywhere
```

## Tags belong to objects, not placements

Item tags remain the same regardless of what list contains the item.

## Ordering belongs to ListItem

The same item can appear at different positions in different lists.

## Clothing measurements are extensible data

Do not create separate database columns for:

```text
chest
sleeve
length
waist
etc.
```

Use the generic measurement model:

```ts
type Measurement = {
  name: string
  value: string | number
  unit?: "in" | "cm"
}
```

The standard measurements exist at the UI level as suggested/preset fields, not at the persistence-schema level.

---

# 14. MVP

The MVP should prove:

```text
capture → organize → retrieve → export
```

## Required item types

* Note
* URL
* YouTube media
* PDF
* Image
* Movie
* Clothing

Apple Music and SoundCloud can be recognized early, but sophisticated playback integration is not required for the first milestone.

## MVP functionality

### Lists

* create
* rename
* describe
* delete
* tag
* reorder items
* add/remove items

### Items

* create
* edit
* delete
* tag
* assign to multiple lists

### Quick Add

* plain text
* URL
* YouTube
* image upload
* PDF upload
* movie search
* clothing entry

### Clothing

Support:

* image
* name
* freeform size
* arbitrary measurements

Initial measurement presets:

```text
chest
sleeve
length
collar
waist
hem
inseam
outseam
thigh
```

Users must be able to add measurements outside that set.

### Search

Initially index:

* list title
* list description
* item title
* item description
* tags
* note Markdown
* URL metadata
* movie metadata
* clothing name
* clothing size
* clothing measurement names
* clothing measurement values
* PDF embedded text where easily extractable

### Export

One high-quality generic static HTML template.

---

# 15. Phase 2

After the fundamental system works:

* Apple Music support
* SoundCloud support
* playlist mode
* Shortcuts API
* iOS/macOS sharing integrations
* PDF OCR
* image OCR
* webpage readable-text extraction
* webpage archiving
* improved search ranking
* gallery view
* document/zine export
* playlist export
* clothing measurement unit conversion for display
* clothing-specific table/gallery views if useful

---

# 16. Phase 3

Only after the product has proven useful:

* image object detection
* semantic search
* automatic tag suggestions
* automatic list suggestions
* AI-assisted classification
* transcription of audio/video where appropriate
* Plex integration
* richer movie-provider integrations
* browser extension
* automated metadata reconciliation
* duplicate detection
* import/export interoperability with other tools
* clothing metadata extraction from product URLs
* automated clothing measurement extraction from product pages where reliable

---

# 17. Explicit non-goals for MVP

Do not spend initial development time on:

* collaboration
* real-time multiplayer editing
* social features
* user accounts unless technically necessary
* complicated permission models
* cross-provider perfect autoplay
* downloading protected streaming media
* AI agents
* object detection
* comprehensive OCR
* full webpage preservation
* rich WYSIWYG editor
* native iOS application
* native macOS application
* browser extension
* plugin ecosystem
* exhaustive clothing taxonomy
* standardized clothing sizing

The first version should be useful as a personal tool before becoming a platform.

---

# 18. Architecture constraints

Do not select a technology stack until the following requirements are considered.

The architecture should make these easy:

## Local filesystem access

The app needs to reference and potentially import:

* images
* PDFs
* eventually audio/video

## Durable local database

The canonical database should remain understandable and exportable.

Avoid designs where the user's data can only be interpreted by a proprietary remote service.

## Full-text indexing

The system must eventually index large bodies of extracted content.

## Background processing

Some operations will need asynchronous jobs:

* metadata fetching
* thumbnails
* PDF extraction
* OCR
* image analysis
* webpage archival

These should not block item creation.

## Asset storage

Imported binary files should be separate from structured metadata.

Conceptually:

```text
database/
assets/
index/
```

## Stable identifiers

Items and lists need durable IDs so that:

* exports can reference them
* external automations can address them
* future sync can work
* links between objects survive renames

## Extensible structured metadata

Type-specific metadata should support growth without frequent destructive migrations.

This is especially important for clothing measurements.

For clothing, the canonical representation must be:

```ts
type Measurement = {
  name: string
  value: string | number
  unit?: "in" | "cm"
}
```

not a collection of fixed measurement columns.

---

# 19. First implementation sequence

Build in this order.

## Milestone 1 — Data model

Implement:

* List
* Item
* ListItem
* Tag
* Asset
* Measurement representation for clothing

Create basic CRUD operations.

No polished UI required.

## Milestone 2 — Functional list UI

Implement:

* list index
* list detail
* heterogeneous items
* add/remove item
* manual ordering

This establishes the fundamental product model.

## Milestone 3 — Notes and URLs

Implement:

* Markdown notes
* URL items
* URL metadata retrieval
* Quick Add classification for plain text vs URL

## Milestone 4 — Files

Implement:

* PDF
* image
* local/imported assets
* PDF embedded-text extraction

## Milestone 5 — Clothing

Implement clothing editor with:

```text
image
name
size
measurements
```

`size` is freeform.

Measurements use the generic model:

```ts
type Measurement = {
  name: string
  value: string | number
  unit?: "in" | "cm"
}
```

Initial UI presets:

```text
chest
sleeve
length
collar
waist
hem
inseam
outseam
thigh
```

Users must be able to add arbitrary custom measurements.

Do not create fixed measurement columns in the persistence layer.

## Milestone 6 — Movies

Implement TMDB title search and canonical TMDB-backed movie items.

## Milestone 7 — Search

Create global indexing and filtering.

Ensure clothing measurement names and values are indexed.

## Milestone 8 — Static export

Export one list to clean standalone HTML.

Include imported images/assets.

Render clothing measurements dynamically.

## Milestone 9 — Media

Recognize YouTube URLs and render embedded playback.

Then add Apple Music and SoundCloud support.

## Milestone 10 — Inbox and refined Quick Add

Make capture extremely fast.

This should become the primary way new information enters the application.

---

# 20. Acceptance test for the first genuinely useful release

A release is successful if the user can perform this sequence without friction:

1. Create a list called `Tweed Jackets`.
2. Add a clothing item with:

   * photograph
   * name
   * size `40R`
   * chest `22.5 in`
   * sleeve `25 in`
   * length `30 in`
3. Add a custom measurement:

   * shoulder `18.25 in`
4. Add another custom measurement without requiring a schema change.
5. Paste an eBay URL into the same list.
6. Add a Markdown note discussing the jacket.
7. Add a PDF tailoring reference.
8. Reorder the items.
9. Tag the list `clothing` and `reference`.
10. Tag the jacket `herringbone`.
11. Search globally for `22.5`, `shoulder`, or `herringbone` and find the item.
12. Export the list.
13. Open `index.html` locally and see a well-designed static page containing the mixed content and dynamically rendered clothing measurements.

And separately:

1. Paste a YouTube link.
2. Have it automatically recognized as media.
3. Save it immediately to Inbox.
4. Move it into a music list.
5. Play it from that list.

If those workflows work well, the underlying product is viable enough to continue expanding.

