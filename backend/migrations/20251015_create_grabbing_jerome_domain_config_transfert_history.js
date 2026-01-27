/**
 * Knex migration: create grabbing_jerome_domain_config_transfert_history
 * Tracks per-domain, per-type transfer config with versioning.
 */
/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const has = await knex.schema.hasTable('grabbing_jerome_domain_config_transfert_history');
  if (!has) {
    await knex.schema.createTable('grabbing_jerome_domain_config_transfert_history', (t) => {
      t.bigIncrements('id').primary();
      t.text('domain').notNullable();
      t.text('type').notNullable(); // e.g., 'product' | 'category' | 'page'
      t.jsonb('config');
      t.timestamp('saved_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.integer('version');
    });
    await knex.schema.alterTable('grabbing_jerome_domain_config_transfert_history', (t) => {
      t.index(['domain', 'type'], 'gj_dom_cfg_transfert_hist_domain_type_idx');
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const has = await knex.schema.hasTable('grabbing_jerome_domain_config_transfert_history');
  if (has) await knex.schema.dropTableIfExists('grabbing_jerome_domain_config_transfert_history');
};

