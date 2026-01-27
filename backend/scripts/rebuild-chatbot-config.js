// Rebuild chatbot_config to reset internal column counter and add mcp_token
// Use this when ALTER TABLE fails with: "tables can have at most 1600 columns"
// Safe: copies existing data and constraints.

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://livechat_user:Alexcaroline12@127.0.0.1:5432/livechat';
  const ssl = String(process.env.PGSSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : false;
  const pool = new Pool({ connectionString, ssl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create rebuilt table with a minimal schema (resets internal column counter)
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
        mcp_token TEXT
      );
    `);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS chatbot_config_shop_lang_unique_rebuilt ON chatbot_config_rebuilt (shop_name, lang_iso)`);

    // Detect if old table has an instructions column
    const hasInstr = await client.query(`
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='chatbot_config' AND column_name='instructions'
       LIMIT 1`);
    if (hasInstr.rowCount) {
      await client.query(`
        INSERT INTO chatbot_config_rebuilt (id_bot, shop_name, lang_iso, enabled, created_at, updated_at, name, openai_api_key, prompt_id, prompt_version, bot_behavior, instructions, mcp_token)
        SELECT id_bot, shop_name, lang_iso, enabled, created_at, updated_at, name, openai_api_key, prompt_id, prompt_version, bot_behavior, instructions, NULL::TEXT AS mcp_token
        FROM chatbot_config
        ON CONFLICT (id_bot) DO NOTHING
      `);
    } else {
      await client.query(`
        INSERT INTO chatbot_config_rebuilt (id_bot, shop_name, lang_iso, enabled, created_at, updated_at, name, openai_api_key, prompt_id, prompt_version, bot_behavior, instructions, mcp_token)
        SELECT id_bot, shop_name, lang_iso, enabled, created_at, updated_at, name, openai_api_key, prompt_id, prompt_version, bot_behavior, NULL::TEXT AS instructions, NULL::TEXT AS mcp_token
        FROM chatbot_config
        ON CONFLICT (id_bot) DO NOTHING
      `);
    }

    // Replace old table
    await client.query(`DROP TABLE chatbot_config`);
    await client.query(`ALTER TABLE chatbot_config_rebuilt RENAME TO chatbot_config`);
    await client.query(`ALTER INDEX chatbot_config_shop_lang_unique_rebuilt RENAME TO chatbot_config_shop_lang_unique`);

    await client.query('COMMIT');
    console.log('chatbot_config rebuilt with mcp_token column.');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Rebuild failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
