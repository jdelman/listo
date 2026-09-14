import Link from "next/link";
import { Accounts } from "@/lib/auth/accounts";
import { pageUser } from "@/lib/auth/http";
export const dynamic = "force-dynamic";
export const metadata = { title: "Profile — Listo" };
export default async function Profile({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await pageUser(), params = await searchParams;
  const grants = new Accounts().db.prepare("SELECT g.id, g.scope, c.data FROM oauth_grants g JOIN oauth_clients c ON c.id=g.client_id WHERE g.user_id=? AND g.revoked=0 ORDER BY g.created_at DESC").all(user.id) as { id: string; scope: string; data: string }[];
  return <main className="shell account-shell"><Link prefetch={false} className="brand" href="/lists">Listo</Link><section className="panel account-panel"><h1>Profile</h1><p>Signed in as <strong>{user.username}</strong></p>
    {params.error && <p role="alert" className="error-banner">{params.error}</p>}
    <h2>Change password</h2><form action="/api/auth/password" method="post" className="account-form">
      <label>Current password<input type="password" name="currentPassword" autoComplete="current-password" required maxLength={256} /></label>
      <label>New password<input type="password" name="password" autoComplete="new-password" required minLength={10} maxLength={256} /></label>
      <p>Use at least 10 characters. Changing your password signs out all sessions and disconnects connected applications.</p>
      <button className="primary">Change password</button></form>
    <h2>Connected applications</h2>{grants.length ? grants.map(grant => <div className="account-grant" key={grant.id}><div><strong>{JSON.parse(grant.data).client_name || "MCP application"}</strong><p>{grant.scope.includes("write") ? "Read and add items" : "Read lists and items"}</p></div><form action="/api/auth/revoke" method="post"><input type="hidden" name="grantId" value={grant.id} /><button>Revoke access</button></form></div>) : <p>No applications connected.</p>}
    <form action="/logout" method="post"><button>Log out</button></form><Link prefetch={false} href="/lists">Back to lists</Link>
  </section></main>;
}
