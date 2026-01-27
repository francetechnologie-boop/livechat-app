/** Knex migration: add result_json to grabbing_jerome_domains_url_page_explore */
exports.up = async function(knex) {
  await knex.raw(`alter table public.grabbing_jerome_domains_url_page_explore add column if not exists result_json jsonb`);
};

exports.down = async function(_knex) {
  // Keep column for history; no down migration
};

