/**
 * Knex migration: create grabbing_jerome_domains_url with indexes
 */
exports.up = async function(knex) {
  const has = await knex.schema.hasTable('grabbing_jerome_domains_url');
  if (!has) {
    await knex.schema.withSchema('public').createTable('grabbing_jerome_domains_url', (t) => {
      t.specificType('id', 'bigserial').primary();
      t.text('domain').notNullable();
      t.text('url').notNullable();
      t.text('type').nullable();
      t.text('title').nullable();
      t.specificType('discovered_at', 'timestamptz').notNullable().defaultTo(knex.fn.now());
    });
  }
  await knex.raw(`create index if not exists grabbing_jerome_domains_url_domain_idx on public.grabbing_jerome_domains_url (domain)`);
  await knex.raw(`create unique index if not exists grabbing_jerome_domains_url_uq on public.grabbing_jerome_domains_url (domain, lower(trim(both from url)))`);
};

exports.down = async function(knex) {
  await knex.schema.withSchema('public').dropTableIfExists('grabbing_jerome_domains_url');
};
