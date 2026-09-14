import { Accounts } from "@/lib/auth/accounts";
import { limitedBody, authError, go, requestUser, safeReturn, sameOrigin, sessionCookie } from "@/lib/auth/http";

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try { sameOrigin(request); } catch { return authError("Invalid request origin", 403); }
  const { action } = await params;
  if (Number(request.headers.get("content-length")) > 16384) return authError("Request too large", 413);
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return authError("Invalid form", 400);
  let form: URLSearchParams;
  try { form = new URLSearchParams(await limitedBody(request, 16384)); } catch { return authError("Request too large", 413); }
  const value = (key: string) => String(form.get(key) || "");
  const accounts = new Accounts();
  try {
    if (action === "login") {
      const token = await accounts.login(value("username").trim().slice(0, 64), value("password"));
      if (!token) return go(`/login?error=${encodeURIComponent("Username or password is incorrect.")}&returnTo=${encodeURIComponent(safeReturn(value("returnTo")))}`);
      return go(safeReturn(value("returnTo")), sessionCookie(token, false, request));
    }
    if (action === "reset") {
      await accounts.resetPassword(value("token"), value("password"));
      return go("/login?message=Password+updated.+Sign+in+with+your+new+password.", sessionCookie("", true, request));
    }
    const user = requestUser(request);
    if (!user) return authError("Sign in required", 401);
    if (action === "password") {
      await accounts.changePassword(user.id, value("currentPassword"), value("password"));
      return go("/login?message=Password+updated.+Please+sign+in+again.", sessionCookie("", true, request));
    }
    if (action === "revoke") {
      accounts.db.prepare("UPDATE oauth_grants SET revoked=1 WHERE id=? AND user_id=?").run(value("grantId"), user.id);
      return go("/profile");
    }
    return authError("Unknown action", 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Please try again.";
    if (action === "login") return go(`/login?error=${encodeURIComponent(message)}&returnTo=${encodeURIComponent(safeReturn(value("returnTo")))}`);
    if (action === "reset") return go(`/reset-password?error=${encodeURIComponent(message)}`);
    return go(`/profile?error=${encodeURIComponent(message)}`);
  }
}
