-- Brand-first OYUNS+ catalog migration.
-- The physical cards table is retained as the coupon table so existing request
-- foreign keys and purchase history remain valid.

CREATE TABLE IF NOT EXISTS public.oyuns_plus_brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(160) NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
    description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
    logo_url TEXT,
    logo_path TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    archived_at TIMESTAMPTZ,
    created_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oyuns_plus_brands_visible
    ON public.oyuns_plus_brands (is_active, archived_at, sort_order, name);

ALTER TABLE public.oyuns_plus_cards
    ADD COLUMN IF NOT EXISTS brand_id UUID,
    ADD COLUMN IF NOT EXISTS value_type VARCHAR(16),
    ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS total_purchase_limit INTEGER,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.oyuns_plus_cards
    ALTER COLUMN image_url DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oyuns_plus_cards_brand_id_fkey') THEN
        ALTER TABLE public.oyuns_plus_cards ADD CONSTRAINT oyuns_plus_cards_brand_id_fkey
            FOREIGN KEY (brand_id) REFERENCES public.oyuns_plus_brands(id) ON DELETE RESTRICT;
    END IF;
END;
$$;

DO $$
DECLARE legacy_id UUID;
BEGIN
    SELECT id INTO legacy_id FROM public.oyuns_plus_brands
    WHERE name = 'Legacy vouchers' ORDER BY created_at LIMIT 1;
    IF legacy_id IS NULL THEN
        INSERT INTO public.oyuns_plus_brands (name, description, is_active, sort_order)
        VALUES ('Legacy vouchers', 'Migrated coupons awaiting brand and discount review.', FALSE, 2147483647)
        RETURNING id INTO legacy_id;
    END IF;
    UPDATE public.oyuns_plus_cards
    SET brand_id = legacy_id, value_type = NULL, discount_value = NULL,
        needs_review = TRUE, updated_at = NOW()
    WHERE brand_id IS NULL;
END;
$$;

ALTER TABLE public.oyuns_plus_cards
    ALTER COLUMN brand_id SET NOT NULL,
    ALTER COLUMN needs_review SET NOT NULL,
    ALTER COLUMN needs_review SET DEFAULT FALSE;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oyuns_plus_cards_value_check') THEN
        ALTER TABLE public.oyuns_plus_cards ADD CONSTRAINT oyuns_plus_cards_value_check CHECK (
            needs_review OR (value_type IS NOT NULL AND discount_value IS NOT NULL AND
                ((value_type = 'amount' AND discount_value > 0) OR
                 (value_type = 'percentage' AND discount_value > 0 AND discount_value <= 100)))
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oyuns_plus_cards_value_type_check') THEN
        ALTER TABLE public.oyuns_plus_cards ADD CONSTRAINT oyuns_plus_cards_value_type_check
            CHECK (value_type IS NULL OR value_type IN ('amount', 'percentage'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oyuns_plus_cards_purchase_limit_check') THEN
        ALTER TABLE public.oyuns_plus_cards ADD CONSTRAINT oyuns_plus_cards_purchase_limit_check
            CHECK (total_purchase_limit IS NULL OR total_purchase_limit > 0);
    END IF;
END;
$$;

ALTER TABLE public.oyuns_plus_voucher_requests
    ADD COLUMN IF NOT EXISTS brand_id_snapshot UUID,
    ADD COLUMN IF NOT EXISTS brand_name_snapshot VARCHAR(160),
    ADD COLUMN IF NOT EXISTS value_type_snapshot VARCHAR(16),
    ADD COLUMN IF NOT EXISTS discount_value_snapshot NUMERIC(12, 2),
    ADD COLUMN IF NOT EXISTS country_code_snapshot VARCHAR(2);

CREATE INDEX IF NOT EXISTS idx_oyuns_plus_requests_card_inventory
    ON public.oyuns_plus_voucher_requests (card_id)
    WHERE status IN ('pending', 'fulfilled');

CREATE OR REPLACE FUNCTION public.create_oyuns_plus_voucher_request(
    p_user_id BIGINT, p_card_id UUID, p_receiver_name TEXT, p_receiver_phone TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    card_row public.oyuns_plus_cards%ROWTYPE;
    brand_row public.oyuns_plus_brands%ROWTYPE;
    request_row public.oyuns_plus_voucher_requests%ROWTYPE;
    current_balance INTEGER;
    purchase_count INTEGER;
BEGIN
    PERFORM pg_advisory_xact_lock(p_user_id);
    SELECT * INTO card_row FROM public.oyuns_plus_cards WHERE id = p_card_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CARD_NOT_AVAILABLE' USING ERRCODE = 'P0002'; END IF;

    SELECT * INTO brand_row FROM public.oyuns_plus_brands WHERE id = card_row.brand_id;
    IF NOT FOUND OR NOT card_row.is_active OR card_row.archived_at IS NOT NULL OR
       card_row.needs_review OR NOT brand_row.is_active OR brand_row.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'CARD_NOT_AVAILABLE' USING ERRCODE = 'P0002';
    END IF;
    IF card_row.expires_at IS NOT NULL AND card_row.expires_at <= NOW() THEN
        RAISE EXCEPTION 'CARD_EXPIRED' USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*)::INTEGER INTO purchase_count
    FROM public.oyuns_plus_voucher_requests
    WHERE card_id = card_row.id AND status IN ('pending', 'fulfilled');
    IF card_row.total_purchase_limit IS NOT NULL AND purchase_count >= card_row.total_purchase_limit THEN
        RAISE EXCEPTION 'CARD_SOLD_OUT' USING ERRCODE = 'P0001';
    END IF;

    current_balance := COALESCE((SELECT SUM(points)::INTEGER FROM public.oyuns_plus_points_ledger WHERE user_id = p_user_id), 0);
    IF current_balance < card_row.points_price THEN
        RAISE EXCEPTION 'INSUFFICIENT_POINTS' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.oyuns_plus_voucher_requests (
        user_id, card_id, card_name_snapshot, points_price_snapshot, receiver_name,
        receiver_phone, points_spent, brand_id_snapshot, brand_name_snapshot,
        value_type_snapshot, discount_value_snapshot, country_code_snapshot
    ) VALUES (
        p_user_id, card_row.id, card_row.name, card_row.points_price, trim(p_receiver_name),
        p_receiver_phone, card_row.points_price, brand_row.id, brand_row.name,
        card_row.value_type, card_row.discount_value, card_row.country_code
    ) RETURNING * INTO request_row;

    INSERT INTO public.oyuns_plus_points_ledger (user_id, source_type, source_id, points, metadata)
    VALUES (p_user_id, 'voucher_redeem', request_row.id::TEXT, -card_row.points_price,
        jsonb_build_object('request_id', request_row.id::TEXT, 'card_id', card_row.id::TEXT,
            'brand_id', brand_row.id::TEXT, 'card_name', card_row.name, 'brand_name', brand_row.name,
            'value_type', card_row.value_type, 'discount_value', card_row.discount_value));

    RETURN jsonb_build_object('id', request_row.id, 'status', request_row.status,
        'points_spent', request_row.points_spent, 'card_id', request_row.card_id,
        'card_name', request_row.card_name_snapshot, 'brand_id', brand_row.id,
        'brand_name', brand_row.name, 'balance_after', current_balance - card_row.points_price,
        'created_at', request_row.created_at);
END;
$$;

REVOKE ALL ON FUNCTION public.create_oyuns_plus_voucher_request(BIGINT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_oyuns_plus_voucher_request(BIGINT, UUID, TEXT, TEXT) TO service_role;
