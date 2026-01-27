/**
 * Knex migration: add per-domain config + history for Jerome
 */
/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  // Add config column to grabbing_jerome_domains
  const hasDomains = await knex.schema.hasTable('grabbing_jerome_domains');
  if (hasDomains) {
    const hasConfig = await knex.schema.hasColumn('grabbing_jerome_domains', 'config');
    if (!hasConfig) {
      await knex.schema.alterTable('grabbing_jerome_domains', (t) => {
        t.jsonb('config');
      });
    }
  }
  // History table
  const hasHist = await knex.schema.hasTable('grabbing_jerome_domain_config_history');
  if (!hasHist) {
    await knex.schema.createTable('grabbing_jerome_domain_config_history', (t) => {
      t.bigIncrements('id').primary();
      t.text('domain').notNullable();
      t.jsonb('config');
      t.timestamp('saved_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    await knex.schema.alterTable('grabbing_jerome_domain_config_history', (t) => {
      t.index(['domain'], 'grabbing_jerome_domain_config_history_domain_idx');
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const hasHist = await knex.schema.hasTable('grabbing_jerome_domain_config_history');
  if (hasHist) await knex.schema.dropTableIfExists('grabbing_jerome_domain_config_history');
  const hasDomains = await knex.schema.hasTable('grabbing_jerome_domains');
  if (hasDomains) {
    const hasConfig = await knex.schema.hasColumn('grabbing_jerome_domains', 'config');
    if (hasConfig) {
      await knex.schema.alterTable('grabbing_jerome_domains', (t) => {
        t.dropColumn('config');
      });
    }
  }
};

