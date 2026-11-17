import { Accounts } from "@/lib/auth/accounts";
import { authError, go, requestToken, sameOrigin } from "@/lib/auth/http";
import { requestOrigin } from "@/lib/auth/origins";
import { SpotifyConnections } from "@/lib/auth/spotify-connections";

type Context = { params: Promise<{ action: string }> };
const profile = (status: string) => go(`/profile?spotify=${status}`);
const redirect = (url: URL) => new Response(null, {
  status: 303, headers: { location: url.href, "cache-control": "no-store", "referrer-policy": "no-referrer" },
});

export async function POST(request: Request, { params }: Context) {
  try { sameOrigin(request); } catch { return authError("Invalid request origin", 403); }
  const session = requestToken(request);
  const accounts = new Accounts();
  const user = accounts.session(session);
  if (!user || !session) return authError("Sign in required", 401);
  const connections = new SpotifyConnections(accounts.db);
  const { action } = await params;
  if (action === "disconnect") {
    connections.disconnect(user.id);
    return profile("disconnected");
  }
  if (action !== "connect") return authError("Unknown action", 404);
  try { return redirect(connections.start(user.id, session, requestOrigin(request))); }
  catch { return profile("unavailable"); }
}

export async function GET(request: Request, { params }: Context) {
  let browserOrigin: string;
  try { browserOrigin = requestOrigin(request); } catch { return authError("Invalid request origin", 403); }
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const accounts = new Accounts();
  const connections = new SpotifyConnections(accounts.db);
  const { action } = await params;
  if (action === "callback") {
    try {
      const next = connections.callback(state, browserOrigin, url.searchParams.has("error") ? null : url.searchParams.get("code"));
      return next ? redirect(next) : profile("invalid");
    } catch { return profile("failed"); }
  }
  if (action === "finish") {
    const session = requestToken(request);
    const user = accounts.session(session);
    if (!user || !session) return profile("invalid");
    try {
      return profile(await connections.finish(user.id, session, browserOrigin, state, fetch,
        AbortSignal.any([request.signal, AbortSignal.timeout(15_000)])));
    } catch { return profile("failed"); }
  }
  return authError("Unknown action", 404);
}
