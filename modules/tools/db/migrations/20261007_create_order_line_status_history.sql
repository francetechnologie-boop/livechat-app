-- Rename and track every change that touches a purchase order line (mod_tools_order_line_status_history).

CREATE TABLE IF NOT EXISTS mod_tools_order_line_status_history (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL,
  purchase_order_line_id INTEGER NOT NULL,
  org_id INTEGER NULL,
  status TEXT NULL,
  qty_delivered NUMERIC NULL,
  rest NUMERIC NULL,
  qty_partial NUMERIC NULL,
  replan_date DATE NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_tools_order_line_status_history_po ON mod_tools_order_line_status_history(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_mod_tools_order_line_status_history_line ON mod_tools_order_line_status_history(purchase_order_line_id);

DO $$ BEGIN
  IF to_regclass('public.mod_tools_purchase_order_lines') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.mod_tools_order_line_status_history
        ADD CONSTRAINT fk_mod_tools_order_line_status_history_line
        FOREIGN KEY (purchase_order_line_id) REFERENCES public.mod_tools_purchase_order_lines(id) ON DELETE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
    BEGIN
      ALTER TABLE public.mod_tools_order_line_status_history
        ADD CONSTRAINT fk_mod_tools_order_line_status_history_order
        FOREIGN KEY (purchase_order_id) REFERENCES public.mod_tools_purchase_orders(id) ON DELETE CASCADE;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;
