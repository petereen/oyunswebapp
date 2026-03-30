-- Add approval_image_url column to fuel_orders table
-- This stores the QR/barcode image URL that admin attaches when approving non-dispenser station orders
ALTER TABLE fuel_orders ADD COLUMN IF NOT EXISTS approval_image_url TEXT;
