import { kv, keys } from "./kv";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
].join(" ");

export function authUrl(state) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${process.env.APP_URL}/api/auth/callback`,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: state || "",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export async function exchangeCode(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${process.env.APP_URL}/api/auth/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error("token exchange failed: " + (await res.text()));
  return res.json(); // { access_token, refresh_token, expires_in, id_token, ... }
}

export function decodeIdToken(idToken) {
  const payload = idToken.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
}

async function refresh(session) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: session.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("token refresh failed: " + (await res.text()));
  const t = await res.json();
  session.access_token = t.access_token;
  session.expiry = Date.now() + (t.expires_in - 60) * 1000;
  await kv.set(keys.session(session.sid), {
    sub: session.sub,
    email: session.email,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expiry: session.expiry,
  });
  return session.access_token;
}

// Returns a valid access token, refreshing if expired.
export async function accessToken(session) {
  if (session.expiry && Date.now() < session.expiry) return session.access_token;
  if (!session.refresh_token) return session.access_token;
  return refresh(session);
}

async function gfetch(session, url) {
  const token = await accessToken(session);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${await res.text()}`);
  return res.json();
}

// List the user's Google Sheets files (id + name), most recently modified first.
export async function listSpreadsheets(session) {
  const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${q}` +
    `&orderBy=modifiedTime desc&pageSize=100&fields=files(id,name)`;
  const data = await gfetch(session, url);
  return data.files || [];
}

// List the tab/sheet names inside a spreadsheet.
export async function listTabs(session, fileId) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=sheets.properties(title)`;
  const data = await gfetch(session, url);
  return (data.sheets || []).map((s) => s.properties.title);
}

// Read the header row of a tab (row 1 by default).
export async function readHeaders(session, fileId, tab, headerRow = 1) {
  const range = encodeURIComponent(`${tab}!${headerRow}:${headerRow}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${range}`;
  const data = await gfetch(session, url);
  return (data.values && data.values[0]) || [];
}

// Read all rows of a tab as arrays (including header row).
export async function readAll(session, fileId, tab) {
  const range = encodeURIComponent(tab);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const data = await gfetch(session, url);
  return data.values || [];
}
