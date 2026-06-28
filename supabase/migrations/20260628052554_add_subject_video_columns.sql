-- Add pinned_subjects and custom_videos columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS pinned_subjects jsonb DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_videos jsonb DEFAULT '{}'::jsonb;