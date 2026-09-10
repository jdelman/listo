# Application and worker logs

Listo writes newline-delimited JSON to stderr and append-only files:

- `data/logs/application.log`: shared storage actions from the web app and MCP, including state reads, list/item creation, edits, deletion, import, memberships, ordering, and enrichment saves. Each entry has a short description, outcome, duration, and available IDs.
- `data/logs/worker.log`: worker startup, shutdown, fatal errors, job claims, attempts, source fetches, model requests, validation, completion, retries, and queue errors.

Set `LISTO_LOG_DIR` in `.env.local` to change the directory. The default lives in the ignored data directory. Keep a custom directory outside source control. Both processes must use the same configuration. Logs append across restarts. They are not automatically rotated; archive or remove old files as needed.

Watch live worker events with `tail -f data/logs/worker.log`, or start both processes with `npm run dev`. For production use `npm run build` followed by `npm start`. `next dev` alone does not run the worker. Application logging uses stderr so it cannot corrupt MCP's stdout protocol.

Logs omit command payloads, page bodies, prompts, uploaded data, and model responses. Known environment credentials are redacted from error messages. File-write failures are reported to stderr without failing a successful application operation. Browser interactions (control activation, field changes, submission, navigation, and drag/drop) are also recorded as observed events, with the path and control label. Field values and query strings are omitted. These best-effort events describe user intent; storage events separately establish whether a mutation succeeded. Local export is visible as an Export HTML activation.

## Investigating processing

Find the item's `itemId` in both files, then follow its `jobId` in worker logs. `job.started` includes the attempt number; `job.failed` reports the error and whether another retry is scheduled. A queued job with zero attempts has never been claimed. A watcher process alone does not establish that its child worker is alive: look for `worker.ready`, subsequent job events, or `worker.fatal`. Queue errors are logged and retried instead of terminating the processing loop. Startup failures remain fatal and are recorded before exit.

On September 10, 2026, item `e271724c-9155-4dc5-9219-162ac3e9bd79` (`propercloth.com`) in list `821ee3dd-889f-4b55-b1eb-5234ebb17425` had job `5f87a32e-5215-47b3-a382-d5853ffe7b8d` queued since `19:44:09Z`, with zero attempts and no stored error. The `tsx watch` supervisor existed but no worker child was running. The configured OpenRouter key was present at diagnosis time. Historical worker output was not persisted, so the earlier exit's cause cannot be established from available evidence.
