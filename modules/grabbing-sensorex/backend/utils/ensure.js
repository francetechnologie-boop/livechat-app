// Ensure helpers for Grabbing-Sensorex module (PostgreSQL DDL guards)
// Each helper is idempotent and safe to run repeatedly.

export function makeEnsureHelpers(pool) {
  async function ensureTableSettingsTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.mod_grabbing_sensorex_table_settings (
        id BIGSERIAL PRIMARY KEY,
        domain TEXT NOT NULL,
        page_type TEXT NOT NULL,
        table_name TEXT NOT NULL,
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        
        mapping JSONB NULL,
        mapping_tools_id BIGINT NULL,
        mapping_version INTEGER NULL
      );
    `);
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = 'mod_grabbing_sensorex_table_settings'
           AND c.conname = 'uq_mod_gs_tbl_settings'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_table_settings
            ADD CONSTRAINT uq_mod_gs_tbl_settings UNIQUE (domain, page_type, table_name);
        EXCEPTION WHEN duplicate_object THEN NULL; END;
      END IF;
    END $$;`);
    // Drop legacy 'mapping' column — mapping lives in mapping_tools.config only now
    await pool.query(`DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_table_settings' AND column_name='mapping'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_table_settings DROP COLUMN mapping;
        EXCEPTION WHEN others THEN NULL; END;
      END IF;
    END $$;`);
   
    await pool.query(`DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_table_settings' AND column_name='setting_image'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_table_settings DROP COLUMN setting_image;
        EXCEPTION WHEN others THEN NULL; END;
      END IF;
    END $$;`);
    // Add 'columns' JSONB to cache table columns resolved from schema
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_table_settings' AND column_name='columns'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_table_settings ADD COLUMN columns JSONB NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
    END $$;`);
    // Linkage to mapping_tools: add mapping_tools_id (FK, guarded) and mapping_version
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_table_settings' AND column_name='mapping_tools_id'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_table_settings ADD COLUMN mapping_tools_id BIGINT NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_table_settings' AND column_name='mapping_version'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_table_settings ADD COLUMN mapping_version INTEGER NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
    END $$;`);
    // Indexes for linkage columns
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gs_tbl_settings_map_id ON public.mod_grabbing_sensorex_table_settings (mapping_tools_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gs_tbl_settings_map_ver ON public.mod_grabbing_sensorex_table_settings (mapping_version)`);
    // Guarded FK to mapping_tools(id) with ON DELETE SET NULL
    await pool.query(`
      DO $$ BEGIN
        IF to_regclass('public.mod_grabbing_sensorex_maping_tools') IS NOT NULL THEN
          BEGIN
            ALTER TABLE public.mod_grabbing_sensorex_table_settings
              ADD CONSTRAINT fk_mod_gs_tbl_settings_maptools
              FOREIGN KEY (mapping_tools_id) REFERENCES public.mod_grabbing_sensorex_maping_tools(id) ON DELETE SET NULL;
          EXCEPTION
            WHEN duplicate_object THEN NULL;
            WHEN others THEN NULL;
          END;
        END IF;
      END $$;
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gs_tbl_settings_domain ON public.mod_grabbing_sensorex_table_settings (domain);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gs_tbl_settings_page_type ON public.mod_grabbing_sensorex_table_settings (page_type);`);
  }

  // Legacy domain_type_config tables removed: no ensure helpers retained in Sensorex.

  async function ensureDomainsTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      create table if not exists public.mod_grabbing_sensorex_domains (
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
    // Best-effort performance indexes (idempotent)
    await pool.query(`DO $$ BEGIN
      BEGIN
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
      EXCEPTION WHEN others THEN NULL; END;
    END $$;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gs_domains_updated_at_desc ON public.mod_grabbing_sensorex_domains (updated_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gs_domains_domain_trgm ON public.mod_grabbing_sensorex_domains USING GIN ((lower(domain)) gin_trgm_ops)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_gs_domains_sitemap_trgm ON public.mod_grabbing_sensorex_domains USING GIN ((lower(coalesce(sitemap_url,''))) gin_trgm_ops)`);
    // Backfill missing JSONB columns on existing instances for compatibility
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_domains' AND column_name='config'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_domains ADD COLUMN config JSONB NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_domains' AND column_name='config_transfert'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_domains ADD COLUMN config_transfert JSONB NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
    END $$;`);
    // Align columns/indexes with expected schema: org_id, org_key and related indexes
    await pool.query(`DO $$ BEGIN
      -- org_id column
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_domains' AND column_name='org_id'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_domains ADD COLUMN org_id INTEGER NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
      -- org_key column
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_domains' AND column_name='org_key'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_domains ADD COLUMN org_key TEXT NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
      -- (org_id, domain) index
      IF to_regclass('public.mod_gs_domains_org_domain_idx') IS NULL THEN
        BEGIN
          CREATE INDEX mod_gs_domains_org_domain_idx ON public.mod_grabbing_sensorex_domains (org_id, domain);
        EXCEPTION WHEN duplicate_object THEN NULL; END;
      END IF;
      -- (org_key, domain) index
      IF to_regclass('public.mod_gs_domains_orgkey_domain_idx') IS NULL THEN
        BEGIN
          CREATE INDEX mod_gs_domains_orgkey_domain_idx ON public.mod_grabbing_sensorex_domains (org_key, domain);
        EXCEPTION WHEN duplicate_object THEN NULL; END;
      END IF;
      -- listing index used by UI
      IF to_regclass('public.idx_mod_gs_domains_updated_at_desc_domain_asc') IS NULL THEN
        BEGIN
          CREATE INDEX idx_mod_gs_domains_updated_at_desc_domain_asc ON public.mod_grabbing_sensorex_domains (updated_at DESC, domain);
        EXCEPTION WHEN duplicate_object THEN NULL; END;
      END IF;
    END $$;`);
  }

  async function ensureExtractionTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      create table if not exists public.mod_grabbing_sensorex_extraction_tools (
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
    await pool.query(`create index if not exists mod_gs_extraction_domain_type_idx on public.mod_grabbing_sensorex_extraction_tools (domain, page_type)`);
    await pool.query(`create index if not exists mod_gs_extraction_org_idx on public.mod_grabbing_sensorex_extraction_tools (org_id)`);
    // Add org_key support (optional parity) on extraction_tools
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_extraction_tools' AND column_name='org_key'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_extraction_tools ADD COLUMN org_key TEXT NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
      IF to_regclass('public.mod_gs_extraction_orgkey_idx') IS NULL THEN
        BEGIN
          CREATE INDEX mod_gs_extraction_orgkey_idx ON public.mod_grabbing_sensorex_extraction_tools (org_key);
        EXCEPTION WHEN duplicate_object THEN NULL; END;
      END IF;
    END $$;`);
  }

  async function ensureExtractionRunsTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      create table if not exists public.mod_grabbing_sensorex_extraction_runs (
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
    await pool.query(`create index if not exists mod_gs_runs_domain_url_idx on public.mod_grabbing_sensorex_extraction_runs (domain, lower(trim(both from url)))`);
    await pool.query(`create index if not exists mod_gs_runs_created_idx on public.mod_grabbing_sensorex_extraction_runs (created_at desc)`);
    await pool.query(`create index if not exists mod_gs_runs_cfg_idx on public.mod_grabbing_sensorex_extraction_runs (config_hash)`);
    await pool.query(`create index if not exists mod_gs_runs_org_idx on public.mod_grabbing_sensorex_extraction_runs (org_id)`);
      await pool.query(`create index if not exists mod_gs_runs_product_idx on public.mod_grabbing_sensorex_extraction_runs (product_id)`);
    // Add mapping_version, mapping, transfer columns if missing (used by sendToPresta)
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_extraction_runs' AND column_name='mapping_version'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_extraction_runs ADD COLUMN mapping_version INTEGER NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_extraction_runs' AND column_name='mapping'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_extraction_runs ADD COLUMN mapping JSONB NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_extraction_runs' AND column_name='transfer'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_extraction_runs ADD COLUMN transfer JSONB NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
    END $$;`);
    // Add org_key column and index when missing
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_extraction_runs' AND column_name='org_key'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_extraction_runs ADD COLUMN org_key TEXT NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
      IF to_regclass('public.mod_gs_runs_orgkey_idx') IS NULL THEN
        BEGIN
          CREATE INDEX mod_gs_runs_orgkey_idx ON public.mod_grabbing_sensorex_extraction_runs (org_key);
        EXCEPTION WHEN duplicate_object THEN NULL; END;
      END IF;
    END $$;`);
  }

  async function ensureSendErrorLogsTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      create table if not exists public.mod_grabbing_sensorex_send_to_presta_error_logs (
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
    await pool.query(`create index if not exists mod_gs_send_err_run_idx on public.mod_grabbing_sensorex_send_to_presta_error_logs (run_id)`);
    await pool.query(`create index if not exists mod_gs_send_err_table_idx on public.mod_grabbing_sensorex_send_to_presta_error_logs (table_name)`);
  }

  async function ensureSendSuccessLogsTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      create table if not exists public.mod_grabbing_sensorex_send_to_presta_success_logs (
        id bigserial primary key,
        run_id bigint null,
        domain text null,
        page_type text null,
        table_name text not null,
        op text null,
        product_id bigint null,
        id_shop integer null,
        id_lang integer null,
        count integer not null default 0,
        sql_query text null,
        payload jsonb null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`);
    // Backfill column when table exists without sql_query
    await pool.query(`DO $$ BEGIN
      IF to_regclass('public.mod_grabbing_sensorex_send_to_presta_success_logs') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_send_to_presta_success_logs' AND column_name='sql_query'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_send_to_presta_success_logs ADD COLUMN sql_query text NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
    END $$;`);
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname='public' AND t.relname='mod_grabbing_sensorex_send_to_presta_success_logs' AND c.conname='uq_mod_gs_send_ok_key') THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_send_to_presta_success_logs
            ADD CONSTRAINT uq_mod_gs_send_ok_key UNIQUE (run_id, table_name, op, id_shop, id_lang);
        EXCEPTION WHEN duplicate_object THEN NULL; END;
      END IF;
    END $$;`);
    await pool.query(`create index if not exists mod_gs_send_ok_run_idx on public.mod_grabbing_sensorex_send_to_presta_success_logs (run_id)`);
    await pool.query(`create index if not exists mod_gs_send_ok_table_idx on public.mod_grabbing_sensorex_send_to_presta_success_logs (table_name)`);
  }

  async function ensureImageMapTable() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.mod_grabbing_sensorex_image_map (
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
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mod_gs_img_map_uq ON public.mod_grabbing_sensorex_image_map (domain, product_id, content_sha1)`);
  }

  async function ensureUrlTables() {
    if (!pool || typeof pool.query !== 'function') return;
    await pool.query(`
      create table if not exists public.mod_grabbing_sensorex_domains_url (
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
    await pool.query(`create index if not exists mod_grabbing_sensorex_domains_url_domain_idx on public.mod_grabbing_sensorex_domains_url (domain)`);
    await pool.query(`create unique index if not exists mod_grabbing_sensorex_domains_url_uq on public.mod_grabbing_sensorex_domains_url (domain, lower(trim(both from url)))`);
    // Add org_key column and related index when missing (parity with Jerome)
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_domains_url' AND column_name='org_key'
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_domains_url ADD COLUMN org_key TEXT NULL;
        EXCEPTION WHEN duplicate_column THEN NULL; END;
      END IF;
      IF to_regclass('public.mod_gs_domains_url_orgkey_idx') IS NULL THEN
        BEGIN
          CREATE INDEX mod_gs_domains_url_orgkey_idx ON public.mod_grabbing_sensorex_domains_url (org_key);
        EXCEPTION WHEN duplicate_object THEN NULL; END;
      END IF;
    END $$;`);
  }

  return {
    ensureTableSettingsTable,
    ensureDomainsTable,
    ensureExtractionTable,
    ensureExtractionRunsTable,
    ensureSendErrorLogsTable,
    ensureSendSuccessLogsTable,
    ensureImageMapTable,
    async ensureCategoryExtractTable() {
      if (!pool || typeof pool.query !== 'function') return;
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.mod_grabbing_sensorex_category_extract (
          id BIGSERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL,
          category TEXT NOT NULL,
          categories JSONB NULL,
          id_category INTEGER NULL,
          id_categories INT[] NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await pool.query(`
        DO $$ BEGIN
          IF to_regclass('public.mod_gs_cat_extract_uq') IS NULL THEN
            BEGIN
              CREATE UNIQUE INDEX mod_gs_cat_extract_uq ON public.mod_grabbing_sensorex_category_extract (product_id, category);
            EXCEPTION WHEN duplicate_object THEN NULL; END;
          END IF;
        END $$;
      `);
      // Backfill id_category column if table pre-existed
      await pool.query(`DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_category_extract' AND column_name='id_category'
        ) THEN
          BEGIN
            ALTER TABLE public.mod_grabbing_sensorex_category_extract ADD COLUMN id_category INTEGER NULL;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
        END IF;
      END $$;`);
      // Backfill categories (JSONB) column if table pre-existed
      await pool.query(`DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_category_extract' AND column_name='categories'
        ) THEN
          BEGIN
            ALTER TABLE public.mod_grabbing_sensorex_category_extract ADD COLUMN categories JSONB NULL;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
        END IF;
      END $$;`);
      // Backfill id_categories column if table pre-existed
      await pool.query(`DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_category_extract' AND column_name='id_categories'
        ) THEN
          BEGIN
            ALTER TABLE public.mod_grabbing_sensorex_category_extract ADD COLUMN id_categories INT[] NULL;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
        END IF;
      END $$;`);
      // Optional index for lookups by id_category
      await pool.query(`DO $$ BEGIN
        IF to_regclass('public.mod_gs_cat_extract_cat_idx') IS NULL THEN
          BEGIN
            CREATE INDEX mod_gs_cat_extract_cat_idx ON public.mod_grabbing_sensorex_category_extract (id_category);
          EXCEPTION WHEN duplicate_object THEN NULL; END;
        END IF;
      END $$;`);
      await pool.query(`DO $$ BEGIN
        IF to_regclass('public.mod_gs_cat_extract_cats_gin') IS NULL THEN
          BEGIN
            CREATE INDEX mod_gs_cat_extract_cats_gin ON public.mod_grabbing_sensorex_category_extract USING GIN (id_categories);
          EXCEPTION WHEN duplicate_object THEN NULL; END;
        END IF;
      END $$;`);
      // Optional GIN index for categories JSONB (path ops)
      await pool.query(`DO $$ BEGIN
        IF to_regclass('public.mod_gs_cat_extract_categories_gin') IS NULL THEN
          BEGIN
            CREATE INDEX mod_gs_cat_extract_categories_gin ON public.mod_grabbing_sensorex_category_extract USING GIN (categories jsonb_path_ops);
          EXCEPTION WHEN duplicate_object THEN NULL; END;
        END IF;
      END $$;`);
    },
    // New: mapping tools table (versioned mappings like extraction tools)
    async ensureMappingToolsTable() {
      if (!pool || typeof pool.query !== 'function') return;
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.mod_grabbing_sensorex_maping_tools (
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
          SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_mod_gs_maping'
        ) THEN
          CREATE UNIQUE INDEX uq_mod_gs_maping ON public.mod_grabbing_sensorex_maping_tools (domain, page_type, version, org_id);
        END IF;
      END $$;`);
      await pool.query(`CREATE INDEX IF NOT EXISTS mod_gs_maping_domain_type_idx ON public.mod_grabbing_sensorex_maping_tools (domain, page_type);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS mod_gs_maping_org_idx ON public.mod_grabbing_sensorex_maping_tools (org_id);`);
      // Optional org_key support for mapping tools (parity with other tables)
      await pool.query(`DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_maping_tools' AND column_name='org_key'
        ) THEN
          BEGIN
            ALTER TABLE public.mod_grabbing_sensorex_maping_tools ADD COLUMN org_key TEXT NULL;
          EXCEPTION WHEN duplicate_column THEN NULL; END;
        END IF;
        IF to_regclass('public.mod_gs_maping_orgkey_idx') IS NULL THEN
          BEGIN
            CREATE INDEX mod_gs_maping_orgkey_idx ON public.mod_grabbing_sensorex_maping_tools (org_key);
          EXCEPTION WHEN duplicate_object THEN NULL; END;
        END IF;
      END $$;`);
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
            ALTER TABLE public.mod_grabbing_sensorex_maping_tools
              ADD CONSTRAINT fk_mod_gs_maping_org
              FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
          EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
        END IF;
      END $$;`);
    },
    ensureUrlTables,
  };
}
