-- Automatic partner coupons extend the existing catalog, request and points ledger.
ALTER TABLE public.oyuns_plus_cards
    ADD COLUMN issuance_mode TEXT NOT NULL DEFAULT 'manual' CHECK (issuance_mode IN ('manual', 'automatic')),
    ADD COLUMN sku_tier TEXT,
    ADD COLUMN validity_days INTEGER,
    ADD CONSTRAINT oyuns_plus_automatic_config CHECK (
        issuance_mode = 'manual' OR (
            sku_tier IS NOT NULL AND sku_tier ~ '^[a-z][a-z0-9_]{0,79}$'
            AND validity_days IS NOT NULL AND validity_days BETWEEN 1 AND 3650
        )
    );

CREATE TABLE public.loyalty_promo_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE CHECK (code ~ '^GAL-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$'),
    user_id BIGINT NOT NULL REFERENCES public.users(id),
    brand_id UUID NOT NULL REFERENCES public.oyuns_plus_brands(id),
    request_id UUID NOT NULL UNIQUE REFERENCES public.oyuns_plus_voucher_requests(id),
    sku_tier TEXT NOT NULL,
    points_spent INTEGER NOT NULL CHECK (points_spent > 0),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > issued_at)
);
CREATE INDEX loyalty_promo_codes_brand_id_idx ON public.loyalty_promo_codes(brand_id);
ALTER TABLE public.loyalty_promo_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loyalty_promo_codes FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.loyalty_promo_codes TO service_role;

CREATE OR REPLACE FUNCTION public._create_oyuns_plus_voucher_request_core(
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
    card_row public.oyuns_plus_cards%ROWTYPE;
    brand_row public.oyuns_plus_brands%ROWTYPE;
    request_row public.oyuns_plus_voucher_requests%ROWTYPE;
    current_balance INTEGER;
    purchase_count INTEGER;
BEGIN
    -- Serialize redemptions for one user and lock this coupon before checking stock.
    PERFORM pg_advisory_xact_lock(p_user_id);

    SELECT * INTO card_row
    FROM public.oyuns_plus_cards
    WHERE id = p_card_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CARD_NOT_AVAILABLE' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO brand_row
    FROM public.oyuns_plus_brands
    WHERE id = card_row.brand_id;

    IF NOT FOUND
       OR NOT card_row.is_active
       OR card_row.archived_at IS NOT NULL
       OR card_row.needs_review
       OR NOT brand_row.is_active
       OR brand_row.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'CARD_NOT_AVAILABLE' USING ERRCODE = 'P0002';
    END IF;

    IF card_row.expires_at IS NOT NULL AND card_row.expires_at <= NOW() THEN
        RAISE EXCEPTION 'CARD_EXPIRED' USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*)::INTEGER INTO purchase_count
    FROM public.oyuns_plus_voucher_requests
    WHERE card_id = card_row.id
      AND status IN ('pending', 'fulfilled');

    IF card_row.total_purchase_limit IS NOT NULL
       AND purchase_count >= card_row.total_purchase_limit THEN
        RAISE EXCEPTION 'CARD_SOLD_OUT' USING ERRCODE = 'P0001';
    END IF;

    current_balance := COALESCE((
        SELECT SUM(points)::INTEGER
        FROM public.oyuns_plus_points_ledger
        WHERE user_id = p_user_id
    ), 0);

    IF current_balance < card_row.points_price THEN
        RAISE EXCEPTION 'INSUFFICIENT_POINTS' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.oyuns_plus_voucher_requests (
        user_id,
        card_id,
        card_name_snapshot,
        points_price_snapshot,
        receiver_name,
        receiver_phone,
        points_spent,
        brand_id_snapshot,
        brand_name_snapshot,
        value_type_snapshot,
        discount_value_snapshot,
        country_code_snapshot
    ) VALUES (
        p_user_id,
        card_row.id,
        card_row.name,
        card_row.points_price,
        trim(p_receiver_name),
        p_receiver_phone,
        card_row.points_price,
        brand_row.id,
        brand_row.name,
        card_row.value_type,
        card_row.discount_value,
        card_row.country_code
    )
    RETURNING * INTO request_row;

    INSERT INTO public.oyuns_plus_points_ledger (
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
            'brand_id', brand_row.id::TEXT,
            'card_name', card_row.name,
            'brand_name', brand_row.name,
            'value_type', card_row.value_type,
            'discount_value', card_row.discount_value
        )
    );

    RETURN jsonb_build_object(
        'id', request_row.id,
        'status', request_row.status,
        'points_spent', request_row.points_spent,
        'card_id', request_row.card_id,
        'card_name', request_row.card_name_snapshot,
        'brand_id', brand_row.id,
        'brand_name', brand_row.name,
        'balance_after', current_balance - card_row.points_price,
        'created_at', request_row.created_at
    );
