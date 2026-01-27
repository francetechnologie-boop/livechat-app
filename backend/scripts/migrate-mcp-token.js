import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL || 'postgresql://livechat_user:Alexcaroline12@127.0.0.1:5432/livechat';
  const ssl = String(process.env.PGSSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : false;
  const pool = new Pool({ connectionString, ssl });
  const client = await pool.connect();
  try {
    console.log('Ensuring chatbot_config exists and has mcp_token column...');
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
    await client.query(`ALTER TABLE chatbot_config ADD COLUMN IF NOT EXISTS mcp_token TEXT`);
    console.log('OK.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
