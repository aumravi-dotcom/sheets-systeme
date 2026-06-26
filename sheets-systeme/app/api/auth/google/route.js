import { authUrl } from "../../../../lib/google";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.redirect(authUrl(), 302);
}
