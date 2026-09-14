# User accounts and data ownership plan

Status: implemented for the local Node/SQLite app. `jdelman` owns all existing data and the supplied initial credential is configured. Login/logout and the OAuth MCP flow have passed live verification. The separate older Cloudflare Sites deployment is unchanged.

Implementation decisions: keep `inbox` as a per-user API alias over unique database IDs; use OAuth dynamic client registration rather than fetching Client ID Metadata Documents; use operator-generated recovery links. See README.md for rollout and recovery instructions.

## Scope and defaults

Add username/password login, a profile page, password recovery, an explicit `/logout` action, OAuth-authorized remote MCP access, and private data ownership. Bootstrap `jdelman` using the initial password supplied in the task through a one-time secret input, storing only its salted password hash. Allow changing that password later without forcing a first-login change. Start with operator-created accounts; public signup, sharing, and social login are separate features.

The inspected app uses Next.js and local SQLite (schema version 2), with a separate processing worker and a local MCP server. There are currently no login checks in the data API. Tags are embedded in lists and items, and the Inbox uses a global `inbox` ID. No existing password-reset implementation was found in this checkout; check the running deployment before replacing any existing reset behavior.

## 1. Database migration and initial account

- Back up the actual active SQLite database with a consistent SQLite backup and preserve thumbnail storage. Record row counts, IDs, list memberships, tags, and job statuses before migration. Identify the deployed database path before rollout; do not assume the development database is production.
- Add `users` with stable ID, case-insensitive unique username, password hash, timestamps, and account status. Add session and password-reset token tables with user foreign keys, token hashes, expiry, and revocation/consumption state. Use a maintained password-hashing implementation with reviewed parameters when implementing.
- Add required `user_id` ownership and indexes to lists, items, list memberships, and jobs. Enforce same-user relationships with composite foreign keys backed by unique `(user_id, id)` constraints. Rebuild SQLite tables where required to enforce non-null ownership and preserve all existing data.
- Create `jdelman` once and assign every existing list, item, membership, and job to that account in the migration transaction. Preserve IDs, ordering, tags, metadata, timestamps, revisions, and queue state. Never overwrite an existing account password on restart or migration rerun.
- Keep tags embedded for now: they inherit ownership from their parent records, and tag suggestions/search operate only on the current user's records. Metadata and attachments inherit ownership as well.
- Give each user one Inbox, identified by a per-user unique system-list marker. Keep the existing Inbox ID for migrated data; use unique IDs for new accounts. Resolve `/inbox` to the current user's actual Inbox and replace hard-coded `inbox` assumptions throughout the client, backend, imports, and MCP.
- Check foreign keys, ownership completeness, and before/after data parity before recording migration success. Roll back on failure. Fresh installations must work too, and a repeat migration must be a no-op.

## 2. Authentication and recovery

- Implement login, logout, current-user lookup, password change, and reset-token consumption on the server. Use opaque random sessions with hashes stored in SQLite and HttpOnly, SameSite cookies; require Secure cookies over HTTPS. Set explicit expiry and revoke sessions on logout, password change, and recovery.
- Validate all inputs, use generic login/recovery errors, throttle authentication attempts, validate same-origin mutations with CSRF protection, and limit return URLs to local paths. Exclude passwords, cookies, and reset tokens from application and browser event logs.
- `/login`: username/password form, helpful errors, recovery link, and return to the originally requested app page after success.
- `/logout`: a CSRF-protected POST action that revokes the current server session, expires its cookie, clears client state, and redirects to `/login`. Repeated logout is safe; GET must not change authentication state. All logout controls submit to this action. Browser logout ends the current browser session; connected MCP grants are revoked separately from the profile.
- `/profile`: current username, password change requiring the current password, connected MCP applications with a revoke-access action, and logout. Keep username read-only initially so it remains a stable login identity.
- `/reset-password`: consume a short-lived, single-use recovery link and let the user choose a new password. Never reset to a shared fixed password. Because this app has no email recovery setup, initially provide an operator-only local command to generate a recovery link for a specified account. The page explains how to obtain that link. Email delivery can be added later with verified email addresses and a mail provider.
- Create explicit page routes ahead of the catch-all app route. Redirect anonymous page requests to login, return 401 for anonymous API requests, and send authenticated users away from the login form.

## 3. Enforce ownership across every access path

