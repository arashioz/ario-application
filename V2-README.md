# آریو v2 — NestJS REST HTTP + Angular

CRUD روی **HTTP REST**. نوتیفیکیشن زنده روی **JSON-RPC WebSocket** (`/ws`).

## اجرا

```bash
# حتماً از همین مسیر — نه Trash
cd backend-nest && npm run start:dev
cd frontend && npm start
```

ورود: `admin` / `admin123` بعد از `npm run seed`

## REST (HTTP)

| دامنه | مسیر |
|--------|------|
| Auth | `POST /api/auth/login` `GET /api/auth/me` `GET /api/auth/users` |
| Dashboard | `GET /api/dashboard` `GET /api/dashboard/summary` `GET /api/dashboard/ledger` |
| Products | `GET/PATCH /api/products` `GET/POST /api/categories` |
| Customers | `GET/POST /api/customers` |
| Sales | `GET/POST /api/sales` `POST /api/sales/:id/approve` |
| Purchases | `GET/POST /api/purchases` |
| Finance | `/api/expenses` `/api/debtors` `/api/checks` `/api/cash` `/api/deposits` |
| Drivers | `/api/drivers/jobs` `/api/drivers/location` |
| Campaigns | `/api/campaigns` |
| Targets | `/api/targets` |
| Platform | `/api/partners` `/api/volume-orders` `/api/wallet` |
| Chat | `POST /api/chat` |
| Notes | `/api/notes` |
| Settings | `/api/settings` |

## Notify RPC (`ws://host/ws`)

```json
{ "jsonrpc": "2.0", "method": "notify.subscribe", "params": { "token": "..." }, "id": 1 }
```

سرور push می‌کند:

```json
{ "jsonrpc": "2.0", "method": "notify.data_changed", "params": { "entity": "sale", "action": "create" } }
```

متدهای RPC: `notify.subscribe`، `notify.ping`، `notify.unsubscribe`  
رویدادها: `notify.data_changed`، `notify.staff.location`، `notify.driver.location`
