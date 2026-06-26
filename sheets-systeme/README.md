# Sheets → systeme.io connector

Your own self-hosted mini-Zapier. Sign in with Google, pick a Sheet + tab, map
columns to systeme.io fields, define tag rules, and:

- **Live sync** — new rows reach systeme.io within seconds (a tiny Apps Script
  relay posts each new row to this app's `/api/ingest`).
- **Backfill** — existing rows are pushed oldest → newest, ordered by your date
  column, straight from this app via the Google Sheets API.

Stack: Next.js (App Router) on Vercel · Upstash Redis for storage · Google OAuth.

---

## What you'll set up (about 30 minutes, once)

### 1. Google Cloud OAuth credentials
1. Go to https://console.cloud.google.com → create a project.
2. **APIs & Services → Enabled APIs → + Enable APIs** → enable **Google Drive API**
   and **Google Sheets API**.
3. **APIs & Services → OAuth consent screen** → External → fill app name + your
   email. Add your own Google account under **Test users**. (Leave it in
   "Testing" — you'll just click past a "Google hasn't verified this app" screen.)
4. **Credentials → + Create credentials → OAuth client ID → Web application**.
   - Authorized redirect URI: `https://YOUR-APP.vercel.app/api/auth/callback`
     (add `http://localhost:3000/api/auth/callback` too for local dev).
   - Copy the **Client ID** and **Client secret**.

### 2. Upstash Redis (free)
- In Vercel: **Storage → Create → Upstash Redis**, or sign up at upstash.com.
- Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

### 3. Deploy to Vercel
1. Push this folder to a GitHub repo.
2. Vercel → **New Project** → import the repo.
3. Add environment variables (Project → Settings → Environment Variables),
   matching `.env.example`:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `APP_URL` = `https://YOUR-APP.vercel.app` (no trailing slash)
   - `SESSION_SECRET` = any long random string
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
4. Deploy. Then go back to your Google OAuth client and make sure the redirect
   URI uses the real deployed domain.
5. Visit `https://YOUR-APP.vercel.app/api/health` — it should report
   `ok: true` with no missing env.

### 4. Use it
1. Open the app → **Connect Google** → approve.
2. Paste your **systeme.io API key** (systeme.io → Settings → Public API keys).
3. Pick the **file**, the **tab**, map **columns**, add **tag rules**, **Save**.
4. **A — Live sync:** copy the generated Apps Script snippet into your sheet
   (Extensions → Apps Script), run `installTriggers` once, approve permissions.
5. **B — Backfill:** click **Run backfill** to push existing rows in date order.

---

## Local development
```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev                  # http://localhost:3000
```

## Notes & limits
- systeme.io only accepts emails with valid MX records; junk emails are skipped.
- Contacts are de-duplicated by email (create-or-update), so live + backfill
  overlapping is safe.
- systeme.io stamps each contact's *created* date as the import moment. To keep
  the original sheet date, map it to a custom field slug in the wizard.
- Backfill runs in batches to stay under serverless time limits; the UI loops
  until done. Very large sheets just take a few passes.
- Field slugs (`first_name`, `surname`, `phone_number`) can vary by account — if
  the status column shows an error, the API's reply is included so you can adjust.
