import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/mcp/server";
import { getLocalBackend } from "@/lib/backend/local";
import { limitedBody, origin } from "@/lib/auth/http";
import { OAuthService } from "@/lib/auth/oauth";
const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, DELETE, OPTIONS", "access-control-allow-headers": "Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id", "access-control-expose-headers": "WWW-Authenticate", "cache-control": "no-store" };
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }
async function handle(request: Request) {
  const issuer = origin(), service = new OAuthService(issuer);
  const rawToken = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]+)$/i)?.[1];
  const auth = rawToken ? service.access(rawToken) : null;
  if (!auth) return Response.json({ error: "unauthorized" }, { status: 401, headers: { ...cors, "WWW-Authenticate": `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp", scope="listo:read listo:write"` } });
  const sentOrigin = request.headers.get("origin");
  const clientOrigins = service.client(auth.clientId)?.redirect_uris.map(uri => new URL(uri).origin) || [];
  if (sentOrigin && sentOrigin !== issuer && !clientOrigins.includes(sentOrigin)) return new Response(null, { status: 403 });
  let parsedBody: unknown;
  if (request.method === "POST") {
    let raw: string;
    try { raw = await limitedBody(request, 1_000_000); } catch { return new Response(null, { status: 413, headers: cors }); }
    if (raw.length > 1_000_000) return new Response(null, { status: 413, headers: cors });
    try { parsedBody = JSON.parse(raw); } catch { return Response.json({ error: "invalid_request" }, { status: 400, headers: cors }); }
    const message = parsedBody as { method?: string; params?: { name?: string } } | null;
    const scope = message?.method === "tools/call" ? (message.params?.name === "add_item" ? "listo:write" : "listo:read") : undefined;
    if (scope && !auth.scopes.includes(scope)) return Response.json({ error: "insufficient_scope" }, { status: 403, headers: { ...cors, "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${scope}", resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"` } });
  }
  // Stateless transport: every request is independently authenticated, with no session-ID bypass.
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  const server = createMcpServer(getLocalBackend(auth.userId), auth.scopes);
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request, { parsedBody, authInfo: { token: rawToken!, clientId: auth.clientId, scopes: auth.scopes, expiresAt: auth.expiresAt, resource: new URL(service.resource) } });
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  } finally { await server.close(); }
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
