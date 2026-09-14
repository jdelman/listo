// The local browser hostnames also feed Next's development-origin configuration.
export const LOCAL_BROWSER_HOSTS = ["localhost", "127.0.0.1", "[::1]", "jdsrv", "jdsrv.local"];

export function origin() {
  const url = new URL(process.env.LISTO_ORIGIN || "http://localhost:3000");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_BROWSER_HOSTS.includes(url.hostname))) throw new Error("LISTO_ORIGIN must use HTTPS outside the local installation");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("LISTO_ORIGIN must be an origin without a path or credentials");
  return url.origin;
}

export function requestOrigin(request: Request) {
  const configured = new URL(origin());
  const allowed = new Set([configured.origin]);
  // Keep the existing LAN aliases working for the local installation. A configured
  // public deployment accepts only its canonical origin, not arbitrary hostnames.
  if (LOCAL_BROWSER_HOSTS.includes(configured.hostname)) {
    for (const hostname of LOCAL_BROWSER_HOSTS) {
      const alias = new URL(configured);
      alias.hostname = hostname;
      allowed.add(alias.origin);
    }
  }
  const url = new URL(request.url);
  // Next may use its internal hostname in request.url; Host is the browser's
  // destination. Validate it against the allowlist; never trust forwarded-host.
  const host = request.headers.get("host") || url.host;
  const candidate = `${url.protocol}//${host}`;
  if (!allowed.has(candidate)) throw new Error("Invalid request origin");
  return candidate;
}

export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== requestOrigin(request)) throw new Error("Invalid request origin");
}