- Replace the global user-data backend with a backend bound to a server-authenticated user. A database connection can remain shared; the user context must be request-specific. Derive ownership from the session, never from submitted user IDs.
- Scope every read, update, delete, reorder, membership change, search, export, and import to that user. Validate referenced list/item IDs before mutations, inside their transaction. Return a consistent not-found response for inaccessible records.
- Protect `/api/state`, `/api/commands`, browser events, and thumbnail reads. Validate commands with runtime schemas and whitelist editable fields. Never return password hashes, sessions, reset tokens, or worker lock tokens in app state or exports.
- Require thumbnail ownership through an authorized item/reference mapping. Existing content-addressed files can remain shared on disk, but knowing a file key must not grant access. Replace public immutable caching with private authenticated responses.
- Separate trusted worker queue access from user-facing storage. Workers may process all users' jobs, but must preserve and validate the job/item ownership relationship when saving results.
- Bind local MCP to an explicitly configured account resolved on startup; fail closed if missing or invalid. Document that stdio MCP is a trusted local operator integration. Remote MCP OAuth support is part of this implementation, as detailed below.
- Make imports assign ownership server-side, remap conflicting IDs safely, and forbid changes to another user's records. Convert the existing automatic browser-storage import into an explicit authenticated migration offered to `jdelman`; do not let another user's empty account silently claim shared legacy browser data. Remove the legacy copy only after verified success.
- Clear cached client state on logout or account changes, cancel polling, and prevent stale in-flight responses from restoring the previous user's data.

## 4. OAuth for MCP

- Add a remote Streamable HTTP `/mcp` endpoint alongside local stdio. Follow the [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): OAuth 2.1, authorization code with PKCE S256, resource-bound tokens, protected-resource metadata, authorization-server discovery, and bearer challenges. Recheck the supported protocol version at implementation time.
- Use a maintained authorization-server implementation integrated with Listo accounts. Provide authorization, token, revocation, and discovery endpoints; support public clients without embedded secrets. Choose and test client registration compatibility with the intended MCP clients, including Client ID Metadata Documents and dynamic registration where needed.
- Route browser authorization through `/login`, then show consent identifying the requesting application and requested permissions. Bind codes to the user, client, exact validated redirect URI, resource, and PKCE challenge; make codes short-lived and single-use. Preserve the authorization request safely through login.
- Define read and write scopes and enforce them per tool, in addition to user ownership. Validate token expiry, issuer, audience/resource, revocation, and account status on each request. Never accept browser cookies as MCP bearer credentials. Bind transport sessions to the authenticated identity; a session ID alone grants no access.
- Persist clients, grants, authorization codes, and token state with appropriate user relationships. Hash opaque credentials at rest; rotate refresh tokens with reuse detection and revoke the token family on reuse. Keep OAuth secrets out of logs and exports. Password changes, recovery, and account disabling revoke all browser sessions and MCP credentials; profile revocation immediately disables the selected application's grant and tokens.
- OAuth access must resolve to the same user-bound backend as the web app. No default-user fallback for remote requests. Verify an actual client's discovery, consent, tool call, refresh, and revocation flow before declaring support complete.

## 5. Verification

- Migration tests using a populated version-2 fixture: exact record/tag/order/metadata preservation, ownership of every row, valid foreign keys, safe reruns, fresh installation, and rollback on failure.
- Two-user integration tests covering every command and read surface, forged ownership, foreign IDs, cross-user list memberships, imports/exports, Inbox behavior, thumbnails, and MCP account binding.
- MCP OAuth tests for discovery, consent approval/denial, redirect validation, missing/wrong PKCE, code replay, expired/revoked/wrong-audience tokens, scope enforcement, refresh rotation/reuse, transport session identity, and cross-user isolation.
- `/logout` tests for session revocation, cookie clearing, redirect, repeated calls, CSRF rejection, GET not mutating state, and stale client responses after logout.
- Authentication tests for correct/incorrect passwords, cookie flags, expired/revoked sessions, logout, password changes, CSRF, throttling, reset-token expiry/reuse, and session invalidation after recovery.
- Browser checks for login redirects, profile/password change, recovery, account switching, and the existing list/item/tag flows. Verify worker enrichment still completes for both users without mixing results.
- Run the existing test suite, lint, and production build. Check logs and exports for credential leakage.

## 6. Rollout and completion

Implement in dependency order: migration and account bootstrap; authenticated backend and worker/MCP changes; OAuth authorization server and remote MCP; pages and client state; integration verification; deployment and data migration. Ship the ownership changes and authentication together.

Pause web writes, MCP writes, and workers for the migration. Take the verified backup, migrate the intended database, and validate parity before starting the updated application and workers. Confirm `jdelman` can log in with the supplied initial credential and sees all previous data, while a second test account sees only its own Inbox and records. On failure, stop the updated processes and restore the matching database, files, and application version before reopening access.

Commit and push implementation changes as required by AGENTS.md. The initial password must not be hard-coded in source or committed documentation. Completion requires the deployed database migration, login/logout smoke tests, and a successful OAuth MCP connection and revocation test, not just successful code changes.
