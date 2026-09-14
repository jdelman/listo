import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Accounts } from "@/lib/auth/accounts";
import { COOKIE, safeReturn } from "@/lib/auth/http";
export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in — Listo" };
export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  if (new Accounts().session((await cookies()).get(COOKIE)?.value)) redirect(safeReturn(params.returnTo));
  return <main className="shell account-shell"><Link prefetch={false} className="brand" href="/">Listo</Link><section className="panel account-panel"><h1>Sign in</h1>
    {params.error && <p role="alert" className="error-banner">{params.error}</p>}{params.message && <p role="status">{params.message}</p>}
    <form action="/api/auth/login" method="post" className="account-form">
      <input type="hidden" name="returnTo" value={safeReturn(params.returnTo)} />
      <label>Username<input name="username" autoComplete="username" required maxLength={64} autoFocus /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={256} /></label>
      <button className="primary" type="submit">Sign in</button>
    </form><Link prefetch={false} href="/reset-password">Forgot your password?</Link>
  </section></main>;
}
