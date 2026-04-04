-- Add language preference column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS lang TEXT DEFAULT 'mn';

-- Update existing users to have 'mn' as default language
UPDATE users SET lang = 'mn' WHERE lang IS NULL;
