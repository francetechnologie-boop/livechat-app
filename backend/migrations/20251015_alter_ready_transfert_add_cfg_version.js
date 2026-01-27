/** Knex migration: add config_transfert_version to ready transfer table */
exports.up = async function(knex) {
  await knex.raw(`alter table public.grabbing_jerome_domains_url_ready_transfert add column if not exists config_transfert_version integer`);
};

exports.down = async function(_knex) {
  // Keep column; no down migration
};

