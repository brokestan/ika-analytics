# IKA Analytics Dashboard

A production-ready analytics dashboard for the Sui/IKA ecosystem. Tracks IKA staking, iSUI staking, drizzlet rewards, riddle pools, and leaderboards.

**Tech Stack:** Next.js 14 · TailwindCSS · Recharts · Supabase · Vercel

---

## Project Structure

```
ika-analytics/
├── app/
│   ├── layout.tsx              # Root layout with navbar, glow effects
│   ├── page.tsx                # Dashboard page (server component)
│   ├── globals.css             # Global styles, Tailwind, custom CSS
│   ├── leaderboard/
│   │   └── page.tsx            # Leaderboard page (client, paginated)
│   └── api/
│       ├── dashboard/route.ts  # Dashboard aggregates endpoint
│       ├── leaderboard/route.ts# Leaderboard with search + pagination
│       ├── riddle-pool/route.ts# Live riddle pool fetch from chain
│       ├── refresh/route.ts    # Manual indexer trigger
│       └── index/route.ts      # Background blockchain indexer (cron)
├── components/
│   ├── Navbar.tsx              # Navigation bar
│   ├── MetricCard.tsx          # KPI metric card
│   ├── DrizzletPieChart.tsx    # Drizzlet distribution donut chart
│   ├── LockDistributionChart.tsx# Lock type breakdown
│   ├── ForecastCard.tsx        # Area chart + forecast milestones
│   ├── RiddlePoolCard.tsx      # Riddle pool display
│   ├── LeaderboardTable.tsx    # Responsive table/mobile cards
│   └── RefreshButton.tsx       # Manual refresh trigger UI
├── lib/
│   ├── types.ts                # All TypeScript interfaces
│   ├── supabase.ts             # Supabase client + query helpers
│   ├── sui-rpc.ts              # Sui blockchain RPC calls
│   └── calculations.ts         # Drizzlet math + formatting
├── supabase/
│   └── schema.sql              # Full DB schema (run in Supabase)
├── vercel.json                 # Vercel cron job (daily indexer)
├── .env.example                # Environment variables template
└── package.json
```

---

## Step-by-Step Deployment

### Step 1 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Choose a region close to your users
3. Save your **Project URL** and **anon key** (Settings → API)
4. Also copy the **service_role key** (keep this secret)
5. In the Supabase dashboard, click **SQL Editor** → **New Query**
6. Paste the entire contents of `supabase/schema.sql` and click **Run**
7. Verify tables were created under **Table Editor**

### Step 2 — Configure Environment Variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in:

```env
# Your Supabase project URL from Settings > API
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co

# Your Supabase anon (public) key
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...

# Your Supabase service role key (server-side only, never expose to browser)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# Sui RPC - use public endpoint (free) or BlockVision for higher rate limits
SUI_RPC_URL=https://fullnode.mainnet.sui.io:443

# A random secret string to protect the /api/index cron endpoint
CRON_SECRET=change-this-to-a-long-random-string

# IKA package ID on Sui mainnet (update when you have the real address)
IKA_PACKAGE_ID=0x<your_ika_package_id>

# Riddle pool shared object (already provided)
RIDDLE_POOL_OBJECT_ID=0x92c105c5cf5713a751ee18e7a007fbb238ae242b7234cf1ee25be51974eef334
```

> **Note on IKA_PACKAGE_ID:** You need the actual IKA Move package address deployed on Sui mainnet to query events. Check the IKA documentation or Sui explorer.

### Step 3 — Install & Test Locally

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000
```

### Step 4 — Deploy to Vercel

#### Option A: Via Vercel CLI

```bash
# Install Vercel CLI globally
npm i -g vercel

# Login
vercel login

# Deploy (from project root)
vercel

