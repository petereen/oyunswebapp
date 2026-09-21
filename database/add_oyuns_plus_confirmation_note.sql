-- Add the optional explanation saved when an admin fulfills an Oyuns+ request.
ALTER TABLE oyuns_plus_voucher_requests
    ADD COLUMN IF NOT EXISTS confirmation_note TEXT
    CHECK (char_length(confirmation_note) <= 2000);

-- Keep the migration compatible with databases created before the column existed.
CREATE OR REPLACE FUNCTION fulfill_oyuns_plus_voucher_request(
    p_request_id UUID,
    p_admin_id BIGINT,
    p_confirmation_photo_path TEXT,
    p_confirmation_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    request_row oyuns_plus_voucher_requests%ROWTYPE;
BEGIN
    SELECT * INTO request_row
    FROM oyuns_plus_voucher_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF request_row.status <> 'pending' THEN
        RAISE EXCEPTION 'REQUEST_NOT_PENDING' USING ERRCODE = 'P0001';
    END IF;
    IF NULLIF(trim(p_confirmation_photo_path), '') IS NULL THEN
        RAISE EXCEPTION 'CONFIRMATION_PHOTO_REQUIRED' USING ERRCODE = 'P0001';
    END IF;

    UPDATE oyuns_plus_voucher_requests
    SET status = 'fulfilled',
        confirmation_photo_path = trim(p_confirmation_photo_path),
        confirmation_note = NULLIF(trim(p_confirmation_note), ''),
        fulfilled_by = p_admin_id,
        fulfilled_at = NOW(),
        updated_at = NOW()
    WHERE id = p_request_id
    RETURNING * INTO request_row;

    RETURN to_jsonb(request_row);
END;
$$;
