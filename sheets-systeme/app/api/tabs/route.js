import { getSession } from "../../../lib/session";
import { listTabs } from "../../../lib/google";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const s = await getSession();
  if (!s) return Response.json({ error: "not signed in" }, { status: 401 });
  const fileId = new URL(req.url).searchParams.get("fileId");
  if (!fileId) return Response.json({ error: "fileId required" }, { status: 400 });
  try {
    return Response.json({ tabs: await listTabs(s, fileId) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
