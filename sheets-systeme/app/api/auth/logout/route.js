import { clearSessionCookie } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  clearSessionCookie();
  return Response.json({ ok: true });
}
