-- Additional metadata tables for nohash module

CREATE TABLE IF NOT EXISTS mod_nohash_modules (
  id            BIGSERIAL PRIMARY KEY,
  module_id     TEXT NOT NULL UNIQUE,
  name          TEXT,
  description   TEXT,
  category      TEXT,
  version       TEXT,
  default_installed BOOLEAN DEFAULT FALSE,
  default_active    BOOLEAN DEFAULT FALSE,
  has_frontend   BOOLEAN DEFAULT FALSE,
  has_backend    BOOLEAN DEFAULT FALSE,
  hash          TEXT NOT NULL,
  source        TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mod_nohash_modules_hash_uq ON mod_nohash_modules (lower(trim(both from hash)));

CREATE TABLE IF NOT EXISTS mod_nohash_pages (
  id            BIGSERIAL PRIMARY KEY,
  page_id       TEXT NOT NULL UNIQUE,
  name          TEXT,
  description   TEXT,
  category      TEXT,
  hash          TEXT NOT NULL,
  source        TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mod_nohash_pages_hash_uq ON mod_nohash_pages (lower(trim(both from hash)));

