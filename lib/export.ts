import type { Item, List } from "./types";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] ?? character));

function renderItem(item: Item) {
  const tags = item.tags.length ? `<p class="tags">${item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join(" ")}</p>` : "";
  let content = item.description ? `<p>${escapeHtml(item.description)}</p>` : "";
  if (item.type === "note") content += `<div class="note">${escapeHtml(item.metadata.markdown).replace(/\n/g, "<br>")}</div>`;
  if (item.type === "url" || item.type === "media") content += `<p><a href="${escapeHtml(item.sourceUrl)}">${escapeHtml(item.sourceUrl)}</a></p>`;
  if (item.type === "image" && item.metadata.dataUrl) content += `<img src="${item.metadata.dataUrl}" alt="${escapeHtml(item.title)}">`;
  if (item.type === "pdf" && item.metadata.dataUrl) content += `<p><a download="${escapeHtml(item.metadata.fileName)}" href="${item.metadata.dataUrl}">Open included PDF</a></p>`;
  if (item.type === "movie") content += `<p>${item.metadata.year ?? ""}${item.metadata.tmdbId ? ` · TMDB ${item.metadata.tmdbId}` : ""}</p>`;
  if (item.type === "clothing") {
    if (item.metadata.dataUrl) content += `<img src="${item.metadata.dataUrl}" alt="${escapeHtml(item.title)}">`;
    content += `<p><strong>Size:</strong> ${escapeHtml(item.metadata.size || "—")}</p>`;
    content += `<dl>${(item.metadata.measurements ?? []).map((measurement) => `<div><dt>${escapeHtml(measurement.name)}</dt><dd>${escapeHtml(measurement.value)}${measurement.unit ? ` ${measurement.unit}` : ""}</dd></div>`).join("")}</dl>`;
  }
  return `<article><small>${escapeHtml(item.type)}</small><h2>${escapeHtml(item.title)}</h2>${content}${tags}</article>`;
}

export function exportList(list: List, items: Item[]) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(list.title)}</title>
<style>body{font-family:"Times New Roman",serif;max-width:800px;margin:0 auto;padding:24px;line-height:1.4;color:#111}header{border-bottom:2px solid;padding-bottom:16px;margin-bottom:24px}article{border:1px solid #999;padding:16px;margin:0 0 16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}h1,h2,p{margin-top:0}.tags span{border:1px solid #999;padding:2px 6px}dl div{display:grid;grid-template-columns:minmax(100px,1fr) 2fr;border-top:1px solid #ccc;padding:4px 0}dt{text-transform:capitalize}dd{margin:0}@media(max-width:520px){body{padding:12px}article{padding:12px}}</style></head>
<body><header><h1>${escapeHtml(list.title)}</h1><p>${escapeHtml(list.description)}</p></header><main>${items.map(renderItem).join("\n")}</main><footer><small>Exported from Listo</small></footer></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${list.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "list"}.html`;
  anchor.click();
  URL.revokeObjectURL(url);
}
