-- SQL to add email column to users table
-- Run this on your Supabase database

-- Add email column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Optional: Add index for faster email lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Optional: Add unique constraint if emails should be unique
-- ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
