/** Knex migration: add result_json (jsonb) to ready transfer table */
exports.up = async function(knex) {
  await knex.raw(
    `alter table public.grabbing_jerome_domains_url_ready_transfert 
       add column if not exists result_json jsonb`
  );
};

exports.down = async function(_knex) {
  // Non-destructive: keep the column for history/debug purposes
};

