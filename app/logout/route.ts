import { Accounts } from "@/lib/auth/accounts";
import { authError, go, requestToken, sameOrigin, sessionCookie } from "@/lib/auth/http";
export async function POST(request: Request) {
  try { sameOrigin(request); } catch { return authError("Invalid request origin", 403); }
  new Accounts().logout(requestToken(request));
  const response = go("/login", sessionCookie("", true));
  response.headers.set("Clear-Site-Data", '"cache"');
  return response;
}
