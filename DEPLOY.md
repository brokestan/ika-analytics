# IKA Analytics — Complete Deployment Guide

> Mobile-first, secure, free hosting. Read every step carefully.

---

## Prerequisites (5 min)

You need accounts on three free services:

| Service       | What for                        | URL                        |
|---------------|---------------------------------|----------------------------|
| **Supabase**  | Database (Postgres)             | https://supabase.com       |
| **Vercel**    | Hosting + cron jobs             | https://vercel.com         |
| **GitHub**    | Source code (private repo)      | https://github.com         |

---

## PART 1 — Database Setup (Supabase)

### 1.1 Create Project

1. Go to **https://supabase.com** → Sign up / Log in
2. Click **"New Project"**
3. Set project name: `ika-analytics`
4. Set a **strong database password** (save it somewhere safe)
5. Choose region: **US East** or whichever is closest to you
6. Click **"Create new project"** — wait ~2 minutes

### 1.2 Copy Your Keys

1. In Supabase sidebar: **Settings → API**
2. Copy and save these three values:
   - **Project URL** → `https://xxxx.supabase.co`
   - **anon / public key** → long JWT string
   - **service_role key** → longer JWT string *(keep this secret!)*

### 1.3 Run Database Schema

1. In Supabase sidebar: **SQL Editor → New Query**
2. Open the file `supabase/schema.sql` from this project
3. Copy the **entire contents** and paste into the SQL Editor
4. Click **"RUN"** (green button)
5. You should see: `Success. No rows returned`
6. Verify in **Table Editor** that these tables exist:
   - `wallets`, `locks`, `isui_locks`, `drizzlets`
   - `riddle_pools`, `dashboard_cache`, `lock_distribution_cache`
   - `drizzlet_distribution_cache`, `indexer_state`

### 1.4 Configure Row Level Security

The schema already enables RLS. Double-check:

1. **Table Editor → wallets → Policies** — you should see two policies:
   - `Public read wallets` (SELECT, for anyone)
   - `Service full wallets` (ALL, for service_role only)
2. Repeat check for other tables. If policies are missing, re-run the schema SQL.

---

## PART 2 — GitHub Setup (Private Repo)

### 2.1 Create Private Repository

**IMPORTANT: Make the repo PRIVATE.** A public repo would expose your project structure.

```bash
# From inside the ika-analytics folder
git init
git add .
git commit -m "Initial commit"
```

1. Go to **https://github.com/new**
2. Repository name: `ika-analytics`
3. Select **Private** ← IMPORTANT
4. Click **"Create repository"**
5. Follow the instructions to push your existing repo:

```bash
git remote add origin https://github.com/YOUR_USERNAME/ika-analytics.git
git branch -M main
git push -u origin main
```

### 2.2 Verify .gitignore

Confirm these files are NOT tracked:
```bash
git status
```

`.env.local` must NOT appear in the output. If it does:
```bash
git rm --cached .env.local
git commit -m "Remove .env.local from tracking"
```

---

## PART 3 — Generate Secrets

### 3.1 CRON_SECRET

On your phone or computer, generate a strong random secret:

**Option A — Terminal:**
```bash
openssl rand -base64 48
```

**Option B — Online (use only once, in private):**
Visit https://generate-secret.vercel.app/64

Save the result — you'll need it twice (Vercel env vars + to call the indexer manually).

---

## PART 4 — Vercel Deployment

### 4.1 Import from GitHub

1. Go to **https://vercel.com** → Log in
2. Click **"Add New… → Project"**
3. Click **"Import Git Repository"**
4. Select your `ika-analytics` private repo
5. **DO NOT click Deploy yet** — configure env vars first

### 4.2 Add Environment Variables

In the Vercel deployment screen, scroll to **"Environment Variables"**:

Add each of these one by one (Name → Value):

| Variable Name                  | Value                                    | Note                    |
|-------------------------------|------------------------------------------|-------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`    | `https://xxxx.supabase.co`              | From Supabase Settings  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGc...`                          | Public anon key         |
| `SUPABASE_SERVICE_ROLE_KEY`   | `eyJhbGc...`                            | **Secret** service role |
| `SUI_RPC_URL`                 | `https://fullnode.mainnet.sui.io:443`   | Free public RPC         |
| `IKA_PACKAGE_ID`              | `0x...` (IKA package address)           | From Sui Explorer       |
| `RIDDLE_POOL_OBJECT_ID`       | `0x92c105c5cf5713a...ef334`             | Pre-configured          |
| `CRON_SECRET`                 | Your generated 64-char secret           | Keep this private!      |
| `NEXT_PUBLIC_SITE_URL`        | `https://your-app.vercel.app`           | Set after first deploy  |

**For `SUPABASE_SERVICE_ROLE_KEY`:** Make sure to tick only **"Production"** and **"Preview"** environments — NOT "Development". This key should never appear in your local dev via Vercel.

### 4.3 Deploy

Click **"Deploy"**. Watch the build log. It should complete in ~90 seconds.

### 4.4 Set NEXT_PUBLIC_SITE_URL

