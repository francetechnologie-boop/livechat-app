#!/usr/bin/env node
import 'dotenv/config.js';
import pg from 'pg';

async function rebuildChatbotTable(client) {
  // Rebuild table to reset internal column counter and include instructions
  await client.query(`
    CREATE TABLE IF NOT EXISTS chatbot_config_rebuilt (
      id_bot TEXT PRIMARY KEY,
      shop_name TEXT NOT NULL,
      lang_iso VARCHAR(16) NOT NULL,
      enabled BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      name TEXT,
      openai_api_key TEXT,
      prompt_id TEXT,
      prompt_version TEXT,
      bot_behavior TEXT,
      instructions TEXT,
      mcp_token TEXT,
      mcp_enabled BOOLEAN,
      mcp_tools TEXT[],
      web_search_enabled BOOLEAN,
      org_id TEXT
    );
  `);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS chatbot_config_shop_lang_unique_rebuilt ON chatbot_config_rebuilt (shop_name, lang_iso)`);
  const hasInstr = await client.query(`
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='chatbot_config' AND column_name='instructions'
     LIMIT 1`);
  if (hasInstr.rowCount) {
    await client.query(`
      INSERT INTO chatbot_config_rebuilt (id_bot, shop_name, lang_iso, enabled, created_at, updated_at, name, openai_api_key, prompt_id, prompt_version, bot_behavior, instructions, mcp_token, mcp_enabled, mcp_tools, web_search_enabled, org_id)
      SELECT id_bot, shop_name, lang_iso, enabled, created_at, updated_at, name, openai_api_key, prompt_id, prompt_version, bot_behavior, instructions, mcp_token, mcp_enabled, mcp_tools, web_search_enabled, org_id
      FROM chatbot_config
      ON CONFLICT (id_bot) DO NOTHING
    `);
  } else {
    await client.query(`
      INSERT INTO chatbot_config_rebuilt (id_bot, shop_name, lang_iso, enabled, created_at, updated_at, name, openai_api_key, prompt_id, prompt_version, bot_behavior, instructions, mcp_token, mcp_enabled, mcp_tools, web_search_enabled, org_id)
      SELECT id_bot, shop_name, lang_iso, enabled, created_at, updated_at, name, openai_api_key, prompt_id, prompt_version, bot_behavior, NULL::TEXT AS instructions, mcp_token, mcp_enabled, mcp_tools, web_search_enabled, NULL::TEXT AS org_id
      FROM chatbot_config
      ON CONFLICT (id_bot) DO NOTHING
    `);
  }
  await client.query(`DROP TABLE chatbot_config`);
  await client.query(`ALTER TABLE chatbot_config_rebuilt RENAME TO chatbot_config`);
  await client.query(`ALTER INDEX chatbot_config_shop_lang_unique_rebuilt RENAME TO chatbot_config_shop_lang_unique`);
}

async function main() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://livechat_user:Alexcaroline12@127.0.0.1:5432/livechat';
  const ssl = String(process.env.PGSSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : false;
  const pool = new pg.Pool({ connectionString, ssl });
  const client = await pool.connect();
  try {
    // Ensure base table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS chatbot_config (
        id_bot TEXT PRIMARY KEY,
        shop_name TEXT NOT NULL,
        lang_iso VARCHAR(16) NOT NULL,
        enabled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS chatbot_config_shop_lang_unique ON chatbot_config (shop_name, lang_iso)`);

    const add = async (sql) => { try { await client.query(sql); } catch {} };
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS name TEXT`);
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS openai_api_key TEXT`);
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS prompt_id TEXT`);
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS prompt_version TEXT`);
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS bot_behavior TEXT`);
    // Try to add instructions; if we hit 1600-column limit, rebuild
    try {
      await client.query(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS instructions TEXT`);
    } catch (e) {
      const msg = String(e?.message || '');
      if (e?.code === '54011' || /at most 1600 columns/i.test(msg)) {
        // Rebuild table with instructions
        await rebuildChatbotTable(client);
      } else {
        throw e;
      }
    }
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS mcp_token TEXT`);
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS mcp_enabled BOOLEAN`);
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS mcp_tools TEXT[]`);
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS web_search_enabled BOOLEAN`);
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS local_prompt_id TEXT`);
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS org_id TEXT`);
    // Welcome message per chatbot (for UI greetings)
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS welcome_message TEXT`);
    // Link to predefined welcome message (canonical reference)
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS welcome_message_id TEXT`);

    // Ensure local_prompt repository table
    await client.query(`
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
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS local_prompt_name_unique ON local_prompt (name)`);

    // Ensure prompt_config as canonical repository (migrate from local_prompt)
    await client.query(`
      CREATE TABLE IF NOT EXISTS prompt_config (
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
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS prompt_config_name_unique ON prompt_config (name)`);
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS prompt_config_id TEXT`);
    try {
      await client.query(`
        INSERT INTO prompt_config (id, name, dev_message, messages, tools, openai_api_key, prompt_id, prompt_version, created_at, updated_at)
        SELECT id, name, dev_message, messages, tools, openai_api_key, prompt_id, prompt_version, created_at, updated_at
        FROM local_prompt
        ON CONFLICT (id) DO NOTHING`);
    } catch {}
    try {
      await client.query(`
        UPDATE chatbot_config SET prompt_config_id = local_prompt_id
        WHERE prompt_config_id IS NULL AND local_prompt_id IS NOT NULL`);
    } catch {}

    // No explicit transaction to avoid 25P02 on partial failures
    console.log('[ensure-columns] chatbot_config ensured (with instructions)');
  } catch (e) {
    console.error('[ensure-columns] failed:', e.code || '', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error('[ensure-columns] fatal:', e.message); process.exit(1); });
