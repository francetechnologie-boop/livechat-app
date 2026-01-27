-- 20251030_backfill_kanban_from_settings.sql
-- Idempotent backfill of dev-manager Kanban data from legacy settings keys
--   - DEV_KANBAN_BOARD (preferred)
--   - DEV_PROJECTS_JSON (fallback board under items[current].board)
--   - DEV_KANBAN_FILES (file metadata)

DO $$
DECLARE
  org_txt TEXT;
  board_j JSONB;
  projects_j JSONB;
  files_j JSONB;
  v_project_id TEXT;
  proj_from_projects TEXT;
  v_board_id INT;
  col RECORD;
  card RECORD;
  att RECORD;
  col_id INT;
BEGIN
  -- Prefer org_id from the DEV_KANBAN_BOARD settings row; fallback to first organization
  BEGIN
    SELECT COALESCE(s.org_id::text, (SELECT id::text FROM organizations ORDER BY id LIMIT 1))
      INTO org_txt
    FROM settings s
    WHERE s.key = 'DEV_KANBAN_BOARD'
    ORDER BY s.updated_at DESC
    LIMIT 1;
  EXCEPTION WHEN others THEN
    org_txt := NULL;
  END;
  IF org_txt IS NULL THEN
    SELECT id::text INTO org_txt FROM organizations ORDER BY id LIMIT 1;
  END IF;

  -- Load board JSON from DEV_KANBAN_BOARD
  BEGIN
    SELECT s.value::jsonb INTO board_j
    FROM settings s
    WHERE s.key = 'DEV_KANBAN_BOARD'
    ORDER BY s.updated_at DESC
    LIMIT 1;
  EXCEPTION WHEN others THEN
    board_j := NULL;
  END;

  -- If absent, derive from DEV_PROJECTS_JSON
  IF board_j IS NULL OR (jsonb_typeof(board_j) IS DISTINCT FROM 'object') OR NOT (board_j ? 'columns') THEN
    BEGIN
      SELECT s.value::jsonb INTO projects_j
      FROM settings s
      WHERE s.key = 'DEV_PROJECTS_JSON'
      ORDER BY s.updated_at DESC
      LIMIT 1;
    EXCEPTION WHEN others THEN
      projects_j := NULL;
    END;
    IF projects_j IS NOT NULL THEN
      proj_from_projects := COALESCE(NULLIF(trim(projects_j->>'current'), ''), 'default');
      board_j := projects_j->'items'->proj_from_projects->'board';
    END IF;
  END IF;

  IF board_j IS NULL THEN
    RAISE NOTICE '[dev-manager] No board JSON found in settings; skipping backfill';
    RETURN;
  END IF;

  v_project_id := COALESCE(NULLIF(trim(board_j->>'project'), ''), proj_from_projects, 'default');

  -- Upsert board
  INSERT INTO mod_dev_manager_kanban_boards(org_id, project_id, name, created_at, updated_at)
  VALUES (org_txt, v_project_id, 'Kanban Board', NOW(), NOW())
  ON CONFLICT ON CONSTRAINT uq_mod_dev_manager_kanban_board
  DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
  RETURNING id INTO v_board_id;

  -- Upsert columns
  FOR col IN
    SELECT (c->>'id') AS col_key,
           COALESCE(NULLIF(c->>'title',''), (c->>'id')) AS title,
           COALESCE((c->>'order')::int, 0) AS order_index
    FROM jsonb_array_elements(COALESCE(board_j->'columns','[]'::jsonb)) AS c
  LOOP
    IF col.col_key IS NULL OR length(col.col_key) = 0 THEN CONTINUE; END IF;
    INSERT INTO mod_dev_manager_kanban_columns(org_id, board_id, col_key, title, order_index, created_at, updated_at)
    VALUES (org_txt, v_board_id, col.col_key, col.title, col.order_index, NOW(), NOW())
    ON CONFLICT (board_id, col_key)
    DO UPDATE SET title = EXCLUDED.title, order_index = EXCLUDED.order_index, updated_at = NOW();
  END LOOP;

  -- Upsert cards and attachments
  FOR card IN
    SELECT
      COALESCE(NULLIF(c->>'id',''), 'c_'||floor(extract(epoch from clock_timestamp())*1000)::bigint||'_'||substr(md5(random()::text),1,6)) AS original_id,
      NULLIF(c->>'columnId','') AS col_key,
      COALESCE(c->>'title','') AS title,
      COALESCE(c->>'description','') AS description,
      COALESCE(c->'attachments','[]'::jsonb) AS atts
    FROM jsonb_array_elements(COALESCE(board_j->'cards','[]'::jsonb)) AS c
  LOOP
    SELECT id INTO col_id FROM mod_dev_manager_kanban_columns WHERE mod_dev_manager_kanban_columns.board_id = v_board_id AND col_key = card.col_key LIMIT 1;
    INSERT INTO mod_dev_manager_kanban_cards(org_id, board_id, column_id, original_id, title, description, created_at, updated_at)
    VALUES (org_txt, v_board_id, col_id, card.original_id, card.title, card.description, NOW(), NOW())
    ON CONFLICT (board_id, original_id)
    DO UPDATE SET column_id = EXCLUDED.column_id, title = EXCLUDED.title, description = EXCLUDED.description, updated_at = NOW();

    -- Attachments: always rewrite URL to new base under /api/dev-manager
    FOR att IN
      SELECT
        NULLIF(a->>'id','') AS att_id,
        COALESCE(a->>'type','file') AS type,
        COALESCE(NULLIF(a->>'name',''), NULLIF(a->>'url',''), NULLIF(a->>'id','')) AS name,
        NULLIF(a->>'contentType','') AS content_type,
        NULLIF(a->>'sizeBytes','') AS size_text
      FROM jsonb_array_elements(card.atts) AS a
    LOOP
      IF att.att_id IS NULL THEN CONTINUE; END IF;
      INSERT INTO mod_dev_manager_kanban_attachments(org_id, card_id, att_id, type, name, url, content_type, size_bytes, created_at)
      SELECT org_txt, mc.id, att.att_id, att.type, att.name,
             '/api/dev-manager/kanban/file/'||att.att_id,
             att.content_type,
             NULLIF(att.size_text,'')::bigint,
             NOW()
      FROM mod_dev_manager_kanban_cards mc
      WHERE mc.board_id = v_board_id AND mc.original_id = card.original_id
      ON CONFLICT (card_id, att_id)
      DO UPDATE SET type = EXCLUDED.type, name = EXCLUDED.name, url = EXCLUDED.url, content_type = EXCLUDED.content_type, size_bytes = EXCLUDED.size_bytes;
    END LOOP;
  END LOOP;

  -- Files metadata
  BEGIN
    SELECT s.value::jsonb INTO files_j
    FROM settings s
    WHERE s.key = 'DEV_KANBAN_FILES'
    ORDER BY s.updated_at DESC
    LIMIT 1;
  EXCEPTION WHEN others THEN
    files_j := NULL;
  END;

  IF files_j IS NOT NULL AND jsonb_typeof(files_j) = 'object' THEN
    FOR col IN
      SELECT key AS fid, files_j->key AS fobj
      FROM jsonb_object_keys(files_j) AS key
    LOOP
      BEGIN
        INSERT INTO mod_dev_manager_files (id, org_id, file_name, file_path, content_type, size_bytes, created_at)
        VALUES (
          col.fid,
          org_txt,
          COALESCE(NULLIF(col.fobj->>'file_name',''), col.fid),
          NULLIF(col.fobj->>'file_path',''),
          NULLIF(col.fobj->>'content_type',''),
          NULLIF(col.fobj->>'size_bytes','')::bigint,
          (NULLIF(col.fobj->>'created_at',''))::timestamptz
        )
        ON CONFLICT (id) DO UPDATE
          SET file_name = EXCLUDED.file_name,
              file_path = EXCLUDED.file_path,
              content_type = EXCLUDED.content_type,
              size_bytes = EXCLUDED.size_bytes,
              created_at = COALESCE(mod_dev_manager_files.created_at, EXCLUDED.created_at);
      EXCEPTION WHEN others THEN
        -- Fallback without created_at cast
        INSERT INTO mod_dev_manager_files (id, org_id, file_name, file_path, content_type, size_bytes, created_at)
        VALUES (
          col.fid,
          org_txt,
          COALESCE(NULLIF(col.fobj->>'file_name',''), col.fid),
          NULLIF(col.fobj->>'file_path',''),
          NULLIF(col.fobj->>'content_type',''),
          NULLIF(col.fobj->>'size_bytes','')::bigint,
          NOW()
        )
        ON CONFLICT (id) DO NOTHING;
      END;
    END LOOP;
  END IF;

  RAISE NOTICE '[dev-manager] Backfill from settings completed: org %, project %', org_txt, v_project_id;
END $$;
