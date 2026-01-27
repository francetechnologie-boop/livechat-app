-- Add product_id to persisted extraction runs, to store the Presta id_product after send
ALTER TABLE public.mod_grabbing_jerome_extraction_runs
  ADD COLUMN IF NOT EXISTS product_id INTEGER NULL;

CREATE INDEX IF NOT EXISTS mod_gj_runs_product_idx
  ON public.mod_grabbing_jerome_extraction_runs (product_id);

