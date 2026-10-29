-- Backfill completion fields on group-completed transactions.
-- Run in a transaction and review the row counts before COMMIT.
BEGIN;

-- 1) Recompute durations that were clamped to 0.0 by the old timezone bug.
UPDATE transactions
SET completion_duration_minutes = ROUND(GREATEST(
      0,
      EXTRACT(EPOCH FROM (completed_at - receipt_submitted_at)) / 60.0
        - COALESCE(total_paused_seconds, 0) / 60.0
    )::numeric, 2)
WHERE COALESCE(is_manual, false) = false
  AND status IN ('successful', 'completed')
  AND completion_duration_minutes = 0
  AND completed_at IS NOT NULL
  AND receipt_submitted_at IS NOT NULL;

-- 2) Fill the completing admin with the admin who clicked "send to group".
--    Source: admin_actions audit log. For a group-dispatched invoice, the first
--    transaction_approved action is the send-to-group click.
UPDATE transactions t
SET completed_by_admin = x.admin_user_id
FROM (
    SELECT DISTINCT ON (aa.target_id) aa.target_id, aa.admin_user_id
    FROM admin_actions aa
    JOIN exchange_group_dispatches d ON d.invoice = aa.target_id
    JOIN admin_users a ON a.id = aa.admin_user_id
    WHERE aa.action_type = 'transaction_approved'
    ORDER BY aa.target_id, aa.created_at ASC
) x
WHERE x.target_id = t.invoice
  AND t.completed_by_admin IS NULL
  AND t.status IN ('successful', 'completed');

-- Sanity check before committing.
SELECT count(*) FILTER (WHERE completed_by_admin IS NULL) AS still_no_admin,
       count(*) FILTER (WHERE completion_duration_minutes = 0 AND NOT COALESCE(is_manual,false)) AS still_zero
FROM transactions WHERE status IN ('successful','completed') AND completed_at IS NOT NULL;

-- COMMIT;  -- or ROLLBACK;
