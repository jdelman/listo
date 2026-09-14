import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Accounts, SESSION_SECONDS } from "./accounts";

export const COOKIE = "listo_session";
export function origin() {
  const url = new URL(process.env.LISTO_ORIGIN || "http://localhost:3000");
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("LISTO_ORIGIN must use HTTPS");
  return url.origin;
}
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== origin()) throw new Error("Invalid request origin");
}
export function safeReturn(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return "/lists";
  return value;
}
export function requestToken(request: Request) {
  return request.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}
export function requestUser(request: Request) { return new Accounts().session(requestToken(request)); }
export async function pageUser(returnTo = "/profile") {
  const user = new Accounts().session((await cookies()).get(COOKIE)?.value);
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(safeReturn(returnTo))}`);
  return user;
}
export function sessionCookie(token: string, expires = false) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expires ? 0 : SESSION_SECONDS}${origin().startsWith("https:") ? "; Secure" : ""}`;
}
export function go(path: string, cookie?: string) {
  const headers = new Headers({ location: new URL(path, origin()).href, "cache-control": "no-store" });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}
export function authError(message: string, status = 400) { return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } }); }

export async function limitedBody(request: Request, maxBytes: number) {
  if (!request.body) return "";
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Request too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
