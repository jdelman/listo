import { applicationLog } from "@/lib/logging";

export const runtime = "nodejs";
const descriptions: Record<string, string> = {
  activate: "Activated control", change: "Changed form field", submit: "Submitted form",
  drop: "Dropped item", navigate: "Opened page",
};

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  try {
    const body = await request.text();
    if (body.length > 2048) return new Response(null, { status: 413 });
    const { action, control, path } = JSON.parse(body);
    if (typeof action !== "string" || !Object.hasOwn(descriptions, action)
      || typeof path !== "string" || !path.startsWith("/") || path.length > 512 || /[?#]/.test(path)
      || (control !== undefined && (typeof control !== "string" || control.length > 120))) {
      return new Response(null, { status: 400 });
    }
    applicationLog(`browser.${action}`, descriptions[action], { control, path, outcome: "observed" });
    return new Response(null, { status: 204 });
  } catch { return new Response(null, { status: 400 }); }
}
