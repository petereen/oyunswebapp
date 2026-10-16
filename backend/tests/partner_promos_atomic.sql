-- Run only against an isolated database with OYUNS+ migrations applied.
-- Everything below is rolled back after the assertions.
BEGIN;
DO $$
DECLARE
    brand UUID;
    other_brand UUID;
    coupon UUID;
    manual_coupon UUID;
    result JSONB;
    spent INTEGER;
    before_count INTEGER;
BEGIN
    INSERT INTO users(id) VALUES (991991);
    INSERT INTO oyuns_plus_brands(name) VALUES ('Partner integration test') RETURNING id INTO brand;
    INSERT INTO oyuns_plus_brands(name) VALUES ('Other brand') RETURNING id INTO other_brand;
    INSERT INTO oyuns_plus_cards(brand_id,name,points_price,value_type,discount_value,issuance_mode,sku_tier,validity_days,total_purchase_limit)
    VALUES (brand,'VPN 3m',100,'amount',100,'automatic','vpn_3m',30,2) RETURNING id INTO coupon;
    INSERT INTO oyuns_plus_cards(brand_id,name,points_price,value_type,discount_value)
    VALUES (other_brand,'Manual',100,'amount',100) RETURNING id INTO manual_coupon;
    INSERT INTO oyuns_plus_points_ledger(user_id,source_type,source_id,points) VALUES (991991,'test','seed',300);

    -- Existing manual flow still creates a pending request and one ledger debit.
    result := create_oyuns_plus_voucher_request(991991,manual_coupon,'Test','+97699112233');
    ASSERT result->>'status' = 'pending';
    ASSERT (result->>'balance_after')::INTEGER = 200;

    -- Automatic cards cannot use the old manual route.
    BEGIN
        PERFORM create_oyuns_plus_voucher_request(991991,coupon,'Test','+97699112233');
        RAISE EXCEPTION 'expected manual route rejection';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'AUTOMATIC_ISSUANCE_REQUIRED' THEN RAISE; END IF;
    END;

    -- Brand and stale/tampered SKU/price/validity must be rejected before debit.
    BEGIN
        PERFORM issue_partner_promo_code(991991,coupon,other_brand,'vpn_3m',100,30,'GAL-ABCDE-FGHJK','Test','+97699112233');
        RAISE EXCEPTION 'expected brand rejection';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'PARTNER_COUPON_NOT_AVAILABLE' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM issue_partner_promo_code(991991,coupon,brand,'vpn_12m',1,365,'GAL-ABCDE-FGHJK','Test','+97699112233');
        RAISE EXCEPTION 'expected config rejection';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'PARTNER_COUPON_NOT_AVAILABLE' THEN RAISE; END IF;
    END;

    result := issue_partner_promo_code(991991,coupon,brand,'vpn_3m',100,30,'GAL-ABCDE-FGHJK','Test','+97699112233');
    ASSERT result->>'status' = 'fulfilled';
    ASSERT (result->>'balance_after')::INTEGER = 100;
    ASSERT result->>'code' = 'GAL-ABCDE-FGHJK';
    ASSERT (result->>'expires_at')::TIMESTAMPTZ = NOW() + INTERVAL '30 days';
    ASSERT (SELECT status = 'fulfilled' AND confirmation_note LIKE 'GAL-ABCDE-FGHJK%' FROM oyuns_plus_voucher_requests WHERE id = (result->>'id')::UUID);
    ASSERT (SELECT COUNT(*) = 1 FROM loyalty_promo_codes WHERE request_id = (result->>'id')::UUID);

    SELECT COUNT(*) INTO before_count FROM oyuns_plus_voucher_requests WHERE user_id = 991991;
    -- Unique collision occurs after the core debit; the entire operation must roll back.
    BEGIN
        PERFORM issue_partner_promo_code(991991,coupon,brand,'vpn_3m',100,30,'GAL-ABCDE-FGHJK','Test','+97699112233');
        RAISE EXCEPTION 'expected collision';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    ASSERT (SELECT COUNT(*) = before_count FROM oyuns_plus_voucher_requests WHERE user_id = 991991);
    ASSERT (SELECT SUM(points) = 100 FROM oyuns_plus_points_ledger WHERE user_id = 991991);

    PERFORM issue_partner_promo_code(991991,coupon,brand,'vpn_3m',100,30,'GAL-KLMNP-QRSTU','Test','+97699112233');
    ASSERT (SELECT SUM(points) = 0 FROM oyuns_plus_points_ledger WHERE user_id = 991991);
    BEGIN
        PERFORM issue_partner_promo_code(991991,coupon,brand,'vpn_3m',100,30,'GAL-VWXYZ-23456','Test','+97699112233');
        RAISE EXCEPTION 'expected stock rejection';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'CARD_SOLD_OUT' THEN RAISE; END IF;
    END;
    UPDATE oyuns_plus_cards SET total_purchase_limit = NULL WHERE id = coupon;
    BEGIN
        PERFORM issue_partner_promo_code(991991,coupon,brand,'vpn_3m',100,30,'GAL-VWXYZ-23456','Test','+97699112233');
        RAISE EXCEPTION 'expected balance rejection';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'INSUFFICIENT_POINTS' THEN RAISE; END IF;
    END;
    ASSERT (SELECT COUNT(*) = 2 FROM loyalty_promo_codes WHERE user_id = 991991);

    UPDATE oyuns_plus_voucher_requests SET status = 'refunded' WHERE id = (result->>'id')::UUID;
    ASSERT (SELECT status = 'REVOKED' FROM loyalty_promo_codes WHERE code = 'GAL-ABCDE-FGHJK');
    ASSERT NOT has_function_privilege('authenticated', 'issue_partner_promo_code(bigint,uuid,uuid,text,integer,integer,text,text,text)', 'EXECUTE');
    ASSERT NOT has_function_privilege('service_role', '_create_oyuns_plus_voucher_request_core(bigint,uuid,text,text)', 'EXECUTE');
    ASSERT NOT has_table_privilege('authenticated', 'loyalty_promo_codes', 'SELECT');
END;
$$;
ROLLBACK;
