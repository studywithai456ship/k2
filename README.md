# Quant Tracker — Exam Preparation OS

A full-stack exam preparation platform with a web dashboard and a Telegram bot companion. Track your daily study targets, streaks, exam readiness, and receive smart notifications — all backed by Supabase (PostgreSQL).

---

## Table of Contents

- [What Is This Project?](#what-is-this-project)
- [How It Works](#how-it-works)
- [Features](#features)
  - [Website Features](#website-features)
  - [Bot Features](#bot-features)
  - [Website + Bot Integration](#website--bot-integration)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Deployment](#deployment)
  - [Deploy Website Only](#deploy-website-only)
  - [Deploy Bot Only](#deploy-bot-only)
  - [Deploy Both (Website + Bot)](#deploy-both-website--bot)
- [Database Schema](#database-schema)
- [Bot Commands Reference](#bot-commands-reference)
- [Customizable Reminder Times](#customizable-reminder-times)
- [Troubleshooting](#troubleshooting)

---

## What Is This Project?

Quant Tracker is an **exam preparation operating system** designed for competitive exam aspirants (SBI PO, UPSC, CAT, GATE, etc.). It provides:

1. **A web dashboard** where you create a study plan, track daily targets, monitor streaks, view analytics, and assess exam readiness.
2. **A Telegram bot** that mirrors your dashboard — get today's target, check your streak, view the exam countdown, and receive customizable push notifications.

Both the website and bot share the same Supabase database, so your data is always in sync.

---

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web Browser   │     │  Telegram App   │     │   Supabase DB   │
│   (Frontend)    │     │   (Bot User)    │     │  (PostgreSQL)   │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │  HTTP REST API         │  HTTP REST API        │
         │  (JWT auth)            │  (Admin token auth)   │
         ▼                       ▼                       │
┌─────────────────────────────────────────────────────────┐
│                    Express Server (server.js)            │
│  - Auth (register/login/OTP via Telegram)                │
│  - Sync (study plan, streaks, settings)                 │
│  - Bot API endpoints (data for the Telegram bot)       │
│  - Telegram notification on status change                │
└─────────────────────────────────────────────────────────┘
         │                       │
         │                       ▼
         │              ┌─────────────────┐
         │              │  Telegram Bot   │
         │              │   (bot.js)      │
         │              │  - Commands     │
         │              │  - Scheduler    │
         │              │  - Reminders     │
         │              └─────────────────┘
         │
         ▼
┌─────────────────┐
│  Supabase       │
│  - users table  │
│  - otps table   │
│  - settings     │
└─────────────────┘
```

**Data flow:**

1. You register on the web app using your email + Telegram ID (verified via OTP sent to Telegram).
2. The server stores your account in Supabase.
3. You create a study plan on the web — days, topics, videos, files.
4. The bot reads your data via the server's API endpoints (using your Telegram ID).
5. When you mark a task as "in progress" or "done" on the web, the server sends a Telegram notification.
6. The bot's built-in scheduler checks every 60 seconds for due reminders and sends them automatically.

---

## Features

### Website Features

| Feature | Description |
|---|---|
| **Account Registration** | Sign up with email + password, verified via Telegram OTP |
| **Login** | Email or username + password (JWT-based session) |
| **Password Reset** | Reset via Telegram OTP |
| **Study Plan** | Create a day-by-day plan with topics, videos, and practice files |
| **Daily Tracking** | Mark each day as `todo` → `in progress` → `done` |
| **Streak Counter** | Tracks consecutive study days + longest streak |
| **Exam Countdown** | Live countdown to your exam date |
| **Readiness Score** | Composite score based on completion %, accuracy, streak, and time left |
| **Analytics Dashboard** | Completion rate, skipped days, average hours/day, score history |
| **Heatmap** | Visual study activity calendar |
| **Achievements** | Milestone badges for streaks and completion |
| **Leaderboard** | Compare your progress with other aspirants (admin-toggled) |
| **Dark/Light Theme** | Toggle between themes |
| **Revision Tracker** | Track revision sessions and bot notification settings |

### Bot Features

| Feature | Description |
|---|---|
| **`/today`** | Today's study target (topic, videos, files, estimated time) |
| **`/status`** | Progress overview: completion %, streak, readiness, days left |
| **`/streak`** | Current & longest streak, next milestone, motivational message |
| **`/countdown`** | Live exam countdown (days/hours/min/sec) + readiness bar |
| **`/analytics`** | Detailed stats: completed, skipped, avg hours/day, readiness |
| **`/leaderboard`** | Top 10 performers (admin can enable/disable) |
| **`/us`** | Notification settings with inline toggle buttons |
| **`/settime`** | **Customizable reminder times** in 24-hour HH:MM format |
| **`/support`** | Detailed help & feature guide |
| **`/link` / `/unlink`** | Connect/disconnect your Telegram to your web account |
| **`/myid`** | Show your Telegram numeric ID |
| **Admin Panel** | `/admin_panel` — toggle leaderboard/dev mode, view logs, broadcast, health check |
| **`/broadcast`** | Admin-only mass message to all linked users |
| **`/log`** | View recent error logs |
| **`/restart`** | Restart bot polling (admin) |
| **Reminder Scheduler** | Built-in 60-second scheduler that sends morning, evening, countdown, weekly, and missed-day reminders automatically |

### Website + Bot Integration

| Feature | Description |
|---|---|
| **Shared Database** | Both web and bot read/write the same Supabase tables |
| **OTP Delivery** | Registration and password reset OTPs are sent via Telegram |
| **Status Notifications** | Marking a task as "in progress" or "done" on the web triggers a Telegram message |
| **Settings Sync** | Bot notification settings are stored on your user record and accessible from both web and bot |
| **Telegram ID Linking** | Your Telegram ID connects your web account to the bot |

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | HTML, CSS, JavaScript (vanilla, no framework) |
| **Backend** | Node.js, Express |
| **Database** | Supabase (PostgreSQL) |
| **Auth** | Custom JWT + bcrypt (not Supabase Auth — preserves OTP flow) |
| **Bot** | node-telegram-bot-api (long polling) |
| **Notifications** | Telegram Bot API |

---

## Project Structure

```
project/
├── server.js              # Express server (API + static frontend)
├── bot.js                 # Telegram bot (commands + scheduler)
├── package.json           # Dependencies
├── Procfile               # Process manager config (web + worker)
├── .env                   # Environment variables
├── public/                # Frontend (served by Express)
│   ├── index.html
│   ├── components/         # HTML partials (dashboard, settings, etc.)
│   ├── css/               # Stylesheets
│   └── js/                # Frontend JavaScript
├── logs/                  # Error logs (auto-created)
└── README.md              # This file
```

---

## Supabase Database Setup

The app requires three tables in Supabase: `users`, `otps`, and `settings`. A migration file is included that creates all tables, indexes, RLS policies, and seed data.

### Running the Migration

**Option A — Via Supabase Dashboard (SQL Editor):**

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard).
2. Select your project.
3. Open the **SQL Editor** (left sidebar).
4. Click **New query**.
5. Paste the **entire contents** of `supabase/migrations/20260626144344_create_quant_tracker_schema.sql`.
6. Click **Run**.
7. Wait for the "Success" message.
8. **Important:** After running the migration, the PostgREST schema cache needs to refresh. Run this in the same SQL Editor:
   ```sql
   NOTIFY pgrst, 'reload schema';
   ```
   This forces Supabase to reload its internal schema cache so the API recognizes the new tables. Without this, you may see `"Could not find the table 'public.users' in the schema cache"` errors for a few minutes until the cache auto-refreshes.

**Option B — Via the Supabase MCP tools (automated):**

If you're using the Bolt environment with Supabase MCP tools, the migration is applied automatically via `mcp__supabase__apply_migration`. The schema cache refreshes automatically after a few minutes.

### Verifying the Migration

After running the migration, verify the tables exist:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
-- Expected: otps, settings, users
```

### Schema Cache Errors

If you see this error in the logs:

```
Could not find the table 'public.users' in the schema cache
```

It means the PostgREST API hasn't refreshed its schema cache yet. Fix it by:

1. Running `NOTIFY pgrst, 'reload schema';` in the Supabase SQL Editor, OR
2. Waiting 1–2 minutes for the cache to auto-refresh, OR
3. Restarting your server (the server has built-in retry logic for this error).

---

## Environment Variables

Create a `.env` file in the project root:

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Server
PORT=3000
JWT_SECRET=your-jwt-secret
ADMIN_API_TOKEN=your-admin-api-token
API_URL=https://your-app.onrender.com
WEB_URL=https://your-app.onrender.com

# Telegram Bot
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
ADMIN_TELEGRAM_ID=123456789,987654321
```

> **Important — `SUPABASE_SERVICE_ROLE_KEY`:**
> The server uses the **service role key** to bypass RLS for server-side queries (reading/writing user data, OTPs, settings). If this key is missing, the server falls back to the **anon key**, which works but is subject to RLS policies.
>
> **Where to find it:**
> 1. Go to [Supabase Dashboard](https://supabase.com/dashboard) → your project.
> 2. Project Settings (gear icon) → API.
> 3. Under "Project API keys", find the **`service_role`** row.
> 4. Click **Reveal** then copy the key.
> 5. Add it to your `.env` as `SUPABASE_SERVICE_ROLE_KEY`.
>
> **Never expose the service role key in the frontend.** It bypasses all RLS policies. Only the server (`server.js`) should use it.

### How to Get These Values

| Variable | How to Get |
|---|---|
| `SUPABASE_URL` | Supabase dashboard → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API → `service_role` key (click Reveal) |
| `VITE_SUPABASE_URL` | Same as `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API → `anon` key |
| `TELEGRAM_BOT_TOKEN` | Talk to [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` |
| `ADMIN_TELEGRAM_ID` | Talk to [@userinfobot](https://t.me/userinfobot) to get your numeric ID |
| `JWT_SECRET` | Any random string (e.g., `openssl rand -hex 32`) |
| `ADMIN_API_TOKEN` | Any random string the bot uses to authenticate with the server |

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env  # then edit .env with your values

# 3. Start the server (also forks the bot)
npm start

# 4. Or run them separately in two terminals:
node server.js   # terminal 1 — web server
node bot.js       # terminal 2 — bot
```

The server runs on `http://localhost:3000`.

---

## Deployment

### Deploy Website Only

If you only want the web dashboard (no Telegram bot):

1. **Push to GitHub** — push your code to a GitHub repo.

2. **Deploy on Render / Railway / Vercel:**
   - Create a new Web Service.
   - Connect your GitHub repo.
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - Add all environment variables (see [Environment Variables](#environment-variables)).

3. **Set the Procfile** to only run the web process:
   ```procfile
   web: node server.js
   # worker: node bot.js   ← commented out
   ```

4. **Verify:** Visit your deployed URL. You should see the dashboard.

> **Note:** Without the bot, OTP delivery and Telegram notifications won't work. Registration will still work if you skip the Telegram ID field.

---

### Deploy Bot Only

If you only want the Telegram bot (the web app is deployed elsewhere or you're running it separately):

1. **Ensure the web server is deployed** and accessible at a public URL (e.g., `https://your-app.onrender.com`).

2. **Set environment variables** on your bot hosting platform:
   ```env
   TELEGRAM_BOT_TOKEN=your-bot-token
   ADMIN_TELEGRAM_ID=your-telegram-id
   ADMIN_API_TOKEN=your-admin-token
   API_URL=https://your-app.onrender.com
   WEB_URL=https://your-app.onrender.com
   ```

3. **Deploy the bot as a background worker:**

   **On Render:**
   - Create a new **Background Worker** service.
   - Connect your GitHub repo.
   - **Build Command:** `npm install`
   - **Start Command:** `node bot.js`
   - Add the environment variables above.

   **On Railway:**
   - Create a new project → Deploy from GitHub.
   - Add a new service → **Worker**.
   - Set the start command to `node bot.js`.
   - Add environment variables.

   **On a VPS (PM2):**
   ```bash
   npm install
   pm2 start bot.js --name quant-bot
   pm2 save
   pm2 startup
   ```

4. **Set the Procfile** to only run the worker:
   ```procfile
   # web: node server.js   ← commented out
   worker: node bot.js
   ```

5. **Verify:** Send `/start` to your bot on Telegram. It should respond with the welcome message.

---

### Deploy Both (Website + Bot)

To run both the web server and the bot on the same host:

#### Option A: Single Process (Recommended for Render free tier)

The `server.js` automatically forks `bot.js` as a child process. You only need one web service:

1. **Procfile:**
   ```procfile
   web: node server.js
   # worker: node bot.js   ← not needed; server forks the bot
   ```

2. **Deploy on Render:**
   - Create a Web Service.
   - **Start Command:** `node server.js`
   - Add all environment variables.
   - The server starts, then forks the bot automatically.

3. **Verify:**
   - Visit the web URL → dashboard loads.
   - Send `/start` to the bot → it responds.

#### Option B: Separate Processes (Recommended for production)

For better isolation and scaling, run them as separate services:

1. **Procfile:**
   ```procfile
   web: node server.js
   worker: node bot.js
   ```

2. **On Render:**
   - Deploy as a **Web Service** (runs `server.js`).
   - Deploy a second **Background Worker** (runs `bot.js`).
   - Both share the same GitHub repo and environment variables.

3. **Important:** Comment out the `fork('./bot.js')` line at the bottom of `server.js` to prevent the web service from also starting a bot:
   ```javascript
   // fork('./bot.js');  // ← comment this out when running bot as a separate worker
   ```

4. **Verify:**
   - Web URL loads.
   - Bot responds on Telegram.
   - Both share the same Supabase database.

---

## Database Schema

The app uses three Supabase tables:

### `users`
| Column | Type | Description |
|---|---|---|
| `id` | uuid (PK) | User ID |
| `email` | text (unique) | Email address |
| `password` | text | Bcrypt hash |
| `telegram_id` | bigint | Telegram numeric user ID |
| `username` | text | Display name |
| `exam_name` | text | Exam name (e.g., "SBI PO") |
| `exam_date` | text | Exam date (YYYY-MM-DD or DD-MM-YYYY) |
| `days` | jsonb | Array of day objects (study plan) |
| `streak` | int | Current streak |
| `longest_streak` | int | Longest streak |
| `revision_tracker` | jsonb | Contains `botSettings` sub-object |
| `subscription` | bool | Premium flag |
| `is_verified` | bool | Telegram verified |
| `created_at` | timestamptz | Registration time |

### `otps`
| Column | Type | Description |
|---|---|---|
| `id` | uuid (PK) | OTP ID |
| `telegram_id` | bigint | Telegram user ID |
| `otp` | text | 6-digit code |
| `action` | text | `register` or `reset` |
| `expires_at` | timestamptz | Expiry (10 min) |
| `used` | bool | Consumed flag |

### `settings`
| Column | Type | Description |
|---|---|---|
| `id` | uuid (PK) | Setting ID |
| `key` | text (unique) | Setting key (`free_mode`, `dev_mode`) |
| `value` | jsonb | Setting value (boolean) |

### Bot Settings (inside `users.revision_tracker.botSettings`)
| Field | Type | Default | Description |
|---|---|---|---|
| `dailyReminder` | bool | false | Morning reminder toggle |
| `morningTime` | text | "05:00" | Morning reminder time (24h HH:MM) |
| `interval` | int | 30 | Interval reminder minutes |
| `eveningCheckin` | bool | false | Evening check-in toggle |
| `eveningTime` | text | "21:00" | Evening check-in time (24h HH:MM) |
| `completionCheck` | bool | false | Completion confirmation |
| `countdownAlerts` | bool | false | Daily countdown updates |
| `missedAlerts` | bool | false | Missed day warnings |
| `weeklySummary` | bool | false | Weekly recap |

---

## Bot Commands Reference

### General Commands
| Command | Description |
|---|---|
| `/start` | Welcome message + main menu |
| `/help` | Full command list |
| `/link <username>` | Link your Telegram to your web account |
| `/unlink` | Unlink your Telegram |
| `/myid` | Show your Telegram numeric ID |
| `/today` | Today's study target |
| `/status` | Progress overview |
| `/streak` | Streak report + motivation |
| `/countdown` | Exam countdown timer |
| `/analytics` | Detailed statistics |
| `/leaderboard` | Top 10 users (if enabled) |
| `/us` | Notification settings (inline buttons) |
| `/settime morning HH:MM` | Set morning reminder time |
| `/settime evening HH:MM` | Set evening check-in time |
| `/support` | Full support & feature guide |

### Admin Commands
| Command | Description |
|---|---|
| `/admin_panel` | Admin dashboard (toggles, logs, health) |
| `/broadcast <message>` | Send a message to all users |
| `/log` | View recent error logs |
| `/restart` | Restart bot polling |

---

## Customizable Reminder Times

You can set any reminder time in **24-hour HH:MM format** (00:00 to 23:59):

### Via Command
```
/settime morning 06:30    → Morning reminder at 6:30 AM
/settime evening 22:00   → Evening check-in at 10:00 PM
```

### Via Inline Buttons
1. Send `/us` to open settings.
2. Tap **"🕐 Set Morning Time"** or **"🕐 Set Evening Time"**.
3. Choose a preset or use the `/settime` command for a custom time.

### How the Scheduler Works
- The bot checks every **60 seconds** for due reminders.
- When the current time matches your configured time, the reminder is sent.
- Each reminder is sent **once per day** (deduplication prevents repeats).
- Times use the **server's timezone**. Make sure your hosting platform's timezone matches your local timezone, or adjust accordingly.

---

## Troubleshooting

### Bot not responding
- Check that `TELEGRAM_BOT_TOKEN` is correct.
- Check server logs for polling errors.
- Try `/restart` (admin) to restart polling.
- Ensure the bot isn't running in two places simultaneously (causes polling conflicts).

### Settings not saving
- Run `/link <username>` to ensure your account is linked.
- Check that `ADMIN_API_TOKEN` matches between server and bot.
- Verify the server is running and accessible at `API_URL`.

### OTP not received
- Ensure your Telegram ID is correct (use `/myid` to check).
- Check that the bot has started a conversation with you (send `/start` first).
- OTP rate limit: 3 per 10 minutes, 60-second cooldown between requests.

### Database connection issues
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.
- Check `/api/db-health` endpoint for database status.
- Ensure the Supabase project is not paused (free tier pauses after inactivity).

### Web notifications not reaching Telegram
- Ensure your Telegram ID is linked to your account (`/link`).
- Check that `TELEGRAM_BOT_TOKEN` is set on the server.
- The server sends notifications via the Telegram Bot API directly.

---

## License

This project is proprietary. All rights reserved.
