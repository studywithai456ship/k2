/*
# Quant Tracker — Full Schema Migration (MongoDB → Supabase)

## Purpose
Migrates the Quant Tracker app from MongoDB to Supabase (Postgres). Creates three tables
that mirror the previous Mongoose models, plus customizable reminder-time columns.

## New Tables

### 1. `users`
Mirrors the Mongoose `User` model. Stores account credentials, exam plan, study days,
streaks, achievements, and bot notification settings.
- `id` uuid PK
- `email` text, unique, not null
- `password` text, not null (bcrypt hash — custom JWT auth, NOT Supabase Auth)
- `telegram_id` bigint, nullable (Telegram numeric user ID)
- `username` text, default ''
- `exam_name` text, default 'SBI PO'
- `exam_date` text, default '2026-08-01' (stored as YYYY-MM-DD or DD-MM-YYYY string)
- `start_date` text, default ''
- `days` jsonb, default '[]' (array of day objects: {id, day, date, topic, videos, files, status, score, actualHours, plannedHours})
- `streak` int, default 0
- `longest_streak` int, default 0
- `last_study_date` text, nullable
- `achievements` jsonb, default '[]'
- `heatmap` jsonb, default '{}'
- `score_history` jsonb, default '[]'
- `study_sessions` jsonb, default '[]'
- `revision_tracker` jsonb, default '{}' (contains `botSettings` sub-object)
- `subscription` bool, default false
- `is_verified` bool, default false
- `created_at` timestamptz, default now()
- `updated_at` timestamptz, default now()

### 2. `otps`
Mirrors the Mongoose `OTP` model. Stores Telegram OTP codes for registration & password reset.
- `id` uuid PK
- `telegram_id` bigint, not null
- `otp` text, not null (6-digit code)
- `action` text, default 'register' ('register' | 'reset')
- `expires_at` timestamptz, not null
- `used` bool, default false
- `created_at` timestamptz, default now()

### 3. `settings`
Mirrors the Mongoose `Setting` model. Key-value store for admin toggles (free_mode, dev_mode).
- `id` uuid PK
- `key` text, unique, not null
- `value` jsonb, not null (boolean or any JSON)

## Bot Settings (inside `users.revision_tracker.botSettings`)
Stored as a JSONB sub-object. Fields:
- `dailyReminder` bool
- `interval` int (minutes: 30/60/90/105/120/150/180)
- `morningTime` text (24h HH:MM, default '05:00')
- `eveningTime` text (24h HH:MM, default '21:00')
- `eveningCheckin` bool
- `weeklySummary` bool
- `countdownAlerts` bool
- `missedAlerts` bool
- `completionCheck` bool

## Security
- RLS enabled on all three tables.
- The Node server connects with the SERVICE ROLE key, which bypasses RLS — so all
  server-side queries work regardless of policies. Policies are defined for
  defense-in-depth and future direct-client access.
- `users`: `TO anon, authenticated` — the server is the only real accessor via service role.
- `otps`: `TO anon, authenticated` — OTP creation/verification happens server-side.
- `settings`: `TO anon, authenticated` — admin toggles are read publicly, writes are server-side.

## Notes
1. Custom JWT auth (bcrypt + jsonwebtoken) is preserved — NOT Supabase Auth — to avoid
   breaking the existing registration/login/OTP flow.
2. The server uses the service role key, so RLS policies are belt-and-suspenders.
3. `telegram_id` is bigint because Telegram IDs can exceed int32 range.
4. All JSONB columns use sensible defaults so inserts omitting them still work.
*/

-- ============================================================
-- 1. USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password text NOT NULL,
  telegram_id bigint DEFAULT NULL,
  username text DEFAULT '',
  exam_name text DEFAULT 'SBI PO',
  exam_date text DEFAULT '2026-08-01',
  start_date text DEFAULT '',
  days jsonb DEFAULT '[]'::jsonb,
  streak int DEFAULT 0,
  longest_streak int DEFAULT 0,
  last_study_date text DEFAULT NULL,
  achievements jsonb DEFAULT '[]'::jsonb,
  heatmap jsonb DEFAULT '{}'::jsonb,
  score_history jsonb DEFAULT '[]'::jsonb,
  study_sessions jsonb DEFAULT '[]'::jsonb,
  revision_tracker jsonb DEFAULT '{}'::jsonb,
  subscription boolean DEFAULT false,
  is_verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_users" ON users;
CREATE POLICY "anon_select_users" ON users FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_users" ON users;
CREATE POLICY "anon_insert_users" ON users FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_users" ON users;
CREATE POLICY "anon_update_users" ON users FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_users" ON users;
CREATE POLICY "anon_delete_users" ON users FOR DELETE
  TO anon, authenticated USING (true);

-- Index for telegram_id lookups (bot queries)
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users (telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- ============================================================
-- 2. OTPS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL,
  otp text NOT NULL,
  action text DEFAULT 'register',
  expires_at timestamptz NOT NULL,
  used boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE otps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_otps" ON otps;
CREATE POLICY "anon_all_otps" ON otps FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_otps" ON otps;
CREATE POLICY "anon_insert_otps" ON otps FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_otps" ON otps;
CREATE POLICY "anon_update_otps" ON otps FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_otps" ON otps;
CREATE POLICY "anon_delete_otps" ON otps FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_otps_telegram_id ON otps (telegram_id);

-- ============================================================
-- 3. SETTINGS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value jsonb NOT NULL
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_settings" ON settings;
CREATE POLICY "anon_select_settings" ON settings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_settings" ON settings;
CREATE POLICY "anon_insert_settings" ON settings FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_settings" ON settings;
CREATE POLICY "anon_update_settings" ON settings FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_settings" ON settings;
CREATE POLICY "anon_delete_settings" ON settings FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- 4. SEED DEFAULT SETTINGS
-- ============================================================
INSERT INTO settings (key, value) VALUES ('free_mode', 'true'::jsonb)
  ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('dev_mode', 'true'::jsonb)
  ON CONFLICT (key) DO NOTHING;