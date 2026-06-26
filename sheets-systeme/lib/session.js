import { cookies } from "next/headers";
import crypto from "crypto";
import { kv, keys } from "./kv";

const COOKIE = "sid";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function newSessionId() {
  return crypto.randomBytes(24).toString("hex");
}

export async function saveSession(sid, data) {
  await kv.set(keys.session(sid), data, { ex: TTL_SECONDS });
}

export async function getSession() {
  const sid = cookies().get(COOKIE)?.value;
  if (!sid) return null;
  const data = await kv.get(keys.session(sid));
  return data ? { sid, ...data } : null;
}

export function setSessionCookie(sid) {
  cookies().set(COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export function clearSessionCookie() {
  cookies().delete(COOKIE);
}
