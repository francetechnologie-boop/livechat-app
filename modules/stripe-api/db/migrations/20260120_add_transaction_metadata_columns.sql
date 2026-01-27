-- 20260120_add_transaction_metadata_columns.sql

ALTER TABLE public.mod_stripe_api_transactions
  ADD COLUMN IF NOT EXISTS reference TEXT NULL,
  ADD COLUMN IF NOT EXISTS order_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS cart_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_reference ON public.mod_stripe_api_transactions(reference);
CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_order ON public.mod_stripe_api_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_cart ON public.mod_stripe_api_transactions(cart_id);
