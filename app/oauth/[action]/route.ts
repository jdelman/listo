import { limitedBody, authError, origin, requestUser, sameOrigin } from "@/lib/auth/http";
import { OAuthService } from "@/lib/auth/oauth";
const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "Content-Type, Authorization", "cache-control": "no-store" };
export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const service = new OAuthService(origin());
  try {
    const body = await limitedBody(request, 16384);
    if (body.length > 16384) return authError("Request too large", 413);
    if (action === "register") return Response.json(service.register(JSON.parse(body)), { status: 201, headers: cors });
    const form = new URLSearchParams(body);
    if ([...new Set(form.keys())].some(key => form.getAll(key).length !== 1)) throw new Error("Duplicate parameter");
    if (action === "consent") {
      sameOrigin(request);
      const user = requestUser(request);
      if (!user) return authError("Sign in required", 401);
      const location = await service.authorize(form, user, form.get("decision") === "allow");
      return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
    }
    if (action === "token") return Response.json(await service.token(form, Object.fromEntries(request.headers)), { headers: cors });
    if (action === "revoke") {
      service.revoke(form.get("token") || "", form.get("client_id") || "");
      return Response.json({}, { headers: cors });
    }
    return authError("Unknown endpoint", 404);
  } catch (error) {
    const code = error instanceof Error && ["invalid_grant", "invalid_client", "invalid_scope", "unauthorized_client", "unsupported_grant_type", "access_denied"].includes(error.name) ? error.name : "invalid_request";
    return Response.json({ error: code, error_description: "The authorization request is invalid, expired, or revoked." }, { status: 400, headers: cors }); }
}