# For production
vercel --prod
```

#### Option B: Via Vercel Dashboard (Recommended)

1. Push your code to a GitHub repository
2. Go to [vercel.com](https://vercel.com) → **New Project**
3. Import your GitHub repository
4. In **Environment Variables**, add ALL variables from `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUI_RPC_URL`
   - `CRON_SECRET`
   - `IKA_PACKAGE_ID`
   - `RIDDLE_POOL_OBJECT_ID`
5. Click **Deploy**

### Step 5 — Trigger the First Index

After deployment, manually run the indexer to populate your database:

```bash
# Replace with your actual Vercel URL and CRON_SECRET
curl "https://your-app.vercel.app/api/index?secret=your-cron-secret"
```

Or from the dashboard UI: click the **Refresh** button in the top-right corner.

### Step 6 — Verify the Cron Job

Vercel automatically picks up the cron config from `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/index",
      "schedule": "0 0 * * *"
    }
  ]
}
```

This runs the indexer every day at midnight UTC. Check **Vercel Dashboard → Settings → Cron Jobs** to verify.

---

## Architecture

```
Blockchain (Sui)
      │
      ▼ once/day (Vercel Cron)
/api/index ──► Supabase DB
      │         │
      │         ├── wallets
      │         ├── locks
      │         ├── isui_locks
      │         ├── drizzlets
      │         ├── riddle_pools
      │         └── *_cache tables
      │
      ▼ on page load (5min cache)
/api/dashboard ◄── Supabase
      │
      ▼
Next.js pages (SSR)
      │
      ▼
User Browser (mobile/desktop)
```

**Key design principle:** The frontend NEVER hits the blockchain directly. All chain data flows through the indexer → Supabase → API → frontend pipeline.

---

## Reward Formulas

### IKA Lock Rewards

```
drizzlets = (ika_amount / 10) * rate * full_days_elapsed

Lock durations and rates:
  duration = 0  (season)  → rate = 5 drizzlets per 10 IKA per day
  duration = 1  (1 day)   → rate = 1 drizzlet  per 10 IKA per day
  duration = 7  (7 days)  → rate = 2 drizzlets per 10 IKA per day
  duration = 30 (30 days) → rate = 3 drizzlets per 10 IKA per day
```

### iSUI Lock Rewards

```
drizzlets = isui_amount * floor(days_elapsed)

Example: 1000 iSUI locked for 4.5 days = 1000 × 4 = 4000 drizzlets
```

### Token Decimals

```
IKA:  raw / 1e9  (e.g. 6500000000000 → 6500 IKA)
iSUI: raw / 1e9  (e.g. 3040000000    → 3.04 iSUI)
```

---

## Optional: BlockVision RPC

For higher rate limits (recommended for production):

1. Sign up at [blockvision.org](https://blockvision.org)
2. Create an API key
3. Set `SUI_RPC_URL=https://api.blockvision.org/v2/sui/mainnet/rpc`
4. The free tier gives 100 req/sec vs 10 req/sec on public RPC

---

## Updating the IKA Package ID

When you know the actual IKA package address on Sui mainnet:

1. Update `IKA_PACKAGE_ID` in your Vercel environment variables
2. The event queries in `lib/sui-rpc.ts` will use this to filter:
   - `::ika_staking::LockStakeIka`
   - `::ika_staking::UnlockStakedIka`
3. Re-run the indexer to backfill historical events

---

## Mobile

The UI is fully responsive:
- Cards stack in 2-column grid on mobile → 4-column on desktop
- Charts resize with ResponsiveContainer
- Leaderboard shows card layout on mobile, full table on desktop
- Navigation collapses labels on small screens

---

## Free Tier Usage Summary

| Service   | What's used          | Free limit     |
|-----------|----------------------|----------------|
| Supabase  | DB + RLS + API       | 500MB, 2GB transfer |
| Vercel    | Hosting + cron jobs  | 100GB bandwidth |
| Sui RPC   | Event queries        | Public, no key needed |

All within free tier for typical analytics usage.