END;
$$;


-- Keep old callers manual-only; lock in the same order as the core redemption.
CREATE OR REPLACE FUNCTION public.create_oyuns_plus_voucher_request(
    p_user_id BIGINT, p_card_id UUID, p_receiver_name TEXT, p_receiver_phone TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE mode TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(p_user_id);
    SELECT issuance_mode INTO mode FROM public.oyuns_plus_cards WHERE id = p_card_id FOR UPDATE;
    IF mode = 'automatic' THEN
        RAISE EXCEPTION 'AUTOMATIC_ISSUANCE_REQUIRED';
    END IF;
    RETURN public._create_oyuns_plus_voucher_request_core(p_user_id, p_card_id, p_receiver_name, p_receiver_phone);
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_partner_promo_code(
    p_user_id BIGINT, p_card_id UUID, p_partner_brand_id UUID,
    p_sku_tier TEXT, p_points_spent INTEGER, p_validity_days INTEGER,
    p_code TEXT, p_receiver_name TEXT, p_receiver_phone TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    card public.oyuns_plus_cards%ROWTYPE;
    result JSONB;
    promo public.loyalty_promo_codes%ROWTYPE;
    note TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(p_user_id);
    SELECT * INTO card FROM public.oyuns_plus_cards WHERE id = p_card_id FOR UPDATE;
    IF NOT FOUND OR p_partner_brand_id IS NULL OR card.issuance_mode <> 'automatic' OR card.brand_id <> p_partner_brand_id
       OR card.sku_tier IS DISTINCT FROM p_sku_tier
       OR card.points_price IS DISTINCT FROM p_points_spent
       OR card.validity_days IS DISTINCT FROM p_validity_days THEN
        RAISE EXCEPTION 'PARTNER_COUPON_NOT_AVAILABLE';
    END IF;
    -- Core performs current brand/activity/expiry/stock/balance checks and ledger debit.
    result := public._create_oyuns_plus_voucher_request_core(p_user_id, p_card_id, p_receiver_name, p_receiver_phone);
    INSERT INTO public.loyalty_promo_codes(code, user_id, brand_id, request_id, sku_tier, points_spent, expires_at)
    VALUES (p_code, p_user_id, card.brand_id, (result->>'id')::UUID, card.sku_tier,
            card.points_price, NOW() + make_interval(days => card.validity_days))
    RETURNING * INTO promo;
    note := promo.code || E'\n' || promo.sku_tier || E'\n' || to_char(promo.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC';
    UPDATE public.oyuns_plus_voucher_requests SET status = 'fulfilled', confirmation_note = note,
        fulfilled_at = NOW(), updated_at = NOW() WHERE id = promo.request_id;
    RETURN result || jsonb_build_object('status', 'fulfilled', 'code', promo.code,
        'sku_tier', promo.sku_tier, 'issued_at', promo.issued_at, 'expires_at', promo.expires_at,
        'confirmation_note', note);
END;
$$;

-- Any future refund path must invalidate the associated code in the same transaction.
CREATE OR REPLACE FUNCTION public.revoke_refunded_partner_promo_code()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.status = 'refunded' THEN
        UPDATE public.loyalty_promo_codes SET status = 'REVOKED' WHERE request_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER revoke_refunded_partner_promo_code AFTER UPDATE OF status
ON public.oyuns_plus_voucher_requests FOR EACH ROW EXECUTE FUNCTION public.revoke_refunded_partner_promo_code();

REVOKE ALL ON FUNCTION public._create_oyuns_plus_voucher_request_core(BIGINT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.issue_partner_promo_code(BIGINT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_partner_promo_code(BIGINT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.create_oyuns_plus_voucher_request(BIGINT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_oyuns_plus_voucher_request(BIGINT, UUID, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.revoke_refunded_partner_promo_code() FROM PUBLIC, anon, authenticated;
