import { getSession } from "../../../lib/session";
import { listSpreadsheets } from "../../../lib/google";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: "not signed in" }, { status: 401 });
  try {
    return Response.json({ files: await listSpreadsheets(s) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
