# PayPal API Module

Manage multiple PayPal REST API accounts (client id/secret) per org and validate credentials.

Backend:
- `GET /api/paypal-api/__ping`
- `GET /api/paypal-api/transactions`
- `POST /api/paypal-api/transactions/sync`
- `GET /api/paypal-api/accounts`
- `POST /api/paypal-api/accounts/test`
- `POST /api/paypal-api/accounts`
- `POST /api/paypal-api/accounts/:id/default`
- `PATCH /api/paypal-api/accounts/:id`
- `DELETE /api/paypal-api/accounts/:id`
- `GET /api/paypal-api/profiles`

DB:
- `public.mod_paypal_api_accounts` (scoped by `org_id`)
- `public.mod_paypal_api_transactions` (scoped by `org_id`)

Sync notes:
- Default incremental overlap is 3 days; override via `overlap_days` in the sync body.
- Extracts `id_cart` from `raw.transaction_info.custom_field` patterns like `Cart ID: 53585`.
