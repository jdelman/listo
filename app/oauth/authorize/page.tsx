import Link from "next/link";
import { pageUser, origin } from "@/lib/auth/http";
import { OAuthService } from "@/lib/auth/oauth";
export const dynamic = "force-dynamic";
export const metadata = { title: "Connect application — Listo", referrer: "no-referrer" };
export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = new URLSearchParams(Object.entries(await searchParams).filter((pair): pair is [string, string] => typeof pair[1] === "string"));
  const user = await pageUser(`/oauth/authorize?${params}`);
  let details;
  try { details = new OAuthService(origin()).authorization(params); } catch { return <main className="shell account-shell"><h1>Unable to connect</h1><p>This application sent an invalid authorization request.</p><Link prefetch={false} href="/profile">Back to profile</Link></main>; }
  return <main className="shell account-shell"><Link prefetch={false} className="brand" href="/lists">Listo</Link><section className="panel account-panel"><h1>Connect {details.client.client_name}?</h1><p>Signed in as <strong>{user.username}</strong>.</p><p>This application is requesting permission to:</p><ul>{details.scopes.includes("listo:read") && <li>Read your lists, items, and tags.</li>}{details.scopes.includes("listo:write") && <li>Add items to your lists.</li>}</ul><p>Return address: {new URL(params.get("redirect_uri")!).origin}</p><form action="/oauth/consent" method="post" className="actions">{["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "resource", "scope", "state"].map(key => <input key={key} type="hidden" name={key} value={params.get(key) || (key === "scope" ? "listo:read" : "")} />)}<button className="primary" name="decision" value="allow">Allow access</button><button name="decision" value="deny">Cancel</button></form></section></main>;
}
