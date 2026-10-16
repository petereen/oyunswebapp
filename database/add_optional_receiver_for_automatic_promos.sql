-- Automatic promo issuance does not need a separate receiver name or phone.
ALTER TABLE public.oyuns_plus_voucher_requests
    ALTER COLUMN receiver_name DROP NOT NULL,
    ALTER COLUMN receiver_phone DROP NOT NULL,
    DROP CONSTRAINT IF EXISTS oyuns_plus_voucher_requests_receiver_name_check;

CREATE OR REPLACE FUNCTION public.enforce_oyuns_plus_receiver_details()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    mode TEXT;
BEGIN
    SELECT issuance_mode INTO mode
    FROM public.oyuns_plus_cards
    WHERE id = NEW.card_id;

    IF mode IS DISTINCT FROM 'automatic'
       AND (NEW.receiver_name IS NULL OR char_length(trim(NEW.receiver_name)) NOT BETWEEN 1 AND 160
            OR NEW.receiver_phone IS NULL OR char_length(NEW.receiver_phone) NOT BETWEEN 8 AND 20) THEN
        RAISE EXCEPTION 'RECEIVER_DETAILS_REQUIRED' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS oyuns_plus_receiver_details_required ON public.oyuns_plus_voucher_requests;
CREATE TRIGGER oyuns_plus_receiver_details_required
    BEFORE INSERT OR UPDATE OF card_id, receiver_name, receiver_phone
    ON public.oyuns_plus_voucher_requests
    FOR EACH ROW EXECUTE FUNCTION public.enforce_oyuns_plus_receiver_details();
