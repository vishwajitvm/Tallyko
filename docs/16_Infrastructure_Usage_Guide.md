# Infrastructure Usage Guide: PostgreSQL and Redis

Tallyko's server keeps its data in two places: **PostgreSQL** (everything permanent) and **Redis** (short-lived, fast-changing data). This guide explains both in plain words, how to look inside them in development, and how they work together in everyday situations.

There is **no file storage** (MinIO/S3 is not used): menu photos are read in memory and thrown away, receipts are printed or rendered on the device, and nothing else needs files.

---

## 1. PostgreSQL (the permanent records)

### What is it?
A relational database: tables of rows and columns with strict rules, so a half-finished change never gets saved (transactions).

### What Tallyko keeps there
Every business's menu, tables, bills, payments, stock movements, customers, staff, settings and audit log, plus platform data (businesses, plans, subscriptions, logins, devices). One shared database holds every business; Row-Level Security makes sure a business's session only sees its own rows ([03](./03_Multi_Vendor_Architecture.md)). Table list: [04_Data_Model.md](./04_Data_Model.md).

### Development connection
| Setting | Value |
|---|---|
| Host / port (from your PC) | `localhost` / `5433` (bound to 127.0.0.1 only) |
| Host / port (inside Docker) | `db` / `5432` |
| Database | `tallyko_shared` (tests use `tallyko_shared_test`) |
| User / password | `postgres` / `password_to_change_in_prod` (dev default; production refuses it) |

### How to look inside
```bash
docker compose exec db psql -U postgres -d tallyko_shared
```
`\dt` lists tables, `SELECT code, status, total_amount FROM orders LIMIT 5;` shows bills, `\q` exits.

With a UI: **DBeaver Community** or **pgAdmin** → new PostgreSQL connection → host `localhost`, port `5433`, database `tallyko_shared`, user and password as above.

As the superuser you see every business's rows. To see what the app sees, switch to its role inside a transaction:
```sql
BEGIN;
SET LOCAL ROLE tallyko_app;
SELECT set_config('app.current_tenant_id', '<tenant uuid>', true);
SELECT count(*) FROM orders;   -- only that business
ROLLBACK;
```

---

## 2. Redis (the fast sticky notes)

### What is it?
An in-memory key/value store. Very fast; Tallyko never keeps anything there that can't be rebuilt, and the API **keeps working if Redis is down** (it falls back to Postgres or skips the check).

### What Tallyko keeps there
| Key pattern | Purpose | Lifetime |
|---|---|---|
| tenant config cache | status, `paid_until`, `session_version`, `db_url` per business | 10 minutes, dropped on change |
| rate-limit windows | login per account, public orders per customer phone, webhooks per business, per-IP ceilings | the window (1–15 min) |
| `session:revoked:{sid}` | devices that were signed out | until their tokens would expire |
| `jobs:subscription_check:{date}` | lock so one worker runs the 01:00 IST check | 6 hours |
| `public-add:{tenant}:{id}` | makes "add to my bill" from a QR page safe to retry | 24 hours |

Tests use Redis database 1, development uses database 0.

### How to look inside
```bash
docker compose exec cache redis-cli
```
`KEYS *` (fine on a dev machine), `TTL <key>`, `exit`. With a UI: **RedisInsight** → add database → the cache is not published to your PC by default, so use `redis-cli` above.

---

## 3. How they work together: everyday examples

### Example 1: someone guesses an owner's password
1. Each `/auth/login` request increments two Redis counters: one for the IP (60/min, high because a whole shop shares one IP) and one for the account (20 per 15 minutes in production).
2. On the 21st try for that account, the API answers **429** without touching Postgres.
3. Staff at other tills logging in to their own accounts are not affected.

### Example 2: a cashier completes a bill
1. The app sends product ids and quantities only.
2. In one Postgres transaction (as `tallyko_app`, tenant set): the server prices the bill, saves the order, lines and payment, assigns the invoice number from `tenant_counters`, writes stock movements to `inventory_logs`, updates loyalty, and queues any customer email in `email_logs`.
3. If any step fails, nothing is saved.

### Example 3: fifty customers scan the table QR at lunch
1. Each phone calls `GET /public/{tenant}/menu?channel=QR`. The per-IP limit is 600/min because they all share the restaurant's Wi-Fi.
2. Menu rows come from Postgres; the business's status comes from the Redis tenant cache.
3. Orders are limited per customer phone, not per IP.

### Example 4: the owner signs out a lost phone
1. The session row in Postgres gets `revoked_at`, and `session:revoked:{sid}` is written to Redis.
2. The lost phone's next request is checked against Redis → **401**, and its refresh token is refused by Postgres.

### Example 5: the daily subscription check at 01:00 IST
1. Each uvicorn worker wakes up; the first to set `jobs:subscription_check:{date}` in Redis does the work.
2. It finds businesses whose `paid_until` + grace has passed in Postgres, signs out every device (sessions revoked, `session_version` bumped, Redis cache dropped) and writes the platform audit log.

### Example 6: a customer email
1. Completing a bill writes an `email_logs` row with status `queued` (or `skipped` when SMTP isn't configured).
2. The email worker in the API picks it up within 5 s (`FOR UPDATE SKIP LOCKED`), sends it over SMTP (Mailpit in dev) and marks it `sent`.
No Redis queue or worker container is involved.
