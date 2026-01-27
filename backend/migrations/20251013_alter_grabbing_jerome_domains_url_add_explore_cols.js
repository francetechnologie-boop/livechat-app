/** Knex migration: add explore columns to grabbing_jerome_domains_url */
exports.up = async function(knex) {
  // Add columns if not exists
  await knex.raw(`alter table public.grabbing_jerome_domains_url add column if not exists page_type text`);
  await knex.raw(`alter table public.grabbing_jerome_domains_url add column if not exists meta jsonb`);
  await knex.raw(`alter table public.grabbing_jerome_domains_url add column if not exists product jsonb`);
  await knex.raw(`alter table public.grabbing_jerome_domains_url add column if not exists explored timestamptz`);
};

exports.down = async function(knex) {
  // Non-destructive: keep columns (they are useful). If needed, uncomment to drop.
  // await knex.schema.table('grabbing_jerome_domains_url', (t) => {
  //   t.dropColumn('page_type');
  //   t.dropColumn('meta');
  //   t.dropColumn('product');
  //   t.dropColumn('explored');
  // });
};

