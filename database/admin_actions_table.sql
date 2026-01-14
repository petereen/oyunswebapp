-- Create admin_actions table for audit logging
CREATE TABLE IF NOT EXISTS admin_actions (
    id BIGSERIAL PRIMARY KEY,
    admin_user_id BIGINT NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    target_type VARCHAR(50),
    target_id VARCHAR(255),
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_user_id ON admin_actions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at ON admin_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_action_type ON admin_actions(action_type);

-- Add comments for documentation
COMMENT ON TABLE admin_actions IS 'Audit log of all admin actions for security and monitoring';
COMMENT ON COLUMN admin_actions.admin_user_id IS 'Telegram user ID of the admin who performed the action';
COMMENT ON COLUMN admin_actions.action_type IS 'Type of action: kyc_approve, kyc_reject, transaction_approve, transaction_complete, transaction_reject, panel_access, etc.';
COMMENT ON COLUMN admin_actions.target_type IS 'Type of target: user, transaction, etc.';
COMMENT ON COLUMN admin_actions.target_id IS 'ID of the affected resource (user_id, invoice, etc.)';
COMMENT ON COLUMN admin_actions.details IS 'Additional context (rejection reason, comments, IP address, etc.)';
