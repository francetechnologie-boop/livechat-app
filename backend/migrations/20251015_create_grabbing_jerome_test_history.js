module.exports.up = async function up(db) {
  const isKnex = typeof db?.schema === 'object' && typeof db?.raw === 'function';
  if (isKnex) {
    await db.schema.createTable('grabbing_jerome_test_history', (t) => {
      t.bigIncrements('id').primary();
      t.string('domain', 255).notNullable();
      t.text('url').notNullable();
      t.string('user_id', 255).nullable();
      t.integer('use_count').notNullable().defaultTo(1);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
      t.timestamp('last_used_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
      t.unique(['domain', 'user_id', 'url'], 'uq_gjth_domain_user_url');
    });
    await db.raw("CREATE INDEX IF NOT EXISTS idx_gjth_domain_user_last ON grabbing_jerome_test_history(domain, user_id, last_used_at DESC)");
  } else if (typeof db?.query === 'function') {
    await db.query(`
      CREATE TABLE IF NOT EXISTS public.grabbing_jerome_test_history (
        id BIGSERIAL PRIMARY KEY,
        domain VARCHAR(255) NOT NULL,
        url TEXT NOT NULL,
        user_id VARCHAR(255) NULL,
        use_count INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_gjth_domain_user_url UNIQUE (domain, user_id, url)
      );
      CREATE INDEX IF NOT EXISTS idx_gjth_domain_user_last ON public.grabbing_jerome_test_history(domain, user_id, last_used_at DESC);
    `);
  }
};

module.exports.down = async function down(db) {
  const isKnex = typeof db?.schema === 'object' && typeof db?.raw === 'function';
  if (isKnex) {
    await db.raw('DROP INDEX IF EXISTS idx_gjth_domain_user_last');
    await db.schema.dropTableIfExists('grabbing_jerome_test_history');
  } else if (typeof db?.query === 'function') {
    await db.query(`
      DROP INDEX IF EXISTS idx_gjth_domain_user_last;
      DROP TABLE IF EXISTS public.grabbing_jerome_test_history;
    `);
  }
};

