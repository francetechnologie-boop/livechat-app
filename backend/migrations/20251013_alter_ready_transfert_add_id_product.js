/** Knex migration: add id_product to ready transfer table */
exports.up = async function(knex) {
  await knex.raw(`alter table public.grabbing_jerome_domains_url_ready_transfert add column if not exists id_product bigint`);
  await knex.raw(`create index if not exists grabbing_jerome_domains_url_ready_transfert_id_product_idx on public.grabbing_jerome_domains_url_ready_transfert (id_product)`);
};

exports.down = async function(knex) {
  // Keep column for history; no down migration to drop it
};

