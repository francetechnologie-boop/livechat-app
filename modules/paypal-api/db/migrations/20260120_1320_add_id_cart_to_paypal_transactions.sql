-- 20260120_1320_add_id_cart_to_paypal_transactions.sql

ALTER TABLE public.mod_paypal_api_transactions
  ADD COLUMN IF NOT EXISTS id_cart BIGINT NULL;

CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_tx_id_cart
  ON public.mod_paypal_api_transactions(id_cart);

