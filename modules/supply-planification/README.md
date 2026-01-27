# Supply Planification

MVP:
- Editable inventory table (per item + location).
- Saving inventory creates a new snapshot batch; board uses the latest snapshot per item as “last inventory”.

API:
- `GET /api/supply-planification/__ping`
- `GET /api/supply-planification/settings`
- `PUT /api/supply-planification/settings`
- `GET /api/supply-planification/inventory/items`
- `PUT /api/supply-planification/inventory/items`
- `GET /api/supply-planification/inventory/po-lines`
- `GET /api/supply-planification/inventory/transactions`
- `POST /api/supply-planification/inventory/transactions/entries`
- `POST /api/supply-planification/inventory/transactions/adjustments`
- `GET /api/supply-planification/board`
