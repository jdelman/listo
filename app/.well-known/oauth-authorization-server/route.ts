import { origin } from "@/lib/auth/http";
import { SCOPES } from "@/lib/auth/oauth";
export async function GET() {
  const issuer = origin();
  return Response.json({ issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, registration_endpoint: `${issuer}/oauth/register`, revocation_endpoint: `${issuer}/oauth/revoke`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: SCOPES }, { headers: { "access-control-allow-origin": "*" } });
}
