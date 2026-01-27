/** Knex migration: add config_version to grabbing_jerome_domains_url_page_explore */
exports.up = async function(knex) {
  await knex.raw(`alter table public.grabbing_jerome_domains_url_page_explore add column if not exists config_version integer`);
};

exports.down = async function(_knex) {
  // Keep column; no down migration
};

