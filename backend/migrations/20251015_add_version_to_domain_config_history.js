/**
 * Knex migration: add version column to grabbing_jerome_domain_config_history
 */
/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  const hasHist = await knex.schema.hasTable('grabbing_jerome_domain_config_history');
  if (hasHist) {
    const hasVersion = await knex.schema.hasColumn('grabbing_jerome_domain_config_history', 'version');
    if (!hasVersion) {
      await knex.schema.alterTable('grabbing_jerome_domain_config_history', (t) => {
        t.integer('version');
      });
      // Best-effort backfill: sequential per domain by saved_at
      try {
        await knex.raw(`
          update grabbing_jerome_domain_config_history h
          set version = s.rn
          from (
            select id, row_number() over (partition by domain order by saved_at) as rn
            from grabbing_jerome_domain_config_history
          ) s
          where s.id = h.id and h.version is null
        `);
      } catch (e) {
        // ignore backfill errors; API uses COALESCE on read
      }
    }
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const hasHist = await knex.schema.hasTable('grabbing_jerome_domain_config_history');
  if (hasHist) {
    const hasVersion = await knex.schema.hasColumn('grabbing_jerome_domain_config_history', 'version');
    if (hasVersion) {
      await knex.schema.alterTable('grabbing_jerome_domain_config_history', (t) => {
        t.dropColumn('version');
      });
    }
  }
};

