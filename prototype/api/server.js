/**
 * ShopHub — SE 403 architectural skeleton (modular monolith).
 *
 * Modules: catalog (products/search/cache), ordering (Saga orchestrator),
 * inventory (Postgres conditional decrement + Redis flash gate), payment
 * adapters, shipping adapters, outbox. One process, separate modules, so
 * a module can later be split out without rewriting the order flow.
 *
 * Consistency guarantee, in plain terms:
 *  1. Flash sale: Redis DECRBY is an atomic gate. If it goes below 0 the
 *     stock is restored and the order is rejected — no overselling.
 *  2. Postgres is the source of truth: the order + stock decrement +
 *     outbox row are written in ONE transaction, with
 *     `UPDATE ... WHERE stock >= quantity`. If that fails, the Redis
 *     gate is restored. Either guard alone would be enough for a
 *     single instance; together they survive a Redis/Postgres drift.
 *  3. No dual-write: the outbox row is written in the SAME transaction
 *     as the order/inventory change. A background relay then "publishes"
 *     it (here: logs + marks published — there is NO real RabbitMQ/Kafka
 *     in this compose file, and the README says so honestly).
 *  4. Saga compensation: if mock payment fails, inventory is restored
 *     in Postgres AND in Redis (flash sale), and the order is marked
 *     PAYMENT_FAILED. Inventory is never left reserved by a dead order.
 */
const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");
const { getPaymentProvider, setFailureRate, getFailureRate } = require("./modules/payment");
const { getShippingCarrier } = require("./modules/shipping");
const { getRecommendations, getReviews } = require("./modules/recommendations");

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || "postgres://shophub:shophub@localhost:5432/shophub";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const pool = new Pool({ connectionString: DATABASE_URL });
const redis = createClient({ url: REDIS_URL });
redis.on("error", (e) => console.error("[redis]", e.message));

const app = express();
app.use(express.json());
app.use((req, res, next) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Idempotency-Key"); res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); if (req.method === "OPTIONS") return res.sendStatus(204); next(); });

// ---- Simple rate limiter for the order endpoint (demo only) ----
// 5000 requests / minute / IP. High enough that the 1000-buyer load
// test from one machine is not blocked, low enough to show the guard.
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || "unknown";
  const list = (hits.get(key) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(key, list);
  if (list.length > 5000) return res.status(429).json({ error: "RATE_LIMITED" });
  next();
}

// ---- Schema ----
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price NUMERIC NOT NULL,
      stock INT NOT NULL DEFAULT 0,
      is_flash BOOLEAN NOT NULL DEFAULT FALSE,
      search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,''))
      ) STORED
    );
    CREATE INDEX IF NOT EXISTS idx_products_search ON products USING GIN (search_vector);
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      idempotency_key TEXT UNIQUE,
      product_id INT NOT NULL REFERENCES products(id),
      quantity INT NOT NULL,
      amount NUMERIC NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      saga_step TEXT NOT NULL DEFAULT 'CREATED',
      payment_provider TEXT,
      shipping_provider TEXT,
      tracking_code TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id SERIAL PRIMARY KEY,
      aggregate_id INT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      published BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

