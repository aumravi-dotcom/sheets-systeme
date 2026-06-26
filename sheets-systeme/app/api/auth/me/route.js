import { getSession } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  return Response.json(s ? { connected: true, email: s.email } : { connected: false });
}
