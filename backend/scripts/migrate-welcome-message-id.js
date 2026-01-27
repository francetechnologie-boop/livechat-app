#!/usr/bin/env node
import 'dotenv/config.js';
import pg from 'pg';

async function main() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://livechat_user:Alexcaroline12@127.0.0.1:5432/livechat';
  const ssl = String(process.env.PGSSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : false;
  const pool = new pg.Pool({ connectionString, ssl });
  const client = await pool.connect();
  try {
    console.log('[migrate-welcome-message-id] start');
    // Ensure chatbot_config exists
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

    // Add columns needed for welcome message linking
    const add = async (sql) => { try { await client.query(sql); } catch (e) { if (e?.code !== '42701') throw e; } }; // 42701 = duplicate_column
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS welcome_message TEXT`);
    await add(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS welcome_message_id TEXT`);

    console.log('[migrate-welcome-message-id] columns ensured on chatbot_config');

    // Optional: backfill welcome_message_id based on heuristic from existing welcome_message content (no-op by default)
    // This section intentionally left minimal to avoid unintended data changes.

    console.log('[migrate-welcome-message-id] done');
  } catch (e) {
    console.error('[migrate-welcome-message-id] failed:', e.code || '', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error('[migrate-welcome-message-id] fatal:', e.message); process.exit(1); });