After first deploy:
1. Copy your Vercel URL (e.g. `https://ika-analytics.vercel.app`)
2. Vercel Dashboard → Project → **Settings → Environment Variables**
3. Edit `NEXT_PUBLIC_SITE_URL` → paste your URL → Save
4. Go to **Deployments → Redeploy** (to pick up the new var)

---

## PART 5 — Initialize the Database

### 5.1 Run Indexer for the First Time

The database is empty. Run the indexer manually:

**From your phone or computer:**

```
https://your-app.vercel.app/api/index?secret=YOUR_CRON_SECRET
```

You should get a JSON response like:
```json
{ "success": true, "new_locks": 42, "ran_at": "2025-..." }
```

### 5.2 Verify Data Appears

1. Open your app: `https://your-app.vercel.app`
2. Dashboard should show metrics cards with real numbers
3. Leaderboard should show wallets

If still showing zeros, check the Vercel **Function Logs**:
- Vercel Dashboard → Project → **Functions** tab → Select `/api/index`

---

## PART 6 — Vercel Cron (Auto Refresh)

### 6.1 Verify Cron is Set Up

The `vercel.json` file configures a daily cron:

```json
{
  "crons": [{ "path": "/api/index", "schedule": "0 0 * * *" }]
}
```

In Vercel Dashboard → Project → **Settings → Cron Jobs**, you should see it listed.

### 6.2 Cron Security

Vercel automatically adds `x-vercel-cron: 1` to cron requests, and our middleware allows those through. The `CRON_SECRET` provides a second layer for manual calls.

---

## PART 7 — Mobile Access

The app is fully responsive. To use from your phone:

1. Open your browser (Safari/Chrome)
2. Navigate to `https://your-app.vercel.app`
3. **Add to Home Screen** for app-like experience:
   - **iOS Safari:** Share button → "Add to Home Screen"
   - **Android Chrome:** Menu (⋮) → "Add to Home Screen"

The theme color (`#0A0612`) is set via viewport meta, so it colors the browser chrome on mobile.

---

## PART 8 — Security Hardening Checklist

### What's Already Protected

| Protection                  | How                                       |
|-----------------------------|--------------------------------------------|
| Source code hidden          | Private GitHub repo                        |
| No source maps in prod      | `productionBrowserSourceMaps: false`       |
| API rate limiting           | `middleware.ts` — 60 req/min per IP        |
| Refresh endpoint rate limit | 3 req/min per IP                           |
| `/api/index` protected      | Requires `CRON_SECRET` or Vercel cron header |
| SQL injection impossible    | Supabase parameterized queries             |
| XSS protection              | CSP headers in middleware                  |
| Clickjacking blocked        | `X-Frame-Options: SAMEORIGIN`             |
| MIME sniffing blocked       | `X-Content-Type-Options: nosniff`         |
| HTTPS enforced              | HSTS header: 2-year max-age               |
| Service role key hidden     | Server-only, never `NEXT_PUBLIC_`          |
| Search input sanitized      | Hex-only filter on wallet search           |
| Supabase RLS                | Service role for writes, anon for reads    |

### Extra Hardening (Optional)

**Password-protect the entire app during beta:**

In Vercel Dashboard → Project → Settings → **Vercel Authentication**:
- Enable "Password Protection"
- Set a password
- This gate applies before Next.js even loads

**Restrict Supabase to your Vercel IP ranges:**

In Supabase → Settings → **Network** → Allowed IP addresses:
- Add Vercel's IP ranges (see https://vercel.com/docs/edge-network/regions)
- This prevents anyone from hitting your Supabase directly

---

## PART 9 — Updating the IKA Package ID

When you find the actual IKA Move package address on Sui mainnet:

1. Go to https://suiexplorer.com and search for `IKA`
2. Find the package with `ika_staking` module
3. Copy the package ID (starts with `0x`)
4. Vercel Dashboard → Environment Variables → Edit `IKA_PACKAGE_ID`
5. Trigger a redeployment
6. Run the indexer: `https://your-app.vercel.app/api/index?secret=YOUR_SECRET`

---

## PART 10 — Troubleshooting

### "No data indexed yet" banner shows

→ Run: `curl https://your-app.vercel.app/api/index?secret=YOUR_SECRET`
→ Check Vercel Function Logs for errors

### Dashboard shows all zeros after indexing

→ Verify `IKA_PACKAGE_ID` is the correct mainnet address
→ The RPC event filter won't match if the package ID is wrong

### Build fails on Vercel

→ Check that all required env vars are set (especially `NEXT_PUBLIC_SUPABASE_URL`)
→ Run `npm run build` locally to see TypeScript errors

### Rate limit errors (429)

→ Wait 60 seconds
→ For the indexer, only 3 manual refreshes per minute are allowed

### Supabase "JWT expired" errors

→ Your `SUPABASE_SERVICE_ROLE_KEY` may have been regenerated
→ Go to Supabase → Settings → API → Regenerate and update in Vercel

---

## Quick Reference

```
Your app URL:     https://your-app.vercel.app
Dashboard:        https://your-app.vercel.app/
Leaderboard:      https://your-app.vercel.app/leaderboard
Manual indexer:   https://your-app.vercel.app/api/index?secret=YOUR_SECRET
Cron schedule:    Daily at 00:00 UTC
```
