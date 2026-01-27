-- 20260120_1310_add_paypal_tx_unique_index.sql

CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_paypal_api_tx_org_account_txid
  ON public.mod_paypal_api_transactions(org_id, account_id, paypal_transaction_id);

