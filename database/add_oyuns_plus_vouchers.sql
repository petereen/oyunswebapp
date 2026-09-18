-- Oyuns+ voucher marketplace and auditable redemption/refund workflow.
-- Run after add_oyuns_plus_referral.sql in Supabase SQL editor.

CREATE TABLE IF NOT EXISTS oyuns_plus_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
    description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
    points_price INTEGER NOT NULL CHECK (points_price > 0),
    country_code VARCHAR(2) NOT NULL DEFAULT 'mn' CHECK (country_code IN ('mn', 'ru')),
    image_url TEXT NOT NULL,
    image_path TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    archived_at TIMESTAMPTZ,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oyuns_plus_cards_visible
    ON oyuns_plus_cards (is_active, archived_at, created_at DESC);

CREATE TABLE IF NOT EXISTS oyuns_plus_voucher_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    card_id UUID NOT NULL REFERENCES oyuns_plus_cards(id) ON DELETE RESTRICT,
    card_name_snapshot VARCHAR(160) NOT NULL,
    points_price_snapshot INTEGER NOT NULL CHECK (points_price_snapshot > 0),
    receiver_name VARCHAR(160) NOT NULL CHECK (char_length(trim(receiver_name)) BETWEEN 1 AND 160),
    receiver_phone VARCHAR(20) NOT NULL,
    points_spent INTEGER NOT NULL CHECK (points_spent > 0),
    status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'refunded')),
    confirmation_photo_path TEXT,
    refund_reason TEXT,
    fulfilled_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    refunded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fulfilled_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_oyuns_plus_requests_user_created
    ON oyuns_plus_voucher_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_oyuns_plus_requests_status_created
    ON oyuns_plus_voucher_requests (status, created_at DESC);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
    ('oyuns-plus-cards', 'oyuns-plus-cards', TRUE, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp']),
    ('oyuns-plus-confirmations', 'oyuns-plus-confirmations', FALSE, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION create_oyuns_plus_voucher_request(
    p_user_id BIGINT,
    p_card_id UUID,
    p_receiver_name TEXT,
    p_receiver_phone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    card_row oyuns_plus_cards%ROWTYPE;
    request_row oyuns_plus_voucher_requests%ROWTYPE;
    current_balance INTEGER;
BEGIN
    -- All redemption attempts for one user serialize on the same advisory lock.
    PERFORM pg_advisory_xact_lock(p_user_id);

    SELECT * INTO card_row
    FROM oyuns_plus_cards
    WHERE id = p_card_id
      AND is_active = TRUE
      AND archived_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CARD_NOT_AVAILABLE' USING ERRCODE = 'P0002';
    END IF;

    current_balance := COALESCE((
        SELECT SUM(points)::INTEGER
        FROM oyuns_plus_points_ledger
        WHERE user_id = p_user_id
    ), 0);

    IF current_balance < card_row.points_price THEN
        RAISE EXCEPTION 'INSUFFICIENT_POINTS' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO oyuns_plus_voucher_requests (
        user_id,
        card_id,
        card_name_snapshot,
        points_price_snapshot,
        receiver_name,
        receiver_phone,
        points_spent
    ) VALUES (
        p_user_id,
        card_row.id,
        card_row.name,
        card_row.points_price,
        trim(p_receiver_name),
        p_receiver_phone,
        card_row.points_price
    )
    RETURNING * INTO request_row;

    INSERT INTO oyuns_plus_points_ledger (
        user_id,
        source_type,
        source_id,
        points,
        metadata
    ) VALUES (
        p_user_id,
        'voucher_redeem',
        request_row.id::TEXT,
        -card_row.points_price,
        jsonb_build_object(
            'request_id', request_row.id::TEXT,
            'card_id', card_row.id::TEXT,
            'card_name', card_row.name
        )
    );

    RETURN jsonb_build_object(
        'id', request_row.id,
        'status', request_row.status,
        'points_spent', request_row.points_spent,
        'card_id', request_row.card_id,
        'card_name', request_row.card_name_snapshot,
        'balance_after', current_balance - card_row.points_price,
        'created_at', request_row.created_at
    );
END;
$$;

CREATE OR REPLACE FUNCTION fulfill_oyuns_plus_voucher_request(
    p_request_id UUID,
    p_admin_id BIGINT,
    p_confirmation_photo_path TEXT
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
        fulfilled_by = p_admin_id,
        fulfilled_at = NOW(),
        updated_at = NOW()
    WHERE id = p_request_id
    RETURNING * INTO request_row;

    RETURN to_jsonb(request_row);
END;
$$;

CREATE OR REPLACE FUNCTION refund_oyuns_plus_voucher_request(
    p_request_id UUID,
    p_admin_id BIGINT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    request_row oyuns_plus_voucher_requests%ROWTYPE;
    current_balance INTEGER;
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
    IF NULLIF(trim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'REFUND_REASON_REQUIRED' USING ERRCODE = 'P0001';
    END IF;

    UPDATE oyuns_plus_voucher_requests
    SET status = 'refunded',
        refund_reason = trim(p_reason),
        refunded_by = p_admin_id,
        refunded_at = NOW(),
        updated_at = NOW()
    WHERE id = p_request_id
    RETURNING * INTO request_row;

    INSERT INTO oyuns_plus_points_ledger (
        user_id,
        source_type,
        source_id,
        points,
        metadata
    ) VALUES (
        request_row.user_id,
        'voucher_refund',
        request_row.id::TEXT,
        request_row.points_spent,
        jsonb_build_object(
            'request_id', request_row.id::TEXT,
            'card_id', request_row.card_id::TEXT,
            'card_name', request_row.card_name_snapshot,
            'reason', request_row.refund_reason
        )
    );

    current_balance := COALESCE((
        SELECT SUM(points)::INTEGER
        FROM oyuns_plus_points_ledger
        WHERE user_id = request_row.user_id
    ), 0);

    RETURN jsonb_build_object(
        'request', to_jsonb(request_row),
        'balance_after', current_balance
    );
END;
$$;

REVOKE ALL ON FUNCTION create_oyuns_plus_voucher_request(BIGINT, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION fulfill_oyuns_plus_voucher_request(UUID, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION refund_oyuns_plus_voucher_request(UUID, BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_oyuns_plus_voucher_request(BIGINT, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION fulfill_oyuns_plus_voucher_request(UUID, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION refund_oyuns_plus_voucher_request(UUID, BIGINT, TEXT) TO service_role;

COMMENT ON TABLE oyuns_plus_cards IS 'Purchasable Oyuns+ voucher cards; archive instead of deleting.';
COMMENT ON TABLE oyuns_plus_voucher_requests IS 'Auditable Oyuns+ voucher requests with immutable point/card snapshots.';
