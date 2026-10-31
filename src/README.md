# ShopHub — Prototype (SE 403, Topic 2)

A **runnable architectural skeleton**, not a production marketplace.
It proves two quality attributes with real, measured behaviour:

1. **Consistency — overselling = 0 in a flash sale** (Redis atomic
   DECR gate + Postgres conditional decrement, both guards).
2. **Reliability / modifiability — Saga compensation + adapters**
   (payment failure restores inventory; payment/shipping providers
   are swappable adapter objects, not hard-coded branches).

## Prerequisites

- Docker + Docker Compose
- Node 20+ (only needed to run `tests/load_test.js` outside Docker)

## Run

```bash
cd src
docker compose up --build
```

- API: http://localhost:3000 — check `GET /health`
- Web demo: http://localhost:8080
- First, seed the catalogue: `POST /seed` (or the Seed button on the web page)

## Demo 1 — Flash sale, overselling = 0

### Option A: Using Node.js test script
```bash
node tests/load_test.js
# or: node tests/load_test.js http://localhost:3000
```

The script fires 1,000 concurrent buyers at the flash product
(stock 100) and prints, from the actual run: attempted orders,
successful orders, 409 rejections, final Postgres stock, oversold
count (must be 0), p95 latency and throughput. No numbers in this
README are results — the script's output is the result.

### Option B: Using k6 load test script (M4 addition)
```bash
k6 run tests/load_test_k6.js
# or with custom base: k6 run -e BASE_URL=http://localhost:3000 tests/load_test_k6.js
```
The k6 script distributes 1,000 order attempts across 50 virtual users (VUs), asserts that confirmed orders $\le 100$ and $p95 < 2000$ ms, and prints a final consolidated summary table of the flash sale stock state.

Why overselling cannot happen, by design:

- Redis `DECRBY` is atomic. If it would go below 0, the script
  restores it and the order is rejected with 409.
- Postgres then decrements only `WHERE stock >= quantity` inside
  the same transaction as the order + outbox insert. If that fails,
  the Redis gate is restored too.

## Demo 2 — Payment failure + Saga compensation

The same load-test script, Scenario 2, sets the mock payment
failure rate to 30% via `POST /admin/config`, places 100 orders,
then checks `final stock == initial stock - confirmed orders`.
Cancelled (`PAYMENT_FAILED`) orders must have their inventory
restored in Postgres **and** in Redis (flash sale). The script
prints YES/NO for this check.

You can also try it by hand: set the failure rate in
`/admin/config`, place an order on the web page, watch it fail
with 402, then check the product stock is unchanged.

## Demo 3 — Recommendation / review failure isolation

Scenario 3 in `tests/load_test.js` automated test verifies:
- `GET /recommendations?fail=1` returns an empty list with
  `fallback: true` (HTTP 200) instead of an error, because the order flow
  never calls the recommendation service synchronously.
- `GET /demo/failing-service` deliberately returns 503 for that
  downstream service alone. While it "fails", `GET /health` and
  `POST /orders` must still work.
- The script places an order while downstream is failing, proving
  that the core order placement is 100% isolated and unaffected.

## Design v2 Additions (Post-ATAM M3)

1. **Stuck Saga Recovery Worker (ADR-011):** An in-process background worker
   periodically checks for orders stuck in `PENDING` with step `RESERVED`
   for more than 60 seconds (simulating an API crash before payment response).
   It automatically executes idempotent compensation to release stock.
2. **Flash Stock Resync Endpoint (ADR-012):** `POST /admin/sync-flash-stock`
   re-reads the ground-truth stock from PostgreSQL and resynchronizes the
   Redis in-memory counter, allowing instantaneous recovery after a Redis restart.

## Adding a new provider (modifiability demo)

- Payment: add one object to `PROVIDERS` in
  `api/modules/payment.js` (same `charge(amount)` interface).
- Shipping: add one object to `CARRIERS` in
  `api/modules/shipping.js` (same `createShipment(order)` interface).
- No change to `server.js` ordering/Saga code is required.
  The demo ships with 2 mock payment providers (VNPay, MoMo)
  and 2 mock shipping carriers (GHN, GHTK).

## Outbox — honest scope

The outbox table is written in the **same Postgres transaction**
as the order/inventory change, so there is no dual-write loss.
An in-process relay marks rows published every 2 seconds.
**There is no real RabbitMQ/Kafka in this compose file** — the
docs half must not claim otherwise. Wiring a real broker would
mean adding it to compose and making the relay publish to it
instead of logging.

## What is mocked

- VNPay / MoMo payments (mock adapters, configurable failure rate)
- GHN / GHTK shipping (mock tracking codes)
- Real sellers, seller payout / reconciliation
- Recommendation: a simple history-based placeholder, not an ML model

## What is NOT built

- Auth / JWT (the `/admin/config` endpoint is demo-only and
  unauthenticated on purpose — do not expose it publicly)
- Real money, real payment-gateway callbacks
- Full seller payout, multi-instance autoscaling, Elasticsearch
  (search here is Postgres `tsvector` + ILIKE fallback, cached
  in Redis for 30 seconds)

## Load-test environment — read this before quoting numbers

Results from this compose setup on a laptop prove the **design**
(no overselling, compensation works, latency is measured), but
they do **not** prove 5,000 req/s in production. The report must
state the machine, the compose setup and the measured numbers
together, and must not extrapolate to production traffic.
