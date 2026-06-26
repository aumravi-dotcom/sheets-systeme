export const dynamic = "force-dynamic";

export async function GET() {
  const need = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "APP_URL", "SESSION_SECRET", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
  const missing = need.filter((k) => !process.env[k]);
  return Response.json({ ok: missing.length === 0, missingEnv: missing });
}
