import { origin } from "@/lib/auth/http";
import { SCOPES } from "@/lib/auth/oauth";
export async function GET() {
  const issuer = origin();
  return Response.json({ resource: `${issuer}/mcp`, authorization_servers: [issuer], scopes_supported: SCOPES, bearer_methods_supported: ["header"], resource_name: "Listo" }, { headers: { "access-control-allow-origin": "*" } });
}
