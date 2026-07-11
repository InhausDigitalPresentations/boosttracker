# Inhaus Boost Tracker — Supabase + GitHub Pages setup

This connects the tracker to a real Supabase (Postgres) database so your
whole team can open one link and always see the latest data — instantly,
via Supabase Realtime, not just on a timer. Takes about 10 minutes.

There are three parts:
1. A Supabase project (the database)
2. A tiny bit of SQL to set up the tables (copy/paste, no writing SQL yourself)
3. The app files, hosted on GitHub Pages (what people actually open)

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in (you already have an account).
2. Click **New Project**. Give it a name like **Inhaus Boost Tracker**, set a database password (save it somewhere — you likely won't need it again, but keep it safe), pick a region close to your team, and create it.
3. Wait for it to finish provisioning (a minute or two).

## 2. Set up the database

1. In your new project, open the **SQL Editor** from the left sidebar.
2. Click **New query**.
3. Open `supabase_schema.sql` from this project, copy the whole file, and paste it into the editor.
4. Click **Run**.

That single script creates all four tables (`clients`, `team_members`, `boosts`, `archive`), sets up the "Close Month" logic, configures permissions so the app can read/write without anyone logging in, and turns on live updates. You don't need to touch anything else in the database — everything else in the app talks to it automatically.

> If you ever need to re-run this script (say, after an update), it's safe to run again — every statement is written to not fail on a second run.

## 3. Get your API credentials

1. In the Supabase dashboard, go to **Settings > API**.
2. You'll see:
   - **Project URL** — looks like `https://abcdefghijk.supabase.co`
   - **anon public** key — a long string under "Project API keys"

   Both of these are meant to be used in frontend code like this app — they're not secret in the way a password is (that's what the Row Level Security policies in the SQL script are for).

## 4. Point the app at your project

1. Open `db.js` in this project.
2. Near the top, find:
   ```js
   const SUPABASE_URL = 'PASTE_YOUR_SUPABASE_PROJECT_URL_HERE';
   const SUPABASE_ANON_KEY = 'PASTE_YOUR_SUPABASE_ANON_KEY_HERE';
   ```
3. Replace both placeholders with what you copied in step 3.
4. Save the file.

## 5. Publish on GitHub Pages

1. Push all the project files into your GitHub repo: `index.html`, `styles.css`, `db.js`, `utils.js`, `dashboard.js`, `clientDetail.js`, `clients.js`, `archiveView.js`, `settingsView.js`, `modals.js`, `main.js`, `logo.svg`.
   - `supabase_schema.sql` and `SETUP.md` are just for reference — they don't need to be in the live site, but there's no harm leaving them in the repo either.
2. In the repo, go to **Settings > Pages**.
3. Under "Build and deployment," set **Source** to "Deploy from a branch," pick your branch (usually `main`) and folder `/ (root)`, then **Save**.
4. GitHub gives you a URL like `https://yourusername.github.io/your-repo-name/`. That's the link to share with your team.

If you already had this site live before switching to Supabase, just replace the old files with these new ones and push — the URL stays the same.

## How it behaves day to day

- Anyone who opens the link sees whatever is currently in the database — no login required.
- Every add/edit/delete writes straight to Supabase, and everyone else's screen updates within a second or two automatically via Supabase Realtime — no need to refresh or navigate away and back.
- The sidebar footer shows a small sync status dot and a "Refresh now" button if you ever want to force an update immediately.
- You can open your Supabase project's **Table Editor** any time to look at the raw data directly, similar to how you'd look at a spreadsheet.

## Troubleshooting

- **"Almost there — connect Supabase" screen won't go away** → `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `db.js` still have placeholder text, or there's a typo in one of them.
- **"Can't reach Supabase right now"** → most likely your project paused itself after a week of no activity (Free tier only) — open the project in your Supabase dashboard to wake it back up, then hit refresh in the app. Otherwise, double-check your internet connection.
- **"permission denied" errors when adding/editing something** → the SQL script grants the necessary access, but if you ever add new tables or functions by hand later, remember new objects need their own `grant` statements and RLS policies before the app can use them (see the bottom of `supabase_schema.sql` for the pattern to copy).
- **Changes from another person don't show up live** → confirm Realtime is enabled: Supabase dashboard > Database > Replication, and check that `clients`, `team_members`, `boosts`, and `archive` are all toggled on for the `supabase_realtime` publication (the SQL script does this automatically, but it's worth a glance if live updates seem to be missing).
- **Two people editing at the exact same moment** → Postgres handles this natively; there's no risk of edits silently overwriting each other the way a shared spreadsheet sometimes can.
