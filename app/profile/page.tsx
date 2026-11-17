import Link from "next/link";
import { Accounts } from "@/lib/auth/accounts";
import { pageUser } from "@/lib/auth/http";
import { SpotifyConnections } from "@/lib/auth/spotify-connections";
import { spotifyConfigured } from "@/lib/processing/spotify-auth";
export const dynamic = "force-dynamic";
const spotifyMessages: Record<string, string> = {
  connected: "Spotify connected.",
  disconnected: "Spotify disconnected.",
  denied: "Spotify authorization was declined.",
  invalid: "This Spotify connection request expired or belongs to a different session. Start again from Profile.",
  unavailable: "Spotify requires app credentials and an HTTPS or loopback Listo address.",
  failed: "Spotify could not be connected. Check the registered callback address and app settings, then try again.",
};

export const metadata = { title: "Profile — Listo" };
export default async function Profile({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await pageUser(), params = await searchParams;
  const { db } = new Accounts();
  const spotifyConnected = new SpotifyConnections(db).connected(user.id);
  const canConnectSpotify = spotifyConfigured();
  const spotifyMessage = params.spotify && Object.hasOwn(spotifyMessages, params.spotify) ? spotifyMessages[params.spotify] : undefined;
  const grants = db.prepare("SELECT g.id, g.scope, c.data FROM oauth_grants g JOIN oauth_clients c ON c.id=g.client_id WHERE g.user_id=? AND g.revoked=0 ORDER BY g.created_at DESC").all(user.id) as { id: string; scope: string; data: string }[];
  return <main className="shell account-shell"><Link prefetch={false} className="brand" href="/lists">Listo</Link><section className="panel account-panel"><h1>Profile</h1><p>Signed in as <strong>{user.username}</strong></p>
    {params.error && <p role="alert" className="error-banner">{params.error}</p>}
    <h2>Change password</h2><form action="/api/auth/password" method="post" className="account-form">
      <label>Current password<input type="password" name="currentPassword" autoComplete="current-password" required maxLength={256} /></label>
      <label>New password<input type="password" name="password" autoComplete="new-password" required minLength={10} maxLength={256} /></label>
      <p>Use at least 10 characters. Changing your password signs out all sessions and disconnects connected applications.</p>
      <button className="primary">Change password</button></form>
    <h2>Connected applications</h2>
    {spotifyMessage && <p role="status">{spotifyMessage}</p>}
    <div className="account-grant">
      <div><strong>Spotify</strong><p>{spotifyConnected ? "Connected for playlist import" : canConnectSpotify ? "Connect to import your Spotify playlists" : "Spotify app credentials are required"}</p></div>
      <div className="actions">
        <form action="/api/spotify/connect" method="post"><button disabled={!canConnectSpotify}>{spotifyConnected ? "Reconnect" : "Connect"}</button></form>
        {spotifyConnected && <form action="/api/spotify/disconnect" method="post"><button>Disconnect</button></form>}
      </div>
    </div>
    {grants.map(grant => <div className="account-grant" key={grant.id}><div><strong>{JSON.parse(grant.data).client_name || "MCP application"}</strong><p>{grant.scope.includes("write") ? "Read and add items" : "Read lists and items"}</p></div><form action="/api/auth/revoke" method="post"><input type="hidden" name="grantId" value={grant.id} /><button>Revoke access</button></form></div>)}
    <form action="/logout" method="post"><button>Log out</button></form><Link prefetch={false} href="/lists">Back to lists</Link>
  </section></main>;
}
