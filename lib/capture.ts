import type { ItemType } from "./types";

export function classify(value: string, file?: Pick<File, "name" | "type"> | null): ItemType {
  if (file?.type.startsWith("image/")) return "image";
  if (file?.type === "application/pdf" || file?.name.toLowerCase().endsWith(".pdf")) return "pdf";
  if (/youtu\.be|youtube\.com|music\.apple\.com|soundcloud\.com/i.test(value)) return "media";
  if (/\.pdf(?:$|[?#])/i.test(value)) return "pdf";
  if (/^https?:\/\//i.test(value.trim())) return "url";
  return "note";
}

export function mediaPlatform(value: string) {
  if (/youtu\.be|youtube\.com/i.test(value)) return "youtube" as const;
  if (/music\.apple\.com/i.test(value)) return "apple_music" as const;
  if (/soundcloud\.com/i.test(value)) return "soundcloud" as const;
  return "other" as const;
}

export function youtubeId(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname.includes("youtu.be")) return url.pathname.slice(1).split("/")[0];
    return url.searchParams.get("v") ?? url.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/)?.[1];
  } catch { return undefined; }
}

export function hostname(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ""); }
  catch { return value; }
}
