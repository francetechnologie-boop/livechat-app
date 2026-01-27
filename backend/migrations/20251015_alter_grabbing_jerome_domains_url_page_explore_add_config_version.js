module.exports.up = async function up(db) {
  const isKnex = typeof db?.schema === 'object' && typeof db?.raw === 'function';
  const sql = `ALTER TABLE IF EXISTS public.grabbing_jerome_domains_url_page_explore
    ADD COLUMN IF NOT EXISTS config_version INT NULL,
    ADD COLUMN IF NOT EXISTS type_reason TEXT NULL;`;
  if (isKnex) {
    await db.raw(sql);
  } else if (typeof db?.query === 'function') {
    await db.query(sql);
  }
};

module.exports.down = async function down(db) {
  const isKnex = typeof db?.schema === 'object' && typeof db?.raw === 'function';
  const sql = `ALTER TABLE IF EXISTS public.grabbing_jerome_domains_url_page_explore
    DROP COLUMN IF EXISTS config_version,
    DROP COLUMN IF EXISTS type_reason;`;
  if (isKnex) {
    await db.raw(sql);
  } else if (typeof db?.query === 'function') {
    await db.query(sql);
  }
};

