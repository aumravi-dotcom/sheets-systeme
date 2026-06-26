"use client";
import { useEffect, useState } from "react";

const SYS_FIELDS = [
  ["email", "Email (required)"],
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["phoneNumber", "Phone (with country code)"],
];

async function j(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export default function Page() {
  const [me, setMe] = useState(null);
  const [files, setFiles] = useState([]);
  const [conns, setConns] = useState([]);

  const [systemeKey, setSystemeKey] = useState("");
  const [fileId, setFileId] = useState("");
  const [fileName, setFileName] = useState("");
  const [tabs, setTabs] = useState([]);
  const [tab, setTab] = useState("");
  const [headers, setHeaders] = useState([]);

  const [columns, setColumns] = useState({ email: "", firstName: "", lastName: "", phoneNumber: "" });
  const [customFields, setCustomFields] = useState([]);
  const [dateColumn, setDateColumn] = useState("");
  const [originalDateSlug, setOriginalDateSlug] = useState("");
  const [onDuplicate, setOnDuplicate] = useState("update");
  const [tagRules, setTagRules] = useState([{ type: "always", header: "", value: "", tag: "" }]);

  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    j("/api/auth/me").then((m) => {
      setMe(m);
      if (m.connected) {
        j("/api/sheets").then((d) => setFiles(d.files)).catch((e) => setErr(e.message));
        j("/api/connections").then((d) => setConns(d.connections)).catch(() => {});
      }
    });
  }, []);

  async function pickFile(id) {
    setFileId(id);
    setFileName((files.find((f) => f.id === id) || {}).name || "");
    setTab(""); setHeaders([]); setTabs([]);
    if (!id) return;
    try { const d = await j(`/api/tabs?fileId=${id}`); setTabs(d.tabs); }
    catch (e) { setErr(e.message); }
  }

  async function pickTab(t) {
    setTab(t); setHeaders([]);
    if (!t) return;
    try {
      const d = await j(`/api/headers?fileId=${fileId}&tab=${encodeURIComponent(t)}`);
      setHeaders(d.headers);
      // best-effort auto-map by header name
      const guess = (names) => d.headers.find((h) => names.some((n) => String(h).toLowerCase().includes(n))) || "";
      setColumns({
        email: guess(["email", "e-mail"]),
        firstName: guess(["first", "fname", "name"]),
        lastName: guess(["last", "surname", "lname"]),
        phoneNumber: guess(["phone", "mobile", "whatsapp"]),
      });
      setDateColumn(guess(["timestamp", "date", "time", "recorded"]));
    } catch (e) { setErr(e.message); }
  }

  function setCol(k, v) { setColumns((c) => ({ ...c, [k]: v })); }
  function addCustom() { setCustomFields((a) => [...a, { header: "", slug: "" }]); }
  function setCustom(i, k, v) { setCustomFields((a) => a.map((x, n) => (n === i ? { ...x, [k]: v } : x))); }
  function delCustom(i) { setCustomFields((a) => a.filter((_, n) => n !== i)); }
  function addRule() { setTagRules((a) => [...a, { type: "equals", header: "", value: "", tag: "" }]); }
  function setRule(i, k, v) { setTagRules((a) => a.map((x, n) => (n === i ? { ...x, [k]: v } : x))); }
  function delRule(i) { setTagRules((a) => a.filter((_, n) => n !== i)); }

  async function save() {
    setErr(""); setBusy("save");
    try {
      const payload = {
        token: saved?.token, fileId, fileName, tab, headerRow: 1,
        systemeKey, locale: "en", columns,
        customFields: customFields.filter((c) => c.header && c.slug),
        dateColumn, originalDateSlug, onDuplicate,
        tagRules: tagRules.filter((r) => r.tag && (r.type === "always" || r.header)),
      };
      const res = await j("/api/connections", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      setSaved(res);
      const d = await j("/api/connections"); setConns(d.connections);
    } catch (e) { setErr(e.message); }
    setBusy("");
  }

  async function runBackfill() {
    if (!saved?.token) return;
    setErr(""); setBusy("backfill"); setProgress({ processed: 0, total: 0 });
    try {
      let offset = 0;
      while (true) {
        const d = await j("/api/backfill", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: saved.token, offset }),
        });
        setProgress({ processed: d.processed, total: d.total });
        if (d.nextOffset == null) break;
        offset = d.nextOffset;
      }
    } catch (e) { setErr(e.message); }
    setBusy("");
  }

  async function delConn(token) {
    await j(`/api/connections?token=${token}`, { method: "DELETE" }).catch(() => {});
    const d = await j("/api/connections"); setConns(d.connections);
    if (saved?.token === token) setSaved(null);
  }

  const snippet = saved
    ? `// === paste into Extensions → Apps Script of your sheet, then run installTriggers ===
const ENDPOINT = "${saved.ingestUrl}";
const TOKEN    = "${saved.token}";
const TAB      = ${JSON.stringify(tab)};
const HEADER_ROW = 1;
const STATUS_HEADER = "Systeme Status";

function installTriggers(){
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(t=>{
    if(["pushNewRows","onFormSubmitHandler"].includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("pushNewRows").forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger("pushNewRows").timeBased().everyMinutes(1).create();
  try{ ScriptApp.newTrigger("onFormSubmitHandler").forSpreadsheet(ss).onFormSubmit().create(); }catch(e){}
}
function onFormSubmitHandler(){ pushNewRows(); }

function pushNewRows(){
  const lock = LockService.getScriptLock(); if(!lock.tryLock(0)) return;
  try{
    const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
    const last = sh.getLastRow(), cols = sh.getLastColumn();
    if(last <= HEADER_ROW) return;
    const headers = sh.getRange(HEADER_ROW,1,1,cols).getValues()[0];
    let sIdx = headers.indexOf(STATUS_HEADER);
    if(sIdx < 0){ sIdx = headers.length; sh.getRange(HEADER_ROW,sIdx+1).setValue(STATUS_HEADER); }
    const data = sh.getRange(HEADER_ROW+1,1,last-HEADER_ROW,sIdx+1).getValues();
    const rows = [], rowNums = [];
    data.forEach((r,i)=>{
      if(String(r[sIdx]||"").indexOf("ok")===0) return;
      const o = {}; headers.forEach((h,c)=>{ if(h!==STATUS_HEADER) o[h]=r[c]; });
      rows.push(o); rowNums.push(HEADER_ROW+1+i);
    });
    if(!rows.length) return;
    const res = UrlFetchApp.fetch(ENDPOINT,{method:"post",contentType:"application/json",
      muteHttpExceptions:true, payload: JSON.stringify({token:TOKEN, rows})});
    let out = {}; try{ out = JSON.parse(res.getContentText()); }catch(e){}
    (out.results||[]).forEach((x,i)=> sh.getRange(rowNums[i],sIdx+1).setValue(x.status||"sent"));
  } finally { lock.releaseLock(); }
}`
    : "";

  if (!me) return <div className="wrap"><p className="sub">Loading…</p></div>;

  return (
    <div className="wrap">
      <div className="brand"><h1>Sheets <span className="dot">→</span> systeme.io</h1></div>
      <p className="sub">Pick a sheet, map your columns, segment with tags. New rows sync in seconds; history backfills in date order.</p>

      {err && <div className="card" style={{ borderColor: "var(--err)" }}><span className="status err">{err}</span></div>}

      {!me.connected ? (
        <div className="card lead signin">
          <p>Sign in with the Google account that owns your sheets.</p>
          <a className="btnlink" href="/api/auth/google"><button className="primary">Connect Google</button></a>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="step"><span className="n">01</span> systeme.io API key</div>
            <input type="password" placeholder="Paste your systeme.io public API key"
              value={systemeKey} onChange={(e) => setSystemeKey(e.target.value)} />
            <p className="hint">systeme.io → Settings → Public API keys → Create. Stored only on your own deployment.</p>
          </div>

          <div className="card">
            <div className="step"><span className="n">02</span> Choose sheet &amp; tab</div>
            <label>Google Sheet file</label>
            <select value={fileId} onChange={(e) => pickFile(e.target.value)}>
              <option value="">Select a file…</option>
              {files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            {tabs.length > 0 && (
              <>
                <label>Tab</label>
                <select value={tab} onChange={(e) => pickTab(e.target.value)}>
                  <option value="">Select a tab…</option>
                  {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </>
            )}
          </div>

          {headers.length > 0 && (
            <>
              <div className="card">
                <div className="step"><span className="n">03</span> Map columns</div>
                {SYS_FIELDS.map(([k, label]) => (
                  <div key={k}>
                    <label>{label}</label>
                    <select value={columns[k]} onChange={(e) => setCol(k, e.target.value)}>
                      <option value="">— none —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}

                <div className="divider" />
                <div className="step"><span className="n">+</span> custom fields</div>
                {customFields.map((c, i) => (
                  <div className="row3" key={i}>
                    <select value={c.header} onChange={(e) => setCustom(i, "header", e.target.value)}>
                      <option value="">column…</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                    <input placeholder="systeme slug" value={c.slug} onChange={(e) => setCustom(i, "slug", e.target.value)} />
                    <span />
                    <button className="ghost tiny danger" onClick={() => delCustom(i)}>✕</button>
                  </div>
                ))}
                <div className="actions"><button className="ghost tiny" onClick={addCustom}>+ custom field</button></div>

                <div className="divider" />
                <div className="row">
                  <div>
                    <label>Date column (orders the backfill)</label>
                    <select value={dateColumn} onChange={(e) => setDateColumn(e.target.value)}>
                      <option value="">— sheet order —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label>If email already exists</label>
                    <select value={onDuplicate} onChange={(e) => setOnDuplicate(e.target.value)}>
                      <option value="update">Update it</option>
                      <option value="skip">Skip it</option>
                    </select>
                  </div>
                </div>
                <label>Store original date in systeme.io field slug (optional)</label>
                <input placeholder="e.g. signup_date — leave blank to skip" value={originalDateSlug}
                  onChange={(e) => setOriginalDateSlug(e.target.value)} />
              </div>

              <div className="card">
                <div className="step"><span className="n">04</span> Tag rules — segment contacts</div>
                {tagRules.map((r, i) => (
                  <div className="row3" key={i} style={{ marginBottom: 8 }}>
                    <select value={r.type} onChange={(e) => setRule(i, "type", e.target.value)}>
                      <option value="always">tag everyone</option>
                      <option value="nonempty">if column filled</option>
                      <option value="equals">if column equals</option>
                      <option value="contains">if column contains</option>
                    </select>
                    {r.type === "always" ? <span /> : (
                      <select value={r.header} onChange={(e) => setRule(i, "header", e.target.value)}>
                        <option value="">column…</option>
                        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                      </select>
                    )}
                    {r.type === "equals" || r.type === "contains" ? (
                      <input placeholder="value" value={r.value} onChange={(e) => setRule(i, "value", e.target.value)} />
                    ) : <span />}
                    <button className="ghost tiny danger" onClick={() => delRule(i)}>✕</button>
                    <input style={{ gridColumn: "1 / 4" }} placeholder="→ tag name to apply"
                      value={r.tag} onChange={(e) => setRule(i, "tag", e.target.value)} />
                  </div>
                ))}
                <div className="actions"><button className="ghost tiny" onClick={addRule}>+ tag rule</button></div>
                <p className="hint">Tags are found or created in systeme.io automatically.</p>
              </div>

              <div className="actions">
                <button className="primary" disabled={!systemeKey || !columns.email || busy === "save"} onClick={save}>
                  {busy === "save" ? "Saving…" : saved ? "Update connection" : "Save connection"}
                </button>
              </div>
            </>
          )}

          {saved && (
            <div className="card lead" style={{ marginTop: 18 }}>
              <div className="step"><span className="n">05</span> Activate</div>
              <p className="hint" style={{ marginBottom: 12 }}>
                Connection token <span className="pill">{saved.token.slice(0, 10)}…</span>. Two things to finish:
              </p>
              <p style={{ margin: "0 0 8px" }}><b>A — Live sync:</b> open your sheet → Extensions → Apps Script, paste this, then run <code>installTriggers</code> once.</p>
              <div className="snippet">{snippet}</div>
              <button className="ghost tiny" style={{ marginTop: 10 }}
                onClick={() => navigator.clipboard.writeText(snippet)}>Copy snippet</button>

              <div className="divider" />
              <p style={{ margin: "0 0 8px" }}><b>B — Backfill history</b> (oldest → newest, runs here):</p>
              <div className="actions">
                <button className="primary" disabled={busy === "backfill"} onClick={runBackfill}>
                  {busy === "backfill" ? "Sending…" : "Run backfill"}
                </button>
              </div>
              {progress && (
                <>
                  <div className="bar"><i style={{ width: progress.total ? `${(progress.processed / progress.total) * 100}%` : "0%" }} /></div>
                  <p className="hint">{progress.processed} / {progress.total || "…"} rows</p>
                </>
              )}
            </div>
          )}

          {conns.length > 0 && (
            <div className="card">
              <div className="step"><span className="n">⊟</span> Saved connections</div>
              <div className="connlist">
                {conns.map((c) => (
                  <div className="conn" key={c.token}>
                    <div className="meta"><b>{c.fileName || c.fileId}</b> <span>· {c.tab} · {c.hasKey ? "key set" : "no key"}</span></div>
                    <button className="ghost tiny danger" onClick={() => delConn(c.token)}>delete</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="actions" style={{ marginTop: 8 }}>
            <button className="ghost tiny" onClick={() => fetch("/api/auth/logout", { method: "POST" }).then(() => location.reload())}>
              Sign out ({me.email})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
