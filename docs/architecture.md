# Listo local architecture

## Runtime shape

Listo currently runs as two local processes:

1. The Next.js application serves the React UI and the local JSON API.
2. The worker polls the same SQLite database and processes queued jobs.

The default database is `data/listo.sqlite`. `LISTO_DB_PATH` can point both processes at a different file.

## Abstraction boundaries

`StorageBackend` owns application records and list operations. `JobQueueBackend` owns job claiming, leases, retries, completion, and recovery. `ItemProcessorStore` exposes only the item operations needed by a processor. The React client talks to a command API and does not know that the active adapter is SQLite.

A future hosted adapter can implement these contracts with D1 and Cloudflare Workflows or Queues. Item processors depend only on plain `Item` values and an `AbortSignal`, so their domain logic can move to a different worker runtime.

## Delivery semantics

Creating an item inserts the item, its list placements, and a `process-item` job in one SQLite transaction. Jobs are processed with at-least-once semantics:

- a worker atomically claims one eligible job with a unique lease token;
- expensive processing happens outside a database transaction;
- a completed job can only be acknowledged by its current lease owner;
- abandoned leases are returned to the queue;
- failures use bounded exponential backoff and remain visible after the final attempt;
- derived results are saved only when the item revision still matches the job input revision.

Processors must therefore remain idempotent.

## Generated metadata

Worker output is stored under `item.metadata.derived`. It does not overwrite the title, description, tags, or other user-authored fields. Each result records its processor version and processing timestamp.

The first processor performs deterministic local enrichment and URL metadata retrieval. A future summarization provider can replace or extend that processor without changing the queue or storage contracts.

## Browser-data migration

The client offers an explicit import of `listo.database.v1` only while signed in as `jdelman`. Imports assign ownership on the server and remap IDs; the browser copy is removed only after success. Other accounts cannot silently claim legacy browser data.


## Authentication and ownership

`Accounts` owns salted scrypt password hashes, expiring hashed sessions, recovery links, and persistent authentication throttling. Server pages resolve cookies before rendering the app; API routes independently reject anonymous access and validate mutation origins. `SQLiteBackend` requires an explicit user ID. Only the local worker receives the explicit global context (`null`); remote MCP and browser requests always use the authenticated account.

Schema migrations 3 and 4 introduce users, ownership, sessions, recovery, OAuth grants, and audience-bound tokens. Composite foreign keys prevent memberships and jobs from crossing owners. Tags and metadata inherit ownership. Thumbnail reads require a reference in the user's records; submitted metadata cannot claim another user's thumbnail key. Browser application state omits credentials and worker lease tokens.

`OAuthService` integrates the maintained Node OAuth2 Server library for authorization code, PKCE, and refresh exchanges with SQLite-backed grant/token storage. MCP uses the official SDK's stateless Streamable HTTP transport: each request must carry a valid bearer token. Scope checks precede tool execution, and ownership checks use the same backend as the browser. Consent requires a browser session; connected grants are visible and revocable in the profile.

The client discards stale responses after page exit and checks the account identity on refresh and mutation requests. Back/forward cache restoration reloads through the server auth boundary. Logout uses a full navigation and clears the session cookie.
