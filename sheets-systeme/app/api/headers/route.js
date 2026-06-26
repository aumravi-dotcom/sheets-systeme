import { getSession } from "../../../lib/session";
import { readHeaders } from "../../../lib/google";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const s = await getSession();
  if (!s) return Response.json({ error: "not signed in" }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const fileId = p.get("fileId");
  const tab = p.get("tab");
  const headerRow = Number(p.get("headerRow") || 1);
  if (!fileId || !tab) return Response.json({ error: "fileId and tab required" }, { status: 400 });
  try {
    return Response.json({ headers: await readHeaders(s, fileId, tab, headerRow) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
