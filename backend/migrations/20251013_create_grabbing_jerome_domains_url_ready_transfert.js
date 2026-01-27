/**
 * Knex migration: create grabbing_jerome_domains_url_ready_transfert
 * Holds normalized, ready-to-transfer payloads for PrestaShop 8.
 */
exports.up = async function(knex) {
  const has = await knex.schema.withSchema('public').hasTable('grabbing_jerome_domains_url_ready_transfert');
  if (!has) {
    await knex.schema.withSchema('public').createTable('grabbing_jerome_domains_url_ready_transfert', (t) => {
      t.specificType('id', 'bigserial').primary();
      t.text('domain').notNullable();
      t.text('url').notNullable();
      t.specificType('prepared_at', 'timestamptz').notNullable().defaultTo(knex.fn.now());
      t.bigInteger('source_url_id').nullable(); // optional link to grabbing_jerome_domains_url.id
      t.text('page_type').nullable();
      t.text('title').nullable();
      t.specificType('meta', 'jsonb');
      t.specificType('product_raw', 'jsonb');
      t.specificType('mapped', 'jsonb'); // normalized mapping for Presta
      t.text('status').notNullable().defaultTo('pending'); // pending | ready | failed | transferred
      t.text('notes');
    });
  }
  await knex.raw(`create index if not exists grabbing_jerome_domains_url_ready_transfert_domain_idx on public.grabbing_jerome_domains_url_ready_transfert (domain)`);
  await knex.raw(`create unique index if not exists grabbing_jerome_domains_url_ready_transfert_uq on public.grabbing_jerome_domains_url_ready_transfert (domain, lower(trim(both from url)))`);
};

exports.down = async function(knex) {
  await knex.schema.withSchema('public').dropTableIfExists('grabbing_jerome_domains_url_ready_transfert');
};

