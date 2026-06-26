export const dynamic = "force-dynamic";

export async function GET() {
  const has = (k) => !!process.env[k];
  const missing = [];
  if (!has("GOOGLE_CLIENT_ID")) missing.push("GOOGLE_CLIENT_ID");
  if (!has("GOOGLE_CLIENT_SECRET")) missing.push("GOOGLE_CLIENT_SECRET");
  if (!has("APP_URL")) missing.push("APP_URL");
  if (!has("UPSTASH_REDIS_REST_URL") && !has("KV_REST_API_URL"))
    missing.push("UPSTASH_REDIS_REST_URL (or KV_REST_API_URL)");
  if (!has("UPSTASH_REDIS_REST_TOKEN") && !has("KV_REST_API_TOKEN"))
    missing.push("UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_TOKEN)");
  return Response.json({ ok: missing.length === 0, missingEnv: missing });
}
