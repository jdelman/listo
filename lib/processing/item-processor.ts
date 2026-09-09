import { decodeHTML } from "entities";
import type { JobProcessor } from "./contracts";
import type { Item } from "../types";

export class ItemEnrichmentProcessor implements JobProcessor {
  readonly kind = "process-item" as const;

  async process(item: Item, signal: AbortSignal) {
    const attributes: Record<string, string | number | string[]> = {
      itemType: item.type,
      tagCount: item.tags.length,
    };
    let sourceText = [item.title, item.description, item.metadata.markdown].filter(Boolean).join(" ");

    if (item.sourceUrl) {
      const url = new URL(item.sourceUrl);
      attributes.sourceHost = url.hostname.replace(/^www\./, "");
    }

    if (item.type === "url" && item.sourceUrl) {
      const response = await fetch(item.sourceUrl, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
        headers: { "user-agent": "Listo/0.2 metadata worker" },
      });
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
      const html = await response.text();
      const title = matchHtml(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      const description = matchHtml(html, /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["'][^>]*>/i)
        || matchHtml(html, /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*>/i);
      if (title) attributes.fetchedTitle = title;
      if (description) attributes.fetchedDescription = description;
      sourceText = [title, description, stripHtml(html).slice(0, 8_000)].filter(Boolean).join(" ");
    }

    if (item.type === "clothing") {
      attributes.size = item.metadata.size || "";
      attributes.measurements = (item.metadata.measurements ?? []).map((measurement) => `${measurement.name}: ${measurement.value}${measurement.unit ? ` ${measurement.unit}` : ""}`);
    }

    if (item.type === "movie" && item.metadata.year) attributes.year = item.metadata.year;
    if (item.type === "media" && item.metadata.platform) attributes.platform = item.metadata.platform;
    attributes.wordCount = words(sourceText).length;

    return {
      summary: summarize(sourceText || item.title),
      attributes,
      processedAt: new Date().toISOString(),
      processorVersion: "local-rules-v1",
    };
  }
}

function summarize(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return "No textual content was available to summarize.";
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [clean];
  const summary = sentences.slice(0, 2).join(" ").trim();
  return summary.length > 420 ? `${summary.slice(0, 417).trimEnd()}…` : summary;
}

function words(value: string) { return value.trim() ? value.trim().split(/\s+/) : []; }
function matchHtml(html: string, pattern: RegExp) {
  const value = pattern.exec(html)?.[1];
  return value ? decodeHtmlText(value.replace(/<[^>]+>/g, " ")) : "";
}

function stripHtml(html: string) {
  return decodeHtmlText(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function decodeHtmlText(value: string) {
  // Decode entities on both sides so entity-encoded percent signs and URL-encoded
  // entities both become text. Preserve malformed escapes without losing valid ones.
  const decoded = decodeHTML(value).replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
    try { return decodeURIComponent(encoded); }
    catch { return encoded.replace(/(?:%[0-7][0-9a-f]|%[c-d][0-9a-f]%[89ab][0-9a-f]|%e[0-9a-f](?:%[89ab][0-9a-f]){2}|%f[0-4](?:%[89ab][0-9a-f]){3})/gi, (part) => {
      try { return decodeURIComponent(part); } catch { return part; }
    }); }
  });
  return decodeHTML(decoded).replace(/\s+/g, " ").trim();
}
