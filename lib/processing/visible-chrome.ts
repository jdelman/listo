export const visibleChromeDomains: Readonly<Record<string, string>> = {
  "ebay.com": "h1.x-item-title__mainTitle",
};

export function visibleChromeDomain(url: URL): string | undefined {
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return undefined;
  const hostname = url.hostname.replace(/\.$/, "");
  return Object.keys(visibleChromeDomains).find(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}

export type ReadVisiblePage = (url: string, domain: string, signal: AbortSignal) => Promise<{ url: string; html: string }>;
