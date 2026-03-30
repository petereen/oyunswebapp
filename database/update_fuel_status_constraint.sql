-- Update fuel_orders status CHECK constraint to include new statuses: 'pending' and 'approved'
-- Old statuses kept for backwards compatibility with existing data

-- Drop old constraint
ALTER TABLE fuel_orders DROP CONSTRAINT IF EXISTS fuel_orders_status_check;

-- Add updated constraint with new statuses
ALTER TABLE fuel_orders ADD CONSTRAINT fuel_orders_status_check
    CHECK (status IN ('pending', 'pending_payment', 'paid', 'approved', 'in_progress', 'fueling_complete', 'completed', 'rejected', 'cancelled'));
