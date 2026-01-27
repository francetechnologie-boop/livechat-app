-- Create tables for the nohash module
-- Stores the set of allowed hashes discovered at runtime

CREATE TABLE IF NOT EXISTS mod_nohash_routes (
  id           BIGSERIAL PRIMARY KEY,
  kind         TEXT NOT NULL,        -- 'module' | 'page'
  item_id      TEXT NOT NULL,        -- module id or page id
  hash         TEXT NOT NULL,        -- e.g., '#/modules/<id>' or '#/<page>' (stored without leading '#')
  title        TEXT,                 -- optional human label
  source       TEXT,                 -- 'manifest' | 'pages' | 'scan'
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mod_nohash_routes_hash_uq ON mod_nohash_routes (lower(trim(both from hash)));

