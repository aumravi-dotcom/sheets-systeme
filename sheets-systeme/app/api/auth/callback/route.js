import { exchangeCode, decodeIdToken } from "../../../../lib/google";
import { newSessionId, saveSession, setSessionCookie } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(`${process.env.APP_URL}/?error=no_code`, 302);

  try {
    const t = await exchangeCode(code);
    const claims = decodeIdToken(t.id_token);
    const sid = newSessionId();
    await saveSession(sid, {
      sub: claims.sub,
      email: claims.email,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expiry: Date.now() + (t.expires_in - 60) * 1000,
    });
    setSessionCookie(sid);
    return Response.redirect(`${process.env.APP_URL}/`, 302);
  } catch (e) {
    return Response.redirect(`${process.env.APP_URL}/?error=${encodeURIComponent(e.message)}`, 302);
  }
}
