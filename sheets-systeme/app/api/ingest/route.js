import { kv, keys } from "../../../lib/kv";
import { upsertContact } from "../../../lib/systeme";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Body: { token: string, rows: Array<{ [header]: value }> }
export async function POST(req) {
  let b;
  try { b = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const token = b.token;
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (!token) return Response.json({ error: "token required" }, { status: 400 });

  const conn = await kv.get(keys.connection(token));
  if (!conn) return Response.json({ error: "unknown token" }, { status: 401 });
  if (!conn.systemeKey) return Response.json({ error: "no systeme.io key set for this connection" }, { status: 400 });

  const tagCache = {};
  const results = [];
  for (const row of rows) {
    try {
      results.push(await upsertContact(conn, row, tagCache));
    } catch (e) {
      results.push({ status: "error: " + e.message, id: null });
    }
  }
  return Response.json({ ok: true, results });
}