// ---- Seed (idempotent: wipes and recreates the demo catalogue) ----
const SEED_PRODUCTS = [
  { name: "Banh trang cuon thit heo - Flash Sale", description: "Dac san Da Nang, flash sale gioi han", price: 50000, stock: 100, is_flash: true },
  { name: "Muc rim me Da Nang", description: "Muc rim me cay ngot, dac san mien Trung", price: 120000, stock: 500, is_flash: false },
  { name: "Cha bo Da Nang", description: "Cha bo truyen thong, dong goi hut chan khong", price: 180000, stock: 300, is_flash: false },
  { name: "Nuoc mam ca com Phan Thiet", description: "Nuoc mam truyen thong 40 do dam", price: 95000, stock: 400, is_flash: false },
  { name: "Ca phe Dak Lak rang xay", description: "Ca phe robusta rang vua, thom dam", price: 150000, stock: 250, is_flash: false },
  { name: "Tra atiso Da Lat", description: "Tra atiso thanh mat, tui loc tien loi", price: 80000, stock: 350, is_flash: false },
  { name: "Banh dau xanh Hai Duong", description: "Banh dau xanh mem min, it ngot", price: 60000, stock: 200, is_flash: false },
  { name: "Nem chua Thanh Hoa", description: "Nem chua len men tu nhien", price: 70000, stock: 200, is_flash: false },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE orders, outbox, products RESTART IDENTITY CASCADE");
    for (const p of SEED_PRODUCTS) {
      const r = await client.query(
        "INSERT INTO products (name, description, price, stock, is_flash) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [p.name, p.description, p.price, p.stock, p.is_flash]
      );
      // Flash gate in Redis mirrors Postgres stock.
      if (p.is_flash) await redis.set(`flash:stock:${r.rows[0].id}`, String(p.stock));
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  return (await pool.query("SELECT * FROM products ORDER BY id")).rows;
}

async function syncFlashStockFromDb() {
  const { rows } = await pool.query("SELECT id, stock FROM products WHERE is_flash");
  for (const p of rows) {
    const key = `flash:stock:${p.id}`;
    if ((await redis.exists(key)) === 0) await redis.set(key, String(p.stock));
  }
}

// ---- Outbox relay (in-process; NOT a real broker — see README) ----
setInterval(async () => {
  try {
    const { rows } = await pool.query("SELECT * FROM outbox WHERE published = FALSE ORDER BY id LIMIT 50");
    for (const row of rows) {
      console.log("[outbox-relay]", row.event_type, "order", row.aggregate_id);
      await pool.query("UPDATE outbox SET published = TRUE WHERE id = $1", [row.id]);
    }
  } catch (e) { console.error("[outbox-relay]", e.message); }
}, 2000);

// ---- Design v2 (ADR-011): Stuck Saga Recovery Worker ----
// Periodically scans for orders stuck in PENDING / RESERVED for > 60s
// (e.g. if an API node crashed midway during payment processing)
// and compensates them idempotently so inventory is never leaked.
setInterval(async () => {
  try {
    const { rows } = await pool.query(
      "SELECT id, product_id, quantity FROM orders WHERE status = 'PENDING' AND saga_step = 'RESERVED' AND created_at < NOW() - INTERVAL '60 seconds' LIMIT 50"
    );
    for (const order of rows) {
      console.log(`[stuck-saga-recovery] Auto-compensating stuck order ${order.id}`);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE products SET stock = stock + $2 WHERE id = $1", [order.product_id, order.quantity]);
        await client.query(
          "UPDATE orders SET status = 'PAYMENT_FAILED', saga_step = 'AUTO_COMPENSATED' WHERE id = $1 AND status = 'PENDING'",
          [order.id]
        );
        await client.query(
          "INSERT INTO outbox (aggregate_id, event_type, payload) VALUES ($1, 'SagaAutoCompensated', $2)",
          [order.id, JSON.stringify({ orderId: order.id, quantity: order.quantity })]
        );
        await client.query("COMMIT");
        await redis.incrBy(`flash:stock:${order.product_id}`, order.quantity).catch(() => {});
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`[stuck-saga-recovery] Failed to compensate order ${order.id}:`, err.message);
      } finally {
        client.release();
      }
    }
  } catch (e) {
    console.error("[stuck-saga-recovery]", e.message);
  }
}, 10000);

// ---- Routes ----
app.get("/health", async (req, res) => {
  try { await pool.query("SELECT 1"); await redis.ping(); res.json({ ok: true }); }
  catch (e) { res.status(503).json({ ok: false, error: e.message }); }
});

