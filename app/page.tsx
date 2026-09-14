import { pageUser } from "@/lib/auth/http";
import ListoApp from "./listo-app";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await pageUser("/");
  return <ListoApp key={user.id} username={user.username} />;
}
