/**
 * Relay.gs — paste into your Google Sheet (Extensions → Apps Script).
 * The actual ENDPOINT and TOKEN are generated for you in the web app after you
 * save a connection; copy the version shown there (it is pre-filled). This file
 * is just a reference copy.
 */
const ENDPOINT = "https://YOUR-APP.vercel.app/api/ingest";
const TOKEN    = "PASTE_CONNECTION_TOKEN";
const TAB      = "Sheet1";
const HEADER_ROW = 1;
const STATUS_HEADER = "Systeme Status";

function installTriggers() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (["pushNewRows", "onFormSubmitHandler"].indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("pushNewRows").forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger("pushNewRows").timeBased().everyMinutes(1).create();
  try { ScriptApp.newTrigger("onFormSubmitHandler").forSpreadsheet(ss).onFormSubmit().create(); } catch (e) {}
  SpreadsheetApp.getUi().alert("Live sync installed.");
}

function onFormSubmitHandler() { pushNewRows(); }

function pushNewRows() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(TAB);
    const last = sh.getLastRow(), cols = sh.getLastColumn();
    if (last <= HEADER_ROW) return;
    const headers = sh.getRange(HEADER_ROW, 1, 1, cols).getValues()[0];
    let sIdx = headers.indexOf(STATUS_HEADER);
    if (sIdx < 0) { sIdx = headers.length; sh.getRange(HEADER_ROW, sIdx + 1).setValue(STATUS_HEADER); }
    const data = sh.getRange(HEADER_ROW + 1, 1, last - HEADER_ROW, sIdx + 1).getValues();
    const rows = [], rowNums = [];
    data.forEach(function (r, i) {
      if (String(r[sIdx] || "").indexOf("ok") === 0) return;
      const o = {}; headers.forEach(function (h, c) { if (h !== STATUS_HEADER) o[h] = r[c]; });
      rows.push(o); rowNums.push(HEADER_ROW + 1 + i);
    });
    if (!rows.length) return;
    const res = UrlFetchApp.fetch(ENDPOINT, {
      method: "post", contentType: "application/json", muteHttpExceptions: true,
      payload: JSON.stringify({ token: TOKEN, rows: rows }),
    });
    let out = {}; try { out = JSON.parse(res.getContentText()); } catch (e) {}
    (out.results || []).forEach(function (x, i) { sh.getRange(rowNums[i], sIdx + 1).setValue(x.status || "sent"); });
  } finally {
    lock.releaseLock();
  }
}