app.post("/seed", async (req, res) => {
  try { const products = await seed(); res.json({ seeded: products.length, products }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Design v2 (ADR-012): Admin Flash Stock Resync ----
// Allows operators to force-sync Redis flash gate counter from PostgreSQL (Single Source of Truth)
// without restarting the service or during disaster recovery.
app.post("/admin/sync-flash-stock", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, stock FROM products WHERE is_flash = TRUE");
    for (const p of rows) {
      await redis.set(`flash:stock:${p.id}`, String(p.stock));
    }
    res.json({ ok: true, synced: rows.length, products: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/admin/config", (req, res) => {
  // Demo-only control so the load test can run a 30% payment-failure
  // scenario without restarting the API. Not an admin/auth endpoint
  // in a real system (no JWT here — see README "not built").
  const rate = setFailureRate(req.body.paymentFailureRate);
  res.json({ paymentFailureRate: rate });
});
app.get("/admin/config", (req, res) => res.json({ paymentFailureRate: getFailureRate() }));

app.get("/products", async (req, res) => {
  const q = (req.query.q || "").trim();
  const flashOnly = req.query.flash === "true";
  const cacheKey = `products:list:${q}:${flashOnly}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json({ cached: true, products: JSON.parse(cached) });
  } catch { /* cache is best-effort; fall through to Postgres */ }
  let sql = "SELECT * FROM products WHERE 1=1";
  const params = [];
  if (q) { params.push(q); sql += ` AND (search_vector @@ plainto_tsquery('simple', $${params.length}) OR name ILIKE '%' || $${params.length} || '%' OR description ILIKE '%' || $${params.length} || '%')`; }
  if (flashOnly) sql += " AND is_flash = TRUE";
  sql += " ORDER BY id";
  const { rows } = await pool.query(sql, params);
  try { await redis.set(cacheKey, JSON.stringify(rows), { EX: 30 }); } catch { /* ignore */ }
  res.json({ cached: false, products: rows });
});

app.get("/products/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });
  res.json(rows[0]);
});

app.get("/products/:id/reviews", (req, res) => {
  try { res.json({ reviews: getReviews(req.params.id, { fail: req.query.fail === "1" }) }); }
  catch { res.json({ reviews: [], fallback: true }); } // failure isolated, never blocks ordering
});

app.get("/recommendations", (req, res) => {
  getRecommendations(req.query.productId, { fail: req.query.fail === "1" })
    .then((items) => res.json({ recommendations: items }))
    .catch(() => res.json({ recommendations: [], fallback: true })); // failure isolated
});

// Intentionally failing downstream service, for the isolation demo only.
// It returns 503 for itself; /health and /orders must still work.
app.get("/demo/failing-service", (req, res) => res.status(503).json({ error: "RECOMMENDATION_SERVICE_DOWN" }));

app.get("/orders/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM orders WHERE id = $1", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "ORDER_NOT_FOUND" });
  res.json(rows[0]);
});

// ---- Saga orchestrator: Reserve -> Charge -> Confirm, compensate on failure ----
app.post("/orders", rateLimit, async (req, res) => {
  const { productId, quantity = 1, paymentProvider = "vnpay", shippingProvider = "ghn" } = req.body || {};
  const idempotencyKey = req.headers["x-idempotency-key"] || req.body?.idempotencyKey || null;
  const qty = parseInt(quantity, 10);
  if (!productId || !Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "INVALID_REQUEST" });

  // Idempotency: replaying the same key returns the original order.
  if (idempotencyKey) {
    const { rows } = await pool.query("SELECT * FROM orders WHERE idempotency_key = $1", [idempotencyKey]);
    if (rows.length) return res.json(rows[0]);
  }

  let product;
  try { ({ rows: [product] } = await pool.query("SELECT * FROM products WHERE id = $1", [productId])); } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!product) return res.status(404).json({ error: "PRODUCT_NOT_FOUND" });

  // Step 0 — flash gate (atomic). Non-flash orders skip Redis here.
  let flashGateTaken = false;
  if (product.is_flash) {
    const remaining = await redis.decrBy(`flash:stock:${product.id}`, qty);
    if (remaining < 0) { await redis.incrBy(`flash:stock:${product.id}`, qty); return res.status(409).json({ error: "OUT_OF_STOCK" }); }
    flashGateTaken = true;
  }

  // Step 1 — ReserveInventory + order + outbox, ONE transaction.
  const client = await pool.connect();
  let order;
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      "UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2 RETURNING *",
      [product.id, qty]
    );
    if (!upd.rows.length) { await client.query("ROLLBACK"); if (flashGateTaken) await redis.incrBy(`flash:stock:${product.id}`, qty); return res.status(409).json({ error: "OUT_OF_STOCK" }); }
    const amount = Number(product.price) * qty;
    const ins = await client.query(
      "INSERT INTO orders (idempotency_key, product_id, quantity, amount, status, saga_step, payment_provider, shipping_provider) VALUES ($1,$2,$3,$4,'PENDING','RESERVED',$5,$6) RETURNING *",
      [idempotencyKey, product.id, qty, amount, paymentProvider, shippingProvider]
    );
    order = ins.rows[0];
    await client.query("INSERT INTO outbox (aggregate_id, event_type, payload) VALUES ($1,'OrderCreated',$2)", [order.id, JSON.stringify(order)]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (flashGateTaken) await redis.incrBy(`flash:stock:${product.id}`, qty).catch(() => {});
    // A concurrent insert with the same idempotency key: return the winner.
    if (idempotencyKey && String(e.code) === "23505") {
      const { rows } = await pool.query("SELECT * FROM orders WHERE idempotency_key = $1", [idempotencyKey]);
      if (rows.length) return res.json(rows[0]);
    }
    return res.status(500).json({ error: e.message });
  } finally { client.release(); }

  // Invalidate cached product lists (stock changed).
  try { const keys = await redis.keys("products:list:*"); if (keys.length) await redis.del(keys); } catch { /* ignore */ }

  // Step 2 — ChargePayment (mock, configurable failure rate).
  const payment = await getPaymentProvider(paymentProvider).charge(Number(order.amount));
  if (!payment.ok) {
    // Compensation: release inventory in Postgres AND in Redis.
    const c2 = await pool.connect();
    try {
      await c2.query("BEGIN");
      await c2.query("UPDATE products SET stock = stock + $2 WHERE id = $1", [product.id, qty]);
      await c2.query("UPDATE orders SET status='PAYMENT_FAILED', saga_step='COMPENSATED' WHERE id=$1", [order.id]);
      await c2.query("INSERT INTO outbox (aggregate_id, event_type, payload) VALUES ($1,'PaymentFailed',$2)", [order.id, JSON.stringify({ orderId: order.id, error: payment.error })]);
      await c2.query("INSERT INTO outbox (aggregate_id, event_type, payload) VALUES ($1,'InventoryReleased',$2)", [order.id, JSON.stringify({ orderId: order.id, quantity: qty })]);
      await c2.query("COMMIT");
    } catch (e) { await c2.query("ROLLBACK").catch(() => {}); console.error("[compensation]", e.message); }
    finally { c2.release(); }
    if (flashGateTaken) await redis.incrBy(`flash:stock:${product.id}`, qty).catch(() => {});
    const { rows } = await pool.query("SELECT * FROM orders WHERE id = $1", [order.id]);
    return res.status(402).json(rows[0] || order);
  }

  // Step 3 — Confirm + mock shipping.
  const shipment = await getShippingCarrier(shippingProvider).createShipment(order);
  const c3 = await pool.connect();
  try {
    await c3.query("BEGIN");
    await c3.query("UPDATE orders SET status='CONFIRMED', saga_step='CONFIRMED', tracking_code=$2 WHERE id=$1", [order.id, shipment.trackingCode]);
    await c3.query("INSERT INTO outbox (aggregate_id, event_type, payload) VALUES ($1,'OrderConfirmed',$2)", [order.id, JSON.stringify({ orderId: order.id, trackingCode: shipment.trackingCode })]);
    await c3.query("COMMIT");
  } catch (e) { await c3.query("ROLLBACK").catch(() => {}); return res.status(500).json({ error: e.message }); }
  finally { c3.release(); }
  const { rows } = await pool.query("SELECT * FROM orders WHERE id = $1", [order.id]);
  res.status(201).json(rows[0]);
});

// ---- Startup with retries (compose may start api before DB is ready) ----
async function start() {
  for (let i = 0; i < 30; i++) {
    try { await redis.connect(); await pool.query("SELECT 1"); break; }
    catch (e) { console.log(`[startup] waiting for infra (${i + 1}/30): ${e.message}`); await new Promise((r) => setTimeout(r, 2000)); }
  }
  await initDb();
  await syncFlashStockFromDb();
  app.listen(PORT, () => console.log(`ShopHub API listening on ${PORT}`));
}
start().catch((e) => { console.error("Fatal startup error:", e); process.exit(1); });
