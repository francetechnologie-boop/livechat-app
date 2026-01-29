# Migrations (Postgres) - Guardrails

We hit many migration failures due to small SQL syntax pitfalls. Before deploying or running a module installer, run:

```bash
node backend/scripts/check-migrations.cjs
```

## Common gotchas

- No `ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS ...` in Postgres. Use a guarded `DO ... EXCEPTION WHEN duplicate_object THEN NULL;` block.
- Do not nest the same dollar-quote delimiter:
  - Bad: `DO $$ ... EXECUTE $$ ... $$; ... $$;`
  - Good: `DO $do$ ... EXECUTE $sql$ ... $sql$; ... END $do$;`
- Prefer idempotent migrations:
  - Guard with `to_regclass('public.<table>') IS NOT NULL` / `ALTER TABLE IF EXISTS ...`
  - Wrap environment-dependent ops in `BEGIN ... EXCEPTION WHEN others THEN NULL; END;`
- Avoid embedding executable rollback SQL in the same `.sql` file (many installers execute the whole file verbatim).

