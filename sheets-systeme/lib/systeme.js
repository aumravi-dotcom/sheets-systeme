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
 * Upsert one contact (create-first to minimise API calls), then apply tag rules.
 * Returns { status, id }.
 */
async function upsertContact(conn, rowObj, tagCache) {
  const key = conn.systemeKey;
  const col = conn.columns || {};
  const email = String(rowObj[col.email] ?? "").trim();
  if (!looksLikeEmail(email)) return { status: "skip: bad email", id: null };

  const body = { email, locale: conn.locale || "en", fields: [] };
  const put = (k, header) => {
    if (!header) return;
    const val = rowObj[header];
    if (val !== "" && val != null) body[k] = String(val).trim();
  };
  put("firstName", col.firstName);
  put("lastName", col.lastName);
  put("phoneNumber", col.phoneNumber);
  for (const cf of conn.customFields || []) {
    const val = rowObj[cf.header];
    if (val !== "" && val != null) body.fields.push({ slug: cf.slug, value: String(val) });
  }
  if (conn.originalDateSlug && conn.dateColumn && rowObj[conn.dateColumn]) {
    body.fields.push({ slug: conn.originalDateSlug, value: dateStr(rowObj[conn.dateColumn]) });
  }
  if (!body.fields.length) delete body.fields;

  let id = null;
  let label = "";

  // CREATE FIRST — one call for brand-new contacts (the common backfill case).
  const res = await sysFetch(key, "POST", "/contacts", body);
  if (res.code >= 200 && res.code < 300 && res.json && res.json.id) {
    id = res.json.id;
    label = "ok (created)";
  } else if (res.code === 409 || res.code === 422) {
    // Already exists (or validation). Look it up.
    id = await findContactByEmail(key, email);
    if (!id) return { status: `skip: rejected ${res.code}`, id: null };
    if ((conn.onDuplicate || "update") === "skip") {
      label = "ok (existed, skipped)";
    } else {
      const patch = { locale: body.locale, fields: (body.fields || []).slice() };
      if (body.firstName) patch.fields.push({ slug: "first_name", value: body.firstName });
      if (body.lastName) patch.fields.push({ slug: "surname", value: body.lastName });
      if (body.phoneNumber) patch.fields.push({ slug: "phone_number", value: body.phoneNumber });
      await sysFetch(key, "PATCH", "/contacts/" + id, patch, "application/merge-patch+json");
      label = "ok (updated)";
    }
  } else {
    return { status: `error ${res.code}`, id: null };
  }

  for (const tagName of tagsForRow(conn, rowObj)) {
    const tagId = await getOrCreateTagId(key, tagName, tagCache);
    if (tagId != null) await sysFetch(key, "POST", `/contacts/${id}/tags`, { tagId: Number(tagId) });
  }
  return { status: label, id };
}

export { upsertContact, getOrCreateTagId, findContactByEmail };
