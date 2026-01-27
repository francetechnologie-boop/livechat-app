export async function ensureTables({ pool, logToFile }) {
  try {
    // messages table — accept both columns `content` and `message`
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // add optional columns if missing
    await pool.query(
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS content TEXT`
    );
    await pool.query(
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS message TEXT`
    );
    await pool.query(
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS content_html TEXT`
    );
    await pool.query(
      `ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent_id TEXT`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_messages_visitor ON messages(visitor_id)`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)`
    );

    // SMS-specific optional columns to enrich messages with line metadata
    try { await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS via TEXT`); } catch {}
    try { await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS to_number TEXT`); } catch {}
    try { await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS sim_slot INTEGER`); } catch {}
    try { await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS subscription_id INTEGER`); } catch {}
    try { await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS carrier TEXT`); } catch {}
    try { await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS display_name TEXT`); } catch {}
    try { await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS external_message_id TEXT`); } catch {}
    try { await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS from_number TEXT`); } catch {}

    // visitors table - ensure table exists (minimal; no JSON meta)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS visitors (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Bring visitors table closer to desired schema by adding missing columns
    const addCol = async (sql) => {
      try {
        await pool.query(sql);
      } catch (e) {
        /* ignore */
      }
    };
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS visitor_id TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS first_seen TIMESTAMP DEFAULT NOW()`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT NOW()`
    );
    await addCol(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS ip INET`);
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS country_code TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS user_agent TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS "language" TEXT`
    );
    await addCol(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS origin TEXT`);
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS page_url_last TEXT`
    );
    await addCol(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS referrer TEXT`);
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS title TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS time_zone TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS screen_w INTEGER`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS screen_h INTEGER`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS screen_dpr NUMERIC`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS id_shop INTEGER`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS shop_name TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS id_lang INTEGER`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS lang_iso VARCHAR(16)`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS lang_name TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS currency VARCHAR(8)`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS cart_total NUMERIC`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS assistant_id TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS openai_enabled BOOLEAN`
    );
    // Customer/account context
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS customer_logged BOOLEAN`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS customer_id INTEGER`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS customer_email TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS customer_firstname TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS customer_lastname TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS orders_count INTEGER`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS orders_amount NUMERIC`
    );
    await addCol(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS city TEXT`);
    await addCol(`ALTER TABLE visitors ADD COLUMN IF NOT EXISTS postcode TEXT`);
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS last_action TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS last_action_at TIMESTAMP`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS conversation_status TEXT`
    );
    await addCol(
      `ALTER TABLE visitors ADD COLUMN IF NOT EXISTS chatbot_id TEXT`
    );

    // Agents settings (augment existing agents table if present)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS agents (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          role TEXT DEFAULT 'agent',
          last_login TIMESTAMP
        );
      `);
      // Add optional columns for preferences/settings
      await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS preferred_lang TEXT`);
      await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS notifications JSONB`);
      await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS ip_allowlist TEXT[]`);
      await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS theme_color TEXT`);
      await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS theme_color2 TEXT`);
      await pool.query(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS ui_state JSONB`);
    } catch (e) {
      logToFile(`ℹ️ ensure agents table/cols: ${e.code || ''} ${e.message}`);
    }

    // Backfill visitor_id from id when missing to keep both columns usable
    try {
      await pool.query(
        `UPDATE visitors SET visitor_id = COALESCE(visitor_id, id) WHERE visitor_id IS NULL AND id IS NOT NULL`
      );
    } catch {}
    // Backfill id from visitor_id when missing (satisfy NOT NULL id)
    try {
      await pool.query(
        `UPDATE visitors SET id = visitor_id WHERE id IS NULL AND visitor_id IS NOT NULL`
      );
    } catch {}

    // Ensure uniqueness even if a legacy table existed without PK/unique
    try {
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS visitors_id_unique ON visitors (id)`
      );
    } catch (e) {
      logToFile(
        `ℹ️ visitors_id_unique index attempt: ${e.code || ""} ${e.message}`
      );
    }

    // Also support the legacy column name if present
    try {
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS visitors_visitor_id_unique ON visitors (visitor_id)`
      );
    } catch {}

    // Keep id and visitor_id in sync at insert time (satisfy NOT NULL on id)
    // Make creation fully idempotent and lock-serialised to avoid concurrency errors
    try {
      // Block until we hold the advisory lock to serialize trigger creation
      await pool.query('SELECT pg_advisory_lock(884211)');
      try {
        // Ensure function exists (always up-to-date)
        await pool.query(`
          CREATE OR REPLACE FUNCTION visitors_sync_ids_before_insert() RETURNS trigger AS $$
          BEGIN
            IF NEW.id IS NULL AND NEW.visitor_id IS NOT NULL THEN
              NEW.id := NEW.visitor_id;
            END IF;
            IF NEW.visitor_id IS NULL AND NEW.id IS NOT NULL THEN
              NEW.visitor_id := NEW.id;
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;
        `);
        // Create trigger only if missing (no DROP to reduce churn/race)
        await pool.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1
                FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
               WHERE t.tgname = 'visitors_sync_ids'
                 AND c.relname = 'visitors'
            ) THEN
              CREATE TRIGGER visitors_sync_ids
              BEFORE INSERT ON visitors
              FOR EACH ROW
              EXECUTE FUNCTION visitors_sync_ids_before_insert();
            END IF;
          END
          $$;
        `);
      } finally {
        try { await pool.query('SELECT pg_advisory_unlock(884211)'); } catch {}
      }
    } catch (e) {
      logToFile(`?? visitors_sync_ids trigger setup: ${e.code || ''} ${e.message}`);
    }

    // Helpful secondary indexes (match desired schema)
    try {
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_visitors_country ON visitors(country_code)`
      );
    } catch {}
    try {
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_visitors_lang ON visitors(id_lang)`
      );
    } catch {}
    try {
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors(last_seen DESC)`
      );
    } catch {}
    try {
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_visitors_shop ON visitors(id_shop)`
      );
    } catch {}

    try {
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_visitors_last_action_at ON visitors(last_action_at DESC)`
      );
    } catch {}

    // Dedup support for text/uuid message ids
    try {
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS messages_id_unique ON messages (id)`
      );
    } catch {}

    // visits table for page history (optional; used by right panel)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS visits (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT NOT NULL,
        page_url TEXT,
        title TEXT,
        origin TEXT,
        referrer TEXT,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        utm_term TEXT,
        utm_content TEXT,
        occurred_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_visits_vid_time ON visits(visitor_id, occurred_at DESC)`
    );

    // automations: automatic messages configuration
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auto_messages (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        url_match TEXT,
        locale TEXT,
        trigger_type TEXT,
        enabled BOOLEAN DEFAULT FALSE,
        triggered_count INTEGER DEFAULT 0,
        conversations_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_auto_messages_enabled ON auto_messages(enabled)`
    );

    // welcome messages per shop_name + lang_iso
    await pool.query(`
      CREATE TABLE IF NOT EXISTS welcome_message (
        id_message TEXT PRIMARY KEY,
        shop_name TEXT NOT NULL,
        lang_iso VARCHAR(16) NOT NULL,
        title TEXT,
        content TEXT,
        enabled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS welcome_message_shop_lang_unique ON welcome_message (shop_name, lang_iso)`
    );

    // Chatbot (OpenAI Assistant) config per shop/lang
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chatbot_config (
        id_bot TEXT PRIMARY KEY,
        shop_name TEXT NOT NULL,
        lang_iso VARCHAR(16) NOT NULL,
        assistant_id TEXT,
        enabled BOOLEAN DEFAULT FALSE,
        file_ids TEXT[],
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS chatbot_config_shop_lang_unique ON chatbot_config (shop_name, lang_iso)`
    );
    // Add optional config columns if missing (minimal set only)
    const addColCfg = async (sql) => { try { await pool.query(sql); } catch {} };
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS openai_api_key TEXT`);
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS name TEXT`);
    // Responses API prompt support
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS prompt_id TEXT`);
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS prompt_version TEXT`);

    // Chatbot behaviour: 'manual' | 'auto_draft' | 'auto_reply'
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS bot_behavior TEXT`);

    // Ensure minimal and commonly used columns exist
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS instructions TEXT`);
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS local_prompt_id TEXT`);
    // Welcome message link (predefined welcome_message row id)
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS welcome_message TEXT`);
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS welcome_message_id TEXT`);

    // Drop unused legacy/advanced columns to keep the table minimal
    const dropCol = async (c) => { try { await pool.query(`ALTER TABLE chatbot_config DROP COLUMN IF EXISTS ${c}`); } catch {} };
    await dropCol('assistant_id');
    await dropCol('file_ids');
    // keep 'instructions'
    await dropCol('model');
    await dropCol('temperature');
    await dropCol('top_p');
    await dropCol('response_format');
    await dropCol('tools_code_interpreter');
    await dropCol('tools_file_search');
    await dropCol('openai_org');
    await dropCol('openai_project');
    await dropCol('openai_base_url');
    await dropCol('vector_store_id');
    await dropCol('web_search_enabled');
    await dropCol('web_search_domains');
    await dropCol('web_search_context_size');
    await dropCol('text_verbosity');
    await dropCol('reasoning_effort');
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS web_search_enabled BOOLEAN`);
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS web_search_domains TEXT[]`);
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS web_search_context_size TEXT`);
  await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS text_verbosity TEXT`);
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS reasoning_effort TEXT`);
    // MCP integration per-bot (optional)
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS mcp_enabled BOOLEAN`);
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS mcp_tools TEXT[]`);
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS mcp_token TEXT`);

    // Prompt repository (prompt_config) and association
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prompt_config (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        dev_message TEXT,
        messages JSONB,
        tools JSONB,
        openai_api_key TEXT,
        prompt_id TEXT,
        prompt_version TEXT,
        vector_store_id TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS prompt_config_name_unique ON prompt_config (name)`);
    try { await pool.query(`ALTER TABLE prompt_config ADD COLUMN IF NOT EXISTS vector_store_id TEXT`); } catch {}
    await addColCfg(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS prompt_config_id TEXT`);
    // Best-effort migration from local_prompt if present
    try {
      await pool.query(`
        INSERT INTO prompt_config (id, name, dev_message, messages, tools, openai_api_key, prompt_id, prompt_version, created_at, updated_at)
        SELECT id, name, dev_message, messages, tools, openai_api_key, prompt_id, prompt_version, created_at, updated_at
        FROM local_prompt
        ON CONFLICT (id) DO NOTHING`);
    } catch {}
    try {
      await pool.query(`
        UPDATE chatbot_config SET prompt_config_id = local_prompt_id
        WHERE prompt_config_id IS NULL AND local_prompt_id IS NOT NULL`);
    } catch {}

    // Local prompt repository (always local)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS local_prompt (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        dev_message TEXT,
        messages JSONB,
        tools JSONB,
        openai_api_key TEXT,
        prompt_id TEXT,
        prompt_version TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS local_prompt_name_unique ON local_prompt (name)`);

    // MCP servers configuration repository
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mcp_server_config (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT,
        http_base TEXT,
        ws_url TEXT,
        stream_url TEXT,
        sse_url TEXT,
        token TEXT,
        enabled BOOLEAN DEFAULT FALSE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mcp_server_config_name_unique ON mcp_server_config (name)`);
    try { await pool.query(`ALTER TABLE mcp_server_config ADD COLUMN IF NOT EXISTS stream_url TEXT`); } catch {}
    try { await pool.query(`ALTER TABLE mcp_server_config ADD COLUMN IF NOT EXISTS sse_url TEXT`); } catch {}
    // New: classification and typed options for single-server strategy
    try { await pool.query(`ALTER TABLE mcp_server_config ADD COLUMN IF NOT EXISTS server_type TEXT`); } catch {}
    try { await pool.query(`ALTER TABLE mcp_server_config ADD COLUMN IF NOT EXISTS options JSONB`); } catch {}
    // Grouping of MCP servers
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mcp_group (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mcp_group_name_unique ON mcp_group (name)`);
    try { await pool.query(`ALTER TABLE mcp_server_config ADD COLUMN IF NOT EXISTS group_id TEXT`); } catch {}
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mcp_server_group ON mcp_server_config (group_id)`);
    // Association table: prompt_config <-> mcp_server_config (many-to-many)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prompt_config_mcp (
        prompt_config_id TEXT NOT NULL,
        mcp_server_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (prompt_config_id, mcp_server_id)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prompt_mcp_prompt ON prompt_config_mcp (prompt_config_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prompt_mcp_server ON prompt_config_mcp (mcp_server_id)`);
    // MCP tool designer: persistent tool definitions per server
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mcp_tool_def (
        id TEXT PRIMARY KEY,
        server_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        grp TEXT,
        kind TEXT,
        input_schema JSONB,
        code JSONB,
        enabled BOOLEAN DEFAULT TRUE,
        version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mcp_tool_def_unique ON mcp_tool_def (server_id, name)`);

    // ================= MCP2 (Next-gen MCP) =================
    // Note: Using lowercase table names (mcp2_*) to stay consistent with the codebase's conventions.
    //       These implement the user's request for tables starting with MCP2_*** (case-insensitive on Postgres).
    //       Entities: kinds, types, servers, and server tools.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mcp2_kind (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mcp2_kind_code_unique ON mcp2_kind (lower(code))`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS mcp2_type (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mcp2_type_code_unique ON mcp2_type (lower(code))`);
    // New: optional tool name prefix per type
    try { await pool.query(`ALTER TABLE mcp2_type ADD COLUMN IF NOT EXISTS tool_prefix TEXT`); } catch {}

    await pool.query(`
      CREATE TABLE IF NOT EXISTS mcp2_server (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind_id TEXT,
        type_id TEXT,
        http_base TEXT,
        ws_url TEXT,
        stream_url TEXT,
        sse_url TEXT,
        token TEXT,
        enabled BOOLEAN DEFAULT FALSE,
        options JSONB,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (name)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mcp2_server_kind ON mcp2_server (kind_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mcp2_server_type ON mcp2_server (type_id)`);
    // Ensure columns exist for existing installs
    try { await pool.query(`ALTER TABLE mcp2_server ADD COLUMN IF NOT EXISTS stream_url TEXT`); } catch {}
    try { await pool.query(`ALTER TABLE mcp2_server ADD COLUMN IF NOT EXISTS sse_url TEXT`); } catch {}

    // Association table: prompt_config <-> mcp2_server (many-to-many)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prompt_config_mcp2 (
        prompt_config_id TEXT NOT NULL,
        mcp2_server_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (prompt_config_id, mcp2_server_id)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prompt_mcp2_prompt ON prompt_config_mcp2 (prompt_config_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prompt_mcp2_server ON prompt_config_mcp2 (mcp2_server_id)`);

    // Catalog of reusable tools (type-agnostic definitions)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mcp2_tool (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        input_schema JSONB,
        code JSONB,
        version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Mapping: type -> tool (default toolset per type)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mcp2_type_tool (
        type_id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        default_enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (type_id, tool_id)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mcp2_type_tool_type ON mcp2_type_tool (type_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mcp2_type_tool_tool ON mcp2_type_tool (tool_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS mcp2_server_tool (
        id TEXT PRIMARY KEY,
        server_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        input_schema JSONB,
        code JSONB,
        enabled BOOLEAN DEFAULT TRUE,
        version INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (server_id, name)
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mcp2_tool_server ON mcp2_server_tool (server_id)`);
    // Allow referencing catalog tool
    try { await pool.query(`ALTER TABLE mcp2_server_tool ADD COLUMN IF NOT EXISTS tool_id TEXT`); } catch {}
  try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_mcp2_server_tool_tool ON mcp2_server_tool (tool_id)`); } catch {}

    // Backfill: promote server-level tool definitions into catalog + type mappings
    try {
      // 1) Create catalog tools for distinct server-level tool names with definitions when not yet linked
      const rs = await pool.query(`
        SELECT DISTINCT name, description, input_schema, code, COALESCE(version,1) AS version
          FROM mcp2_server_tool
         WHERE tool_id IS NULL AND COALESCE(name,'') <> ''
      `);
      for (const row of (rs.rows || [])) {
        const name = String(row.name||'').trim(); if (!name) continue;
        const desc = row.description || null;
        let inputSchema = row.input_schema || null;
        let code = row.code || null;
        const version = Number(row.version)||1;
        try {
          const id = `m2tool_${Math.random().toString(16).slice(2,10)}${Date.now().toString(16).slice(-6)}`;
          await pool.query(`
            INSERT INTO mcp2_tool (id, name, description, input_schema, code, version, created_at, updated_at)
            VALUES ($1,$2,$3,$4::json,$5::json,$6,NOW(),NOW())
            ON CONFLICT (name) DO NOTHING
          `, [id, name, desc, inputSchema?JSON.stringify(inputSchema):null, code?JSON.stringify(code):null, version]);
        } catch {}
      }
      // 2) Link server tools to catalog (by name), and drop server-scoped definitions
      const rl = await pool.query(`SELECT id, name FROM mcp2_tool`);
      const map = new Map((rl.rows||[]).map(r => [String(r.name||''), String(r.id||'')]));
      const st = await pool.query(`SELECT id, name FROM mcp2_server_tool WHERE tool_id IS NULL AND COALESCE(name,'') <> ''`);
      for (const row of (st.rows||[])) {
        const sid = String(row.id||'');
        const name = String(row.name||'');
        const tid = map.get(name) || null;
        if (!tid) continue;
        try {
          await pool.query(`UPDATE mcp2_server_tool SET tool_id=$1, description=NULL, input_schema=NULL, code=NULL, updated_at=NOW() WHERE id=$2`, [tid, sid]);
        } catch {}
      }
      // 3) Create type->tool defaults from existing server links (one-time only).
      // If any mappings already exist, skip to avoid resurrecting user-deleted rows.
      try {
        const hasAny = await pool.query(`SELECT 1 FROM mcp2_type_tool LIMIT 1`);
        if (!hasAny.rowCount) {
          const xt = await pool.query(`
            SELECT DISTINCT s.type_id, st.tool_id
              FROM mcp2_server_tool st
              JOIN mcp2_server s ON s.id = st.server_id
             WHERE st.tool_id IS NOT NULL AND s.type_id IS NOT NULL
          `);
          for (const row of (xt.rows||[])) {
            try { await pool.query(`INSERT INTO mcp2_type_tool (type_id, tool_id, default_enabled, created_at) VALUES ($1,$2,TRUE,NOW()) ON CONFLICT (type_id, tool_id) DO NOTHING`, [row.type_id, row.tool_id]); } catch {}
          }
        }
      } catch {}
    } catch {}
  // Files uploaded via MCP tools or HTTP
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mcp_files (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content_type TEXT,
      size_bytes INTEGER,
      server_name TEXT,
      bot_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  try { await pool.query(`ALTER TABLE mcp_files ADD COLUMN IF NOT EXISTS server_name TEXT`); } catch {}
  try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_mcp_files_server ON mcp_files(server_name)`); } catch {}
  // Remote placeholders support (e.g., OpenAI vector files not downloadable)
  try { await pool.query(`ALTER TABLE mcp_files ADD COLUMN IF NOT EXISTS is_remote BOOLEAN DEFAULT FALSE`); } catch {}
  try { await pool.query(`ALTER TABLE mcp_files ADD COLUMN IF NOT EXISTS remote_provider TEXT`); } catch {}
  try { await pool.query(`ALTER TABLE mcp_files ADD COLUMN IF NOT EXISTS remote_file_id TEXT`); } catch {}
  // Key/Value settings table for server-wide options (e.g., MCP token)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // SMS/Call gateway auxiliary tables
    // Call logs table for inbound/outbound call events from the Android gateway
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS call_logs (
          id BIGSERIAL PRIMARY KEY,
          from_number TEXT NOT NULL,
          to_number TEXT,
          direction TEXT,
          status TEXT,
          duration_sec INTEGER,
          started_at TIMESTAMP,
          ended_at TIMESTAMP,
          raw JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_call_logs_created ON call_logs(created_at DESC)`);
    } catch (e) {
      try { logToFile(`⚠️ ensure call_logs table: ${e.code || ''} ${e.message}`); } catch {}
    }

    // Optional SMS delivery status table (for acknowledgements from the gateway)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sms_status (
          id BIGSERIAL PRIMARY KEY,
          message_id TEXT,
          status TEXT,
          error TEXT,
          raw JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_sms_status_msg ON sms_status(message_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_sms_status_created ON sms_status(created_at DESC)`);
    } catch (e) {
      try { logToFile(`⚠️ ensure sms_status table: ${e.code || ''} ${e.message}`); } catch {}
    }
  // Vector file cache removed; new deployments no longer create table `vector_file_cache`.
  // Gateway lines (SIM/eSIM subscriptions) reported by Android gateway
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gateway_lines (
        id BIGSERIAL PRIMARY KEY,
        device_id TEXT,
        subscription_id INTEGER,
        sim_slot INTEGER,
        carrier TEXT,
        display_name TEXT,
        msisdn TEXT,
        last_seen TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gateway_lines_last_seen ON gateway_lines(last_seen DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gateway_lines_msisdn ON gateway_lines(msisdn)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_gateway_lines_sub ON gateway_lines(subscription_id)`);
  } catch (e) { try { logToFile(`⚠️ ensure gateway_lines table: ${e.code||''} ${e.message}`); } catch {} }

  // Explicit conversations table (allows creating a thread before any message)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sms_conversation (
        phone TEXT PRIMARY KEY,
        label TEXT,
        default_subscription_id INTEGER,
        pinned BOOLEAN DEFAULT FALSE,
        archived BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
  } catch (e) { try { logToFile(`⚠️ ensure sms_conversation table: ${e.code||''} ${e.message}`); } catch {} }
  // Organizations (per-tenant) with OpenAI key
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      openai_api_key TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS org_name_unique ON organizations (name)`);
    // Test history for prompt configurations
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prompt_test_history (
        id TEXT PRIMARY KEY,
        prompt_config_id TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT,
        request JSONB,
        response JSONB,
        ms INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prompt_test_history_prompt ON prompt_test_history (prompt_config_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prompt_test_history_created ON prompt_test_history (created_at DESC)`);
    try { await pool.query(`ALTER TABLE prompt_test_history ADD COLUMN IF NOT EXISTS response JSONB`); } catch {}
  // RBAC core: users, memberships, roles, permissions, role_permissions, assignments
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(lower(email))`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      joined_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (user_id, org_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      is_system BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (org_id, name)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_roles_org ON roles(org_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS permissions (
      name TEXT PRIMARY KEY,
      description TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT NOT NULL,
      permission_name TEXT NOT NULL,
      PRIMARY KEY (role_id, permission_name)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      membership_id TEXT,
      role_id TEXT,
      org_id TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (membership_id, role_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_assignments_membership ON assignments(membership_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_assignments_org ON assignments(org_id)`);
  // Optional: teams, team_members, resource_acl, invitations, audit_log
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (org_id, name)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL,
      membership_id TEXT NOT NULL,
      role_id TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (team_id, membership_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS resource_acl (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (resource_type, resource_id, subject_type, subject_id, permission)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_resource_acl_org ON resource_acl(org_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role_id TEXT,
      token TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      invited_at TIMESTAMP DEFAULT NOW(),
      accepted_at TIMESTAMP
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(org_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      ip TEXT,
      meta JSONB,
      occurred_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(org_id)`);
  // Agents: add org and roles
  await addColCfg(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS org_id TEXT`);
  await addColCfg(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS role TEXT`);
  await addColCfg(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN`);
  try { await pool.query(`UPDATE agents SET role = COALESCE(role,'agent')`); } catch {}
  try { await pool.query(`UPDATE agents SET is_superadmin = COALESCE(is_superadmin,false)`); } catch {}
  // Ensure a default organization and backfill
  try {
    const r = await pool.query(`SELECT id FROM organizations LIMIT 1`);
    let orgId = r.rowCount ? r.rows[0].id : null;
    if (!orgId) {
      orgId = 'org_default';
      await pool.query(`INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1,$2,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`, [orgId, 'Default']);
    }
    await pool.query(`UPDATE agents SET org_id = COALESCE(org_id,$1)`, [orgId]);
    // Scope key domain tables to org as well (best-effort backfill)
    const addOrg = async (t) => { try { await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS org_id TEXT`); } catch {} try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_${t.replace(/\W/g,'_')}_org ON ${t}(org_id)`); } catch {} };
    await addOrg('messages');
    await addOrg('visitors');
    await addOrg('visits');
    await addOrg('auto_messages');
    await addOrg('welcome_message');
    await addOrg('chatbot_config');
    await addOrg('prompt_config');
    await addOrg('local_prompt');
    await addOrg('mcp_server_config');
    await addOrg('mcp_group');
    await addOrg('mcp_tool_def');
    await addOrg('mcp_files');
    await addOrg('mcp2_kind');
    await addOrg('mcp2_type');
    await addOrg('mcp2_server');
    await addOrg('mcp2_server_tool');
    await addOrg('mcp2_tool');
    await addOrg('mcp2_type_tool');
    await addOrg('app_file');
    await addOrg('file_category');
    await addOrg('grabbing_zasilkovna');
    await addOrg('cron_job');
    try { await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS org_id TEXT`); } catch {}
    // Backfill default org_id where missing
    const backfill = async (t) => { try { await pool.query(`UPDATE ${t} SET org_id = COALESCE(org_id,$1)`, [orgId]); } catch {} };
    await backfill('messages');
    await backfill('visitors');
    await backfill('visits');
    await backfill('auto_messages');
    await backfill('welcome_message');
    await backfill('chatbot_config');
    await backfill('prompt_config');
    await backfill('local_prompt');
    await backfill('mcp_server_config');
    await backfill('mcp_group');
    await backfill('mcp_tool_def');
    await backfill('mcp_files');
    await backfill('mcp2_kind');
    await backfill('mcp2_type');
    await backfill('mcp2_server');
    await backfill('mcp2_server_tool');
    await backfill('mcp2_tool');
    await backfill('mcp2_type_tool');
    await backfill('app_file');
    await backfill('file_category');
    await backfill('grabbing_config');
    await backfill('grabbing_zasilkovna');
    await backfill('cron_job');
  } catch {}
  // Categories for app files
  await pool.query(`
    CREATE TABLE IF NOT EXISTS file_category (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      archived BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_file_category_archived ON file_category(archived)`);
  // Mapping: app_file <-> file_category (many-to-many)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_file_category_map (
      file_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (file_id, category_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_file_cat_file ON app_file_category_map(file_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_file_cat_cat ON app_file_category_map(category_id)`);
  // Application-managed files (local folder + DB metadata)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_file (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      size_bytes INTEGER,
      mtime TIMESTAMP,
      title TEXT,
      description TEXT,
      archived BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_file_archived ON app_file(archived)`); } catch {}
  try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_app_file_updated ON app_file(updated_at DESC)`); } catch {}
  // Grabbing configurations (e.g., Packeta automation)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grabbing_config (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target TEXT,
      options JSONB,
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  try { await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS grabbing_config_name_unique ON grabbing_config (name)`); } catch {}

  // Packeta/Zásilkovna imported rows
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grabbing_zasilkovna (
      submission_number TEXT,
      order_raw TEXT,
      id_order TEXT,
      barcode TEXT,
      packet_id TEXT,
      name TEXT,
      surname TEXT,
      carrier TEXT,
      sender TEXT,
      cod NUMERIC,
      currency TEXT,
      status TEXT,
      ready_for_pickup_until TIMESTAMP NULL,
      delivered_on TIMESTAMP NULL,
      consigned_date TIMESTAMP NULL,
      customer_email TEXT,
      packet_price NUMERIC,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  // Ensure constraints align with spec: 'order_raw' must be unique key
  try { await pool.query(`ALTER TABLE grabbing_zasilkovna DROP CONSTRAINT IF EXISTS grabbing_zasilkovna_pkey`); } catch {}
  // Unique key on order_raw (allow multiple NULLs as per Postgres semantics)
  try { await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS grabbing_zasilkovna_order_raw_unique ON grabbing_zasilkovna (order_raw)`); } catch {}
  // Helpful index for submission_number lookups (no longer PK)
  try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_zasilkovna_submission_number ON grabbing_zasilkovna (submission_number)`); } catch {}
  try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_zasilkovna_id_order ON grabbing_zasilkovna (id_order)`); } catch {}
  try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_zasilkovna_packet_id ON grabbing_zasilkovna (packet_id)`); } catch {}

  // Cron jobs management
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cron_job (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      task TEXT NOT NULL,
      every_hours INTEGER,
      every_days INTEGER,
      at_time TEXT,
      options JSONB,
      enabled BOOLEAN DEFAULT TRUE,
      last_run TIMESTAMP,
      next_run TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  try { await pool.query(`CREATE INDEX IF NOT EXISTS idx_cron_job_enabled_next ON cron_job (enabled, next_run)`); } catch {}
  } catch (e) {
    logToFile(`⚠️ ensureTables failed: ${e.code || ""} ${e.message}`);
  }
}
