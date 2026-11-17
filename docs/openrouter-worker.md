# OpenRouter item enrichment

Set `OPENROUTER_KEY` in the worker environment or `.env.local`, then run `npm run worker` (also started by `npm run dev`). The worker loads Next.js environment files at startup and requires a key. Never use a `NEXT_PUBLIC_` variable for the key.

The default model is `openai/gpt-5.6-luna`; `OPENROUTER_MODEL` can override it. The worker sends the source URL, item text, extracted page text and JSON-LD product data to OpenRouter's chat completions endpoint. Page text is capped at 80,000 characters. Image and PDF URLs are supplied as context without downloading binary content; their contents are not analyzed.

The response schema requires `category`, `description`, and `specs`. Categories match the application's item types. Specs include clothing sizes and measurements, price/currency, brand, material, color, movie/media fields and additional named attributes. Unknown values are null or empty arrays. The response is validated before storage.

The description and category (`item.type`) are saved together with specs and processing provenance. Known specs merge into item metadata; additional attributes live in `metadata.derived.attributes`. Existing metadata survives when the model has no replacement value. Revision checks prevent results from overwriting concurrent edits. Failed requests or invalid output use the queue's existing retry policy and do not modify items.

API reference: https://openrouter.ai/docs/guides/features/structured-outputs

## Visible Chrome for eBay

For `ebay.com` and its subdomains, the local worker opens an installed Google Chrome in a visible window and waits for the listing to render. If eBay requests verification, complete it in that window while the worker waits. Each attempt uses a fresh browser session and closes the window after capture or failure.

If Chrome is unavailable, the window is closed, or the listing does not render within the time limit, Listo tries the regular HTTP fetch and uses Exa if that fetch detects a block. Other domains start with the HTTP fetch. To add another domain, enter its hostname and a selector that identifies a loaded page in `lib/processing/visible-chrome.ts`. Worker logs show when Chrome opens, succeeds, or falls back to HTTP.
