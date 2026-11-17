/** Split plain text and Markdown links without interpreting HTML. */
export function textLinks(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  const patterns = /\[([^\][\n]+)\]\((https?:\/\/(?:[^()\s<>]|\([^()\s<>]*\))+)\)|\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
  let cursor = 0;
  for (const match of text.matchAll(patterns)) {
    const [raw, label, markdownUrl] = match;
    let value = markdownUrl ?? raw.replace(/[.,!?;:]+$/, "");
    if (!markdownUrl) {
      const opens = value.split("(").length - 1;
      let excessCloses = value.split(")").length - 1 - opens;
      while (excessCloses > 0 && value.endsWith(")")) {
        value = value.slice(0, -1);
        excessCloses--;
      }
      value = value.replace(/[\]}]+$/, "");
    }
    const href = /^www\./i.test(value) ? `https://${value}` : value;
    if (!URL.canParse(href)) continue;
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
    parts.push({ text: label ?? value, href });
    cursor = match.index + (markdownUrl ? raw.length : value.length);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
