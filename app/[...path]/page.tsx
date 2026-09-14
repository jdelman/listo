import { pageUser } from "@/lib/auth/http";
import ListoApp from "../listo-app";
export const dynamic = "force-dynamic";
export default async function AppPage({ params, searchParams }: { params: Promise<{ path: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { path } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, entry);
  const user = await pageUser(`/${path.map(encodeURIComponent).join("/")}${query.size ? `?${query}` : ""}`);
  return <ListoApp key={user.id} username={user.username} />;
}
