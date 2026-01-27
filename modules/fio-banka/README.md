# FIO Banka module

Store Fio API tokens in DB (per org) and sync transactions into Postgres.

Backend:
- `GET /api/fio-banka/__ping`
- `GET /api/fio-banka/accounts`
- `POST /api/fio-banka/accounts/test`
- `POST /api/fio-banka/accounts`
- `PATCH /api/fio-banka/accounts/:id`
- `DELETE /api/fio-banka/accounts/:id`
- `GET /api/fio-banka/transactions`
- `POST /api/fio-banka/sync`

DB:
- `public.mod_fio_banka_accounts` (scoped by `org_id`)
- `public.mod_fio_banka_transactions` (scoped by `org_id`)

