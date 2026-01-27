/**
 * Knex migration: add config_transfert to grabbing_jerome_domains (per-type transfer config)
 */
/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasDomains = await knex.schema.hasTable('grabbing_jerome_domains');
  if (hasDomains) {
    const hasCol = await knex.schema.hasColumn('grabbing_jerome_domains', 'config_transfert');
    if (!hasCol) {
      await knex.schema.alterTable('grabbing_jerome_domains', (t) => {
        t.jsonb('config_transfert');
      });
    }
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const hasDomains = await knex.schema.hasTable('grabbing_jerome_domains');
  if (hasDomains) {
    const hasCol = await knex.schema.hasColumn('grabbing_jerome_domains', 'config_transfert');
    if (hasCol) {
      await knex.schema.alterTable('grabbing_jerome_domains', (t) => {
        t.dropColumn('config_transfert');
      });
    }
  }
};

