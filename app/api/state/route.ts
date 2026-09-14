import { requestUser, authError } from "@/lib/auth/http";
import { getLocalBackend } from "@/lib/backend/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = requestUser(request);
  if (!user) return authError("Sign in required", 401);
  return Response.json(getLocalBackend(user.id).getDatabase(), {
    headers: { "cache-control": "no-store", "x-listo-user": user.username },
  });
}
