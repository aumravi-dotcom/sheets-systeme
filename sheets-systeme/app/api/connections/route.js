import crypto from "crypto";
import { getSession } from "../../../lib/session";
import { kv, keys } from "../../../lib/kv";

export const dynamic = "force-dynamic";

function publicView(conn, token) {
  const { systemeKey, owner, ...rest } = conn;
  return { token, hasKey: !!systemeKey, ...rest };
}

export async function GET() {
  const s = await getSession();
  if (!s) return Response.json({ error: "not signed in" }, { status: 401 });
  const tokens = (await kv.smembers(keys.userConns(s.sub))) || [];
  const conns = [];
  for (const token of tokens) {
    const c = await kv.get(keys.connection(token));
    if (c) conns.push(publicView(c, token));
  }
  return Response.json({ connections: conns });
}

export async function POST(req) {
  const s = await getSession();
  if (!s) return Response.json({ error: "not signed in" }, { status: 401 });
  const b = await req.json();

  let token = b.token;
  if (token) {
    const existing = await kv.get(keys.connection(token));
    if (!existing || existing.owner !== s.sub) {
      return Response.json({ error: "connection not found" }, { status: 404 });
    }
  } else {
    token = crypto.randomBytes(18).toString("hex");
  }

  // Keep the previously stored systeme key if the form didn't resend it.
  let systemeKey = b.systemeKey;
  if (!systemeKey && b.token) {
    const existing = await kv.get(keys.connection(b.token));
    systemeKey = existing && existing.systemeKey;
  }

  const conn = {
    owner: s.sub,
    fileId: b.fileId,
    fileName: b.fileName || "",
    tab: b.tab,
    headerRow: Number(b.headerRow || 1),
    systemeKey: systemeKey || "",
    locale: b.locale || "en",
    columns: b.columns || {},
    customFields: b.customFields || [],
    dateColumn: b.dateColumn || "",
    originalDateSlug: b.originalDateSlug || "",
    onDuplicate: b.onDuplicate || "update",
    tagRules: b.tagRules || [],
    updatedAt: Date.now(),
  };

  await kv.set(keys.connection(token), conn);
  await kv.sadd(keys.userConns(s.sub), token);

  const ingestUrl = `${process.env.APP_URL}/api/ingest`;
  return Response.json({ ...publicView(conn, token), ingestUrl });
}

export async function DELETE(req) {
  const s = await getSession();
  if (!s) return Response.json({ error: "not signed in" }, { status: 401 });
  const token = new URL(req.url).searchParams.get("token");
  const existing = token && (await kv.get(keys.connection(token)));
  if (!existing || existing.owner !== s.sub) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  await kv.del(keys.connection(token));
  await kv.srem(keys.userConns(s.sub), token);
  return Response.json({ ok: true });
}
