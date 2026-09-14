import Link from "next/link";
export const dynamic = "force-dynamic";
export const metadata = { title: "Reset password — Listo", referrer: "no-referrer" };
export default async function ResetPassword({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  return <main className="shell account-shell"><Link prefetch={false} className="brand" href="/login">Listo</Link><section className="panel account-panel"><h1>Reset password</h1>
    {params.error && <p role="alert" className="error-banner">{params.error}</p>}
    {params.token ? <form action="/api/auth/reset" method="post" className="account-form"><input type="hidden" name="token" value={params.token} /><label>New password<input name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={256} autoFocus /></label><p>Use at least 10 characters.</p><button className="primary">Set new password</button></form> : <p>Ask your Listo administrator for a recovery link. The link expires after 30 minutes and can be used once.</p>}
    <Link prefetch={false} href="/login">Back to sign in</Link></section></main>;
}
