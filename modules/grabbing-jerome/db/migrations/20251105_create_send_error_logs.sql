-- Error logs for send-to-Presta operations (per table/op)
CREATE TABLE IF NOT EXISTS public.mod_grabbing_jerome_send_to_presta_error_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NULL,
  domain TEXT NULL,
  page_type TEXT NULL,
  table_name TEXT NULL,
  op TEXT NULL,
  product_id BIGINT NULL,
  id_shop INTEGER NULL,
  id_lang INTEGER NULL,
  error TEXT NULL,
  payload JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mod_gj_send_err_run_idx ON public.mod_grabbing_jerome_send_to_presta_error_logs (run_id);
CREATE INDEX IF NOT EXISTS mod_gj_send_err_table_idx ON public.mod_grabbing_jerome_send_to_presta_error_logs (table_name);

