import { getSession } from "../../../lib/session";
import { kv, keys } from "../../../lib/kv";
import { readAll } from "../../../lib/google";
import { upsertContact } from "../../../lib/systeme";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 25;

function toTime(v) {
  if (typeof v === "number") {
    // Google Sheets serial date -> ms (epoch 1899-12-30).
    return Math.round((v - 25569) * 86400 * 1000);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// Body: { token, offset }
export async function POST(req) {
  const s = await getSession();
  if (!s) return Response.json({ error: "not signed in" }, { status: 401 });
  const b = await req.json();
  const conn = await kv.get(keys.connection(b.token));
  if (!conn || conn.owner !== s.sub) return Response.json({ error: "not found" }, { status: 404 });
  if (!conn.systemeKey) return Response.json({ error: "no systeme.io key set" }, { status: 400 });

  const offset = Number(b.offset || 0);
  let values;
  try {
    values = await readAll(s, conn.fileId, conn.tab);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }

  const hRow = Number(conn.headerRow || 1);
  const headers = values[hRow - 1] || [];
  const dataRows = values.slice(hRow);

  // Build row objects keyed by header.
  let objs = dataRows.map((arr) => {
    const o = {};
    headers.forEach((h, i) => { o[h] = arr[i]; });
    return o;
  });

  // Oldest -> newest.
  if (conn.dateColumn) {
    objs = objs
      .map((o, i) => ({ o, t: toTime(o[conn.dateColumn]), i }))
      .sort((a, x) => a.t - x.t || a.i - x.i)
      .map((e) => e.o);
  }

  const total = objs.length;
  const slice = objs.slice(offset, offset + BATCH);
  const tagCache = {};
  const results = [];
  for (const o of slice) {
    try {
      results.push(await upsertContact(conn, o, tagCache));
    } catch (e) {
      results.push({ status: "error: " + e.message, id: null });
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  const nextOffset = offset + slice.length < total ? offset + slice.length : null;
  return Response.json({ total, processed: offset + slice.length, nextOffset, results });
}
