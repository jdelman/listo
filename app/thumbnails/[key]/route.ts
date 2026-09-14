import { requestUser } from "@/lib/auth/http";
import { ownsThumbnail } from "@/lib/auth/thumbnails";
import { FileThumbnailStorage } from "../../../lib/storage/thumbnail-storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const user = requestUser(_request);
  if (!user) return new Response(null, { status: 401 });
  const key = (await params).key;
  if (!ownsThumbnail(user.id, `/thumbnails/${key}`)) return new Response(null, { status: 404 });
  const file = await new FileThumbnailStorage().read(key);
  if (!file) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(file.bytes), { headers: {
    "Content-Type": file.contentType,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
