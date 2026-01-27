-- Recreate Dev Manager tables idempotently (no down section)
-- This migration is safe to run after previous runs that may have dropped tables due to a down block.

-- Ensure organizations exists (TEXT id is supported)
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Examples
CREATE TABLE IF NOT EXISTS mod_dev_manager_examples (
  id SERIAL PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Kanban tables
CREATE TABLE IF NOT EXISTS mod_dev_manager_kanban_boards (
  id SERIAL PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  project_id TEXT,
  name TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_mod_dev_manager_kanban_board UNIQUE (org_id, project_id)
);

CREATE TABLE IF NOT EXISTS mod_dev_manager_kanban_columns (
  id SERIAL PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  board_id INT REFERENCES mod_dev_manager_kanban_boards(id) ON DELETE CASCADE,
  col_key TEXT NOT NULL,
  title TEXT NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_mod_dev_manager_kanban_column UNIQUE (board_id, col_key)
);

CREATE TABLE IF NOT EXISTS mod_dev_manager_kanban_cards (
  id SERIAL PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  board_id INT REFERENCES mod_dev_manager_kanban_boards(id) ON DELETE CASCADE,
  column_id INT REFERENCES mod_dev_manager_kanban_columns(id) ON DELETE SET NULL,
  original_id TEXT,
  title TEXT,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_mod_dev_manager_kanban_card UNIQUE (board_id, original_id)
);

CREATE TABLE IF NOT EXISTS mod_dev_manager_kanban_attachments (
  id SERIAL PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  card_id INT REFERENCES mod_dev_manager_kanban_cards(id) ON DELETE CASCADE,
  att_id TEXT NOT NULL,
  type TEXT,
  name TEXT,
  url TEXT,
  content_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_mod_dev_manager_kanban_attachment UNIQUE (card_id, att_id)
);

CREATE TABLE IF NOT EXISTS mod_dev_manager_files (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  file_name TEXT,
  file_path TEXT,
  content_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMP NULL
);

-- Indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_mod_dev_manager_kanban_cols_board ON mod_dev_manager_kanban_columns(board_id);
CREATE INDEX IF NOT EXISTS idx_mod_dev_manager_kanban_cards_board ON mod_dev_manager_kanban_cards(board_id);
CREATE INDEX IF NOT EXISTS idx_mod_dev_manager_kanban_cards_col ON mod_dev_manager_kanban_cards(column_id);
CREATE INDEX IF NOT EXISTS idx_mod_dev_manager_kanban_atts_card ON mod_dev_manager_kanban_attachments(card_id);

