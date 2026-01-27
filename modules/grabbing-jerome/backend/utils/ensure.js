// Ensure helpers for Grabbing-Jerome module (PostgreSQL DDL guards)
// Each helper is idempotent and safe to run repeatedly.

export function makeEnsureHelpers(pool) {
  async function ensureTableSettingsTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.mod_grabbing_jerome_table_settings (
        id BIGSERIAL PRIMARY KEY,
        domain TEXT NOT NULL,
        page_type TEXT NOT NULL,
        table_name TEXT NOT NULL,
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = 'mod_grabbing_jerome_table_settings'
           AND c.conname = 'uq_mod_gj_tbl_settings'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_jerome_table_settings
            ADD CONSTRAINT uq_mod_gj_tbl_settings UNIQUE (domain, page_type, table_name);
        EXCEPTION WHEN duplicate_object THEN NULL; END;
      END IF;
    END $$;`);
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_jerome_table_settings' AND column_name='mapping'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_jerome_table_settings ADD COLUMN mapping JSONB NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
    END $$;`);
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_jerome_table_settings' AND column_name='setting_image'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_jerome_table_settings ADD COLUMN setting_image JSONB NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
    END $$;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gj_tbl_settings_domain ON public.mod_grabbing_jerome_table_settings (domain);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gj_tbl_settings_page_type ON public.mod_grabbing_jerome_table_settings (page_type);`);
  }

  async function ensureDomainTypeConfigTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.mod_grabbing_jerome_domain_type_config (
        id BIGSERIAL PRIMARY KEY,
        domain TEXT NOT NULL,
        page_type TEXT NOT NULL,
        config JSONB NULL,
        tables JSONB NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname='public' AND t.relname='mod_grabbing_jerome_domain_type_config' AND c.conname='uq_mod_gj_domain_type_cfg') THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_jerome_domain_type_config
            ADD CONSTRAINT uq_mod_gj_domain_type_cfg UNIQUE (domain, page_type);
        EXCEPTION WHEN duplicate_object THEN NULL; END;
      END IF;
    END $$;`);
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_jerome_domain_type_config' AND column_name='version'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_jerome_domain_type_config ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
    END $$;`);
  }

  async function ensureDomainTypeConfigHistoryTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.mod_grabbing_jerome_domain_type_config_hist (
        id BIGSERIAL PRIMARY KEY,
        domain TEXT NOT NULL,
        page_type TEXT NOT NULL,
        version INTEGER NOT NULL,
        config JSONB NULL,
        tables JSONB NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS mod_gj_dt_cfg_hist_key_idx ON public.mod_grabbing_jerome_domain_type_config_hist (domain, page_type, version)`);
  }

  async function ensureDomainsTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      create table if not exists public.mod_grabbing_jerome_domains (
        domain text primary key,
        sitemap_url text,
        sitemaps jsonb,
        selected_sitemaps jsonb,
        sitemap_total_urls integer default 0,
        config jsonb,
        config_transfert jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`);
  }

  async function ensureExtractionTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      create table if not exists public.mod_grabbing_jerome_extraction_tools (
        id bigserial primary key,
        domain text not null,
        page_type text not null,
        version integer not null default 1,
        name text,
        config jsonb,
        enabled boolean not null default true,
        org_id integer null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`);
    await pool.query(`create index if not exists mod_gj_extraction_domain_type_idx on public.mod_grabbing_jerome_extraction_tools (domain, page_type)`);
    await pool.query(`create index if not exists mod_gj_extraction_org_idx on public.mod_grabbing_jerome_extraction_tools (org_id)`);
  }

  async function ensureExtractionRunsTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      create table if not exists public.mod_grabbing_jerome_extraction_runs (
        id bigserial primary key,
        domain text not null,
        url text not null,
        page_type text not null default 'product',
        version integer null,
        config_hash text null,
        config jsonb null,
        result jsonb not null,
        ok boolean not null default true,
        error text null,
        org_id integer null,
        product_id integer null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`);
    await pool.query(`create index if not exists mod_gj_runs_domain_url_idx on public.mod_grabbing_jerome_extraction_runs (domain, lower(trim(both from url)))`);
    await pool.query(`create index if not exists mod_gj_runs_created_idx on public.mod_grabbing_jerome_extraction_runs (created_at desc)`);
    await pool.query(`create index if not exists mod_gj_runs_cfg_idx on public.mod_grabbing_jerome_extraction_runs (config_hash)`);
    await pool.query(`create index if not exists mod_gj_runs_org_idx on public.mod_grabbing_jerome_extraction_runs (org_id)`);
    await pool.query(`create index if not exists mod_gj_runs_product_idx on public.mod_grabbing_jerome_extraction_runs (product_id)`);
  }

  async function ensureSendErrorLogsTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      create table if not exists public.mod_grabbing_jerome_send_to_presta_error_logs (
        id bigserial primary key,
        run_id bigint null,
        domain text null,
        page_type text null,
        table_name text null,
        op text null,
        product_id bigint null,
        id_shop integer null,
        id_lang integer null,
        error text null,
        payload jsonb null,
        created_at timestamptz not null default now()
      )`);
    await pool.query(`create index if not exists mod_gj_send_err_run_idx on public.mod_grabbing_jerome_send_to_presta_error_logs (run_id)`);
    await pool.query(`create index if not exists mod_gj_send_err_table_idx on public.mod_grabbing_jerome_send_to_presta_error_logs (table_name)`);
  }

  async function ensureImageMapTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.mod_grabbing_jerome_image_map (
        id BIGSERIAL PRIMARY KEY,
        domain TEXT NOT NULL,
        product_id BIGINT NOT NULL,
        source_url TEXT,
        url_hash TEXT,
        content_sha1 TEXT NOT NULL,
        id_image BIGINT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mod_gj_img_map_uq ON public.mod_grabbing_jerome_image_map (domain, product_id, content_sha1)`);
  }

  async function ensureUrlTables() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      create table if not exists public.mod_grabbing_jerome_domains_url (
        id bigserial primary key,
        domain text not null,
        url text not null,
        type text,
        title text,
        page_type text,
        meta jsonb,
        product jsonb,
        explored timestamptz,
        discovered_at timestamptz not null default now()
      )`);
    await pool.query(`create index if not exists mod_grabbing_jerome_domains_url_domain_idx on public.mod_grabbing_jerome_domains_url (domain)`);
    await pool.query(`create unique index if not exists mod_grabbing_jerome_domains_url_uq on public.mod_grabbing_jerome_domains_url (domain, lower(trim(both from url)))`);
  }

  return {
    ensureTableSettingsTable,
    ensureDomainTypeConfigTable,
    ensureDomainTypeConfigHistoryTable,
    ensureDomainsTable,
    ensureExtractionTable,
    ensureExtractionRunsTable,
    ensureSendErrorLogsTable,
    ensureImageMapTable,
    // New: mapping tools table (versioned mappings like extraction tools)
    async ensureMappingToolsTable() {
      if (!pool || typeof pool.query !== 'function') return;
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.mod_grabbing_jerome_maping_tools (
          id BIGSERIAL PRIMARY KEY,
          domain TEXT NOT NULL,
          page_type TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          name TEXT,
          config JSONB,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          org_id INTEGER NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await pool.query(`DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_mod_gj_maping'
        ) THEN
          CREATE UNIQUE INDEX uq_mod_gj_maping ON public.mod_grabbing_jerome_maping_tools (domain, page_type, version, org_id);
        END IF;
      END $$;`);
      await pool.query(`CREATE INDEX IF NOT EXISTS mod_gj_maping_domain_type_idx ON public.mod_grabbing_jerome_maping_tools (domain, page_type);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS mod_gj_maping_org_idx ON public.mod_grabbing_jerome_maping_tools (org_id);`);
      await pool.query(`DO $$ BEGIN
        IF to_regclass('public.organizations') IS NOT NULL AND EXISTS (
          SELECT 1
            FROM pg_index i
            JOIN pg_class t ON t.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
           WHERE n.nspname = 'public' AND t.relname = 'organizations'
             AND i.indisunique = TRUE
             AND array_length(i.indkey,1) = 1
             AND a.attname = 'id'
        ) THEN
          BEGIN
            ALTER TABLE public.mod_grabbing_jerome_maping_tools
              ADD CONSTRAINT fk_mod_gj_maping_org
              FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
          EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
        END IF;
      END $$;`);
    },
    ensureUrlTables,
  };
}
