/** Knex migration: create grabbing_jerome_page_explore table */
exports.up = async function(knex) {
  const has = await knex.schema.withSchema('public').hasTable('grabbing_jerome_domains_url_page_explore');
  if (!has) {
    await knex.schema.withSchema('public').createTable('grabbing_jerome_domains_url_page_explore', (t) => {
      t.specificType('id', 'bigserial').primary();
      t.text('domain').notNullable();
      t.text('url').notNullable();
      t.text('page_type').notNullable();
      t.specificType('meta', 'jsonb');
      t.specificType('product', 'jsonb');
      t.specificType('links_sample', 'jsonb');
      t.specificType('explored_at', 'timestamptz').notNullable().defaultTo(knex.fn.now());
    });
  }
  await knex.raw(`create index if not exists grabbing_jerome_domains_url_page_explore_domain_idx on public.grabbing_jerome_domains_url_page_explore (domain)`);
  await knex.raw(`create unique index if not exists grabbing_jerome_domains_url_page_explore_uq on public.grabbing_jerome_domains_url_page_explore (domain, lower(trim(both from url)))`);
};

exports.down = async function(knex) {
  await knex.schema.withSchema('public').dropTableIfExists('grabbing_jerome_domains_url_page_explore');
};
