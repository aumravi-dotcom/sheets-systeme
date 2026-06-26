const API_BASE = "https://api.systeme.io/api";

async function sysFetch(key, method, path, body, contentType) {
  const opts = { method, headers: { "X-API-Key": key } };
  if (body != null) {
    opts.headers["Content-Type"] = contentType || "application/json";
    opts.body = JSON.stringify(body);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API_BASE + path, opts);
    if (res.status === 429) {
      const wait = Math.min(Number(res.headers.get("Retry-After") || 1), 3);
      await new Promise((r) => setTimeout(r, (wait + 0.2) * 1000));
      continue;
    }
    let json = null;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { code: res.status, json, text };
  }
  return { code: 429, json: null, text: "rate limited" };
}

function looksLikeEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());
}
function t255(v) { return String(v).slice(0, 255); }
function short(res) {
  const s = res.json ? JSON.stringify(res.json) : String(res.text || "");
  return s.slice(0, 160);
}

async function findContactByEmail(key, email) {
  const res = await sysFetch(key, "GET", "/contacts?email=" + encodeURIComponent(email));
  if (res.code >= 200 && res.code < 300 && res.json) {
    const items = res.json.items || res.json.data || (Array.isArray(res.json) ? res.json : []);
    for (const it of items) {
      if (it && String(it.email || "").toLowerCase() === email.toLowerCase()) return it.id;
    }
  }
  return null;
}

async function getOrCreateTagId(key, name, cache) {
  const norm = String(name).trim();
  if (!norm) return null;
  if (cache && cache[norm] != null) return cache[norm];
  let res = await sysFetch(key, "GET", "/tags?limit=100");
  let items = res.json ? res.json.items || res.json.data || [] : [];
  for (const t of items) {
    if (String(t.name).toLowerCase() === norm.toLowerCase()) {
      if (cache) cache[norm] = t.id;
      return t.id;
    }
  }
  res = await sysFetch(key, "POST", "/tags", { name: norm });
  const id = res.json && res.json.id ? res.json.id : null;
  if (cache && id != null) cache[norm] = id;
  return id;
}

function tagsForRow(conn, rowObj) {
  const out = new Set();
  for (const rule of conn.tagRules || []) {
    const v = rule.header != null ? String(rowObj[rule.header] ?? "").trim() : "";
    let hit = false;
    switch (rule.type) {
      case "always": hit = true; break;
      case "nonempty": hit = v !== ""; break;
      case "equals": hit = v.toLowerCase() === String(rule.value || "").toLowerCase(); break;
      case "contains": hit = v.toLowerCase().includes(String(rule.value || "").toLowerCase()); break;
      default: hit = false;
    }
    if (hit && rule.tag) out.add(rule.tag);
  }
  return [...out];
}

function dateStr(v) {
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Upsert one contact. systeme.io wants names as fields with slugs
 * (first_name / surname / phone_number). Custom fields are best-effort:
 * if one is invalid, the contact is still created with the valid fields.
 * Returns { status, id }.
 */
async function upsertContact(conn, rowObj, tagCache) {
  const key = conn.systemeKey;
  const col = conn.columns || {};
  const locale = conn.locale || "en";
  const email = String(rowObj[col.email] ?? "").trim();
  if (!looksLikeEmail(email)) return { status: "skip: bad email", id: null };

  // Standard fields (always-valid slugs).
  const standard = [];
  const pushStd = (slug, header) => {
    if (!header) return;
    const val = rowObj[header];
    if (val !== "" && val != null) standard.push({ slug, value: t255(val) });
  };
  pushStd("first_name", col.firstName);
  pushStd("surname", col.lastName);
  pushStd("phone_number", col.phoneNumber);

  // Custom fields (may not exist in the account → best-effort).
  const custom = [];
  for (const cf of conn.customFields || []) {
    const val = rowObj[cf.header];
    if (val !== "" && val != null && cf.slug) custom.push({ slug: cf.slug, value: t255(val) });
  }
  if (conn.originalDateSlug && conn.dateColumn && rowObj[conn.dateColumn]) {
    custom.push({ slug: conn.originalDateSlug, value: t255(dateStr(rowObj[conn.dateColumn])) });
  }
  const allFields = standard.concat(custom);
  const makeBody = (fields) => (fields.length ? { email, locale, fields } : { email, locale });

  let id = null;
  let label = "";

  // Attempt 1: create with everything.
  let res = await sysFetch(key, "POST", "/contacts", makeBody(allFields));
  if (res.code >= 200 && res.code < 300 && res.json && res.json.id) {
    id = res.json.id;
    label = "ok (created)";
  } else if (res.code === 409 || res.code === 422) {
    // Already exists?
    id = await findContactByEmail(key, email);
    if (id) {
      if ((conn.onDuplicate || "update") === "skip") {
        label = "ok (existed, skipped)";
      } else {
        let p = await sysFetch(key, "PATCH", "/contacts/" + id, { locale, fields: allFields }, "application/merge-patch+json");
        if (p.code >= 300 && custom.length) {
          await sysFetch(key, "PATCH", "/contacts/" + id, { locale, fields: standard }, "application/merge-patch+json");
          label = "ok (updated, custom skipped)";
        } else {
          label = "ok (updated)";
        }
      }
    } else {
      // Not a duplicate → a custom field is the problem. Retry without customs.
      let res2 = await sysFetch(key, "POST", "/contacts", makeBody(standard));
      if (res2.code >= 200 && res2.code < 300 && res2.json && res2.json.id) {
        id = res2.json.id;
        label = "ok (created, custom skipped)";
      } else {
        return { status: `error ${res2.code}: ${short(res2)}`, id: null };
      }
    }
  } else {
    return { status: `error ${res.code}: ${short(res)}`, id: null };
  }

  for (const tagName of tagsForRow(conn, rowObj)) {
    const tagId = await getOrCreateTagId(key, tagName, tagCache);
    if (tagId != null) await sysFetch(key, "POST", `/contacts/${id}/tags`, { tagId: Number(tagId) });
  }
  return { status: label, id };
}

export { upsertContact, getOrCreateTagId, findContactByEmail };
