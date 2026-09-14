# Listo

A local-first personal lists application built with TypeScript, React, Next.js, and SQLite.

## Run locally

```sh
npm install
# On a fresh database, supply the initial password through this environment variable:
LISTO_BOOTSTRAP_PASSWORD="<initial password>" npm run accounts -- bootstrap
npm run dev
```

This starts the web application and background worker together. Open `http://localhost:3000`.

Listo stores canonical data in `data/listo.sqlite` by default. Set `LISTO_DB_PATH` in `.env.local` to use another absolute path; the web process and worker must use the same value.

## Verify

```sh
npm test
npm run lint
npm run build
```

See `docs/architecture.md` for the storage and worker boundaries and `progress.md` for implementation status.

## MCP server

Listo provides a local stdio MCP server. Configure your MCP client to launch:

```json
{
  "mcpServers": {
    "listo": {
      "command": "node",
      "args": [
        "--import", "/absolute/path/to/listo/node_modules/tsx/dist/loader.mjs",
        "/absolute/path/to/listo/mcp/stdio.ts"
      ],
      "env": { "LISTO_MCP_USER": "jdelman" }
    }
  }
}
```

Replace `/absolute/path/to/listo` with your checkout path. Use Node 22.13 or newer. Alternatively, launch with `npm --silent --prefix /absolute/path/to/listo run mcp`.
The server resolves `data/listo.sqlite` and `.env.local` from the checkout, regardless of the client's working directory. To select another database, set an absolute `LISTO_DB_PATH` in the client's `env` configuration. It must match the web app and worker.

Available tools:

- `list_lists`: list IDs, details, and item counts.
- `get_list`: fetch a list and its items in list order using `listId`.
- `add_item`: create an item using `title`, optional `listId` (defaults to `inbox`), `description`, `tags`, `markdown`, and HTTP(S) `url`. URLs are classified automatically. Each successful call creates a new item.

Read tools accept `offset` (default 0) and `limit` (default 50, maximum 100). Unknown lists and invalid input return tool errors without adding anything. Additions use the same SQLite transaction and enrichment queue as the UI. Run `npm run dev` or `npm run worker` to process queued enrichment; refresh the web page to see external additions. The client starts the MCP process itself; no HTTP port or running web server is required.


## Accounts

Open `/login` to sign in, `/profile` to change your password or revoke connected applications, and `/reset-password` to use a recovery link. Logout controls submit a POST to `/logout`; visiting it with GET does not sign you out.

The first account is `jdelman`. Its initial password is supplied once through `LISTO_BOOTSTRAP_PASSWORD`, never checked into source. Re-running bootstrap preserves an existing password. Existing database records migrate to this account automatically. Each subsequent user receives private lists, items, tags, and an Inbox. Public registration is disabled.

Operator account management:

```sh
LISTO_ACCOUNT_PASSWORD="<new password>" npm run accounts -- create another_user
npm run accounts -- reset jdelman
```

The reset command prints a single-use recovery link valid for 30 minutes. Treat the link as a credential. Email recovery is not configured. Password changes and recovery revoke all browser sessions and MCP grants; ordinary logout revokes only the current browser session.

Set `LISTO_ORIGIN` to the canonical OAuth origin (default `http://localhost:3000`). The local installation also accepts `localhost`, `127.0.0.1`, `[::1]`, `jdsrv`, and `jdsrv.local` on that same scheme and port. Browser forms must originate from the exact hostname receiving the request; redirects stay on that hostname. An HTTPS deployment with a public hostname accepts only its configured origin, uses Secure cookies, and should preserve the original Host and scheme through its reverse proxy. Both processes must use the same database path. Serve this Node application on a trusted host; database, backups, and thumbnail files are private server files.

## Remote MCP with OAuth

Connect an MCP client to `http://localhost:3000/mcp`, or `${LISTO_ORIGIN}/mcp` on your HTTPS host. The web application must be running. A remote client needs a reachable HTTPS hostname; its `localhost` refers to its own machine.

The server advertises protected-resource and authorization-server metadata. Clients use dynamic registration with public-client authentication (`none`), authorization code with PKCE S256, and the exact MCP URL as the OAuth `resource` in authorization and token requests. HTTPS and loopback callback URLs are accepted after exact registration matching. Client ID Metadata Document fetching is not advertised; dynamic registration is the supported discovery-compatible registration path.

- `listo:read` permits `list_lists` and `get_list`.
- `listo:write` permits `add_item`.
- Access tokens last one hour. Refresh tokens rotate and last 30 days; reuse revokes the grant.
- `/profile` lists connected applications and revokes access immediately.
- Password changes/recovery revoke all connections.

Local stdio remains a trusted operator integration and requires an explicit `LISTO_MCP_USER`. It does not use browser cookies or OAuth. Remote HTTP never falls back to a configured local user.

## Migration and rollback

Before upgrading an existing installation, stop the web app, MCP clients, and worker, and take a consistent SQLite backup plus a copy of the thumbnail directory. The migration also saves a `*.before-accounts-*.sqlite` backup before the ownership schema is first applied. It rebuilds related tables transactionally, checks foreign keys, and retains record IDs, ordering, metadata, timestamps, and jobs. The application uses `inbox` as a per-user logical API alias; each user's actual database Inbox ID is unique.

For rollback, stop all writers, restore the matching database and thumbnails with the prior application version, and restart. Do not run old and new application versions against the same database. In this checkout, the verified activation snapshot and backup are under ignored `data/backups/`.

The older `.openai/hosting.json` configuration belongs to a separate Cloudflare Sites deployment. This implementation targets the current Node/SQLite application; publishing it there requires a separate D1/R2 storage and worker migration. Do not publish the old `dist` output as if it contains these account changes.


## Browser regression tests

```sh
npx playwright install chromium
npm run test:e2e
# Optional interactive test runner:
npm run test:e2e:ui
```

The Playwright suite uses real Chromium against a temporary copy of the Next.js app and a fresh SQLite database on port 3100. It never reuses the running personal app, loads its `.env`, or runs the enrichment worker. The suite maps the LAN hostnames to loopback inside the test browser, so local DNS setup is unnecessary.

Tests run against `localhost`, `127.0.0.1`, `jdsrv`, and `jdsrv.local`, checking login and return URLs, host-scoped cookies, incorrect-password feedback, password-recovery navigation, saved lists after reload, logout, protected routes, and rejection of cross-site login forms. Origin unit tests also cover forged proxy headers, unsupported hosts/ports, and HTTPS cookies. Traces and screenshots are saved on failure in ignored test-report directories.

GitHub Actions runs the unit/integration suite, lint, production build, and browser suite on pushes to main and pull requests. These tests cover authentication flows in Chromium; they are not yet full cross-browser or whole-app coverage.
