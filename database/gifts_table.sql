-- SQL to create gifts table for the gift sending feature
-- Run this on your Supabase database

-- Create gifts table
CREATE TABLE IF NOT EXISTS gifts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    invoice VARCHAR(50) UNIQUE NOT NULL,
    
    -- Sender info
    sender_user_id BIGINT NOT NULL REFERENCES users(id),
    
    -- Recipient info
    recipient_user_id BIGINT REFERENCES users(id),
    recipient_phone VARCHAR(50) NOT NULL,
    recipient_name VARCHAR(255),
    
    -- Gift details
    gift_card_url TEXT NOT NULL,
    message TEXT CHECK (char_length(message) <= 1000),
    from_name VARCHAR(100),  -- "From who" display name on the gift
    
    -- Transaction details
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('buy', 'sell')),
    amount DECIMAL(18, 2) NOT NULL,
    currency_from VARCHAR(10) NOT NULL,
    currency_to VARCHAR(10) NOT NULL,
    rate DECIMAL(18, 4) NOT NULL,
    
    -- Bank details
    admin_bank_id INTEGER,
    sender_receipt_url TEXT,
    recipient_bank_details TEXT,
    
    -- Admin processing
    admin_bill_url TEXT,
    rejection_comment TEXT,
    completed_by_admin BIGINT,
    
    -- Status: 
    -- 'pending_recipient' - waiting for recipient to confirm bank details
    -- 'pending_admin' - recipient confirmed, waiting for admin to process
    -- 'approved' - admin approved, processing
    -- 'completed' - gift successfully delivered
    -- 'rejected' - gift rejected by admin
    status VARCHAR(20) NOT NULL DEFAULT 'pending_recipient' 
        CHECK (status IN ('pending_recipient', 'pending_admin', 'approved', 'completed', 'rejected')),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    confirmed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_gifts_sender ON gifts(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_gifts_recipient ON gifts(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_gifts_status ON gifts(status);
CREATE INDEX IF NOT EXISTS idx_gifts_invoice ON gifts(invoice);
CREATE INDEX IF NOT EXISTS idx_gifts_recipient_phone ON gifts(recipient_phone);

-- Create gift_cards table to store available gift card images
CREATE TABLE IF NOT EXISTS gift_cards (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    image_url TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert gift cards with actual bucket files
-- These URLs point to images in the Supabase storage "gift_card" bucket
INSERT INTO gift_cards (name, image_url, display_order) VALUES 
    ('🎂 Төрсөн өдөр', 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/gift_card/birthday.jpg', 1),
    ('🌸 Ерөнхий', 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/gift_card/general.jpg', 2),
    ('🌙 Цагаан сар 1', 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/gift_card/tsagaansar1.jpg', 3),
    ('🌙 Цагаан сар 2', 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/gift_card/tsagaansar2.jpg', 4),
    ('❤️ Валентин', 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/gift_card/valentine.jpg', 5)
ON CONFLICT DO NOTHING;

-- Create storage bucket for gift cards (run this in Supabase dashboard or via API)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('gift_card', 'gift_card', true);
