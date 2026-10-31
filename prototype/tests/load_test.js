/**
 * ShopHub load test — prints ONLY what it measures when run.
 * Requires the API running (docker compose up) and Node 20+ (global fetch).
 *
 * Scenario 1: 1000 concurrent buyers, 100 flash-sale items -> overselling must be 0.
 * Scenario 2: payment failure rate 30% -> cancelled orders must restore inventory.
 *
 * Usage: node tests/load_test.js [apiBase]
 *   apiBase defaults to http://localhost:3000
 */
const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");

async function j(method, path, body, headers = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}
function p95(values) {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(0.95 * (s.length - 1))] : 0;
}

async function main() {
  const health = await j("GET", "/health");
  if (health.status !== 200) throw new Error(`API not healthy at ${BASE}: ${JSON.stringify(health.data)}`);

  // ---------- Scenario 1: flash sale ----------
  console.log("=== Scenario 1: 1000 buyers, 100 flash items ===");
  await j("POST", "/admin/config", { paymentFailureRate: 0 });
  await j("POST", "/seed");
  const list = await j("GET", "/products?flash=true");
  const flash = list.data.products[0];
  if (!flash) throw new Error("No flash product found after seed");
  console.log(`Flash product: id=${flash.id} "${flash.name}" initial stock=${flash.stock}`);

  const start = Date.now();
  const latencies = [];
  const results = await Promise.all(Array.from({ length: 1000 }, async (_, i) => {
    const t0 = Date.now();
    const r = await j("POST", "/orders", { productId: flash.id, quantity: 1, paymentProvider: "vnpay", shippingProvider: "ghn" }, { "X-Idempotency-Key": `loadtest-1-${i}` });
    latencies.push(Date.now() - t0);
    return r;
  }));
  const durationSec = (Date.now() - start) / 1000;
  const confirmed = results.filter((r) => r.status === 201 || r.data.status === "CONFIRMED").length;
  const outOfStock = results.filter((r) => r.status === 409).length;
  const other = results.filter((r) => r.status !== 201 && r.status !== 409).length;
  const after = await j("GET", `/products/${flash.id}`);
  const finalStock = Number(after.data.stock);
  const oversold = Math.max(0, confirmed - Number(flash.stock));
  console.log(`Attempted orders: ${results.length}`);
  console.log(`Successful (CONFIRMED): ${confirmed}`);
  console.log(`Rejected OUT_OF_STOCK (409): ${outOfStock}`);
  console.log(`Other responses: ${other}`);
  console.log(`Final stock in Postgres: ${finalStock} (expected ${Number(flash.stock) - confirmed})`);
  console.log(`Oversold count: ${oversold} (must be 0)`);
  console.log(`p95 order latency: ${p95(latencies)} ms`);
  console.log(`Throughput: ${(results.length / durationSec).toFixed(1)} orders/s over ${durationSec.toFixed(1)} s`);

  // ---------- Scenario 2: payment failure + compensation ----------
  console.log("\n=== Scenario 2: payment failure rate 30%, inventory must be restored ===");
  await j("POST", "/seed");
  await j("POST", "/admin/config", { paymentFailureRate: 0.3 });
  const list2 = await j("GET", "/products?flash=true");
  const flash2 = list2.data.products[0];
  const initial = Number(flash2.stock);
  const results2 = await Promise.all(Array.from({ length: 100 }, async (_, i) => {
    return j("POST", "/orders", { productId: flash2.id, quantity: 1, paymentProvider: "momo", shippingProvider: "ghtk" }, { "X-Idempotency-Key": `loadtest-2-${i}` });
  }));
  const confirmed2 = results2.filter((r) => r.data && r.data.status === "CONFIRMED").length;
  const failed2 = results2.filter((r) => r.data && r.data.status === "PAYMENT_FAILED").length;
  await j("POST", "/admin/config", { paymentFailureRate: 0 });
  const after2 = await j("GET", `/products/${flash2.id}`);
  const final2 = Number(after2.data.stock);
  const expected2 = initial - confirmed2;
  console.log(`Attempted: ${results2.length}, CONFIRMED: ${confirmed2}, PAYMENT_FAILED: ${failed2}`);
  console.log(`Initial stock: ${initial}, final stock: ${final2}, expected (initial - confirmed): ${expected2}`);
  console.log(`Inventory restored correctly: ${final2 === expected2 ? "YES" : "NO — compensation failed, investigate Saga"}`);

  // ---------- Scenario 3: Recommendation service failure isolation (ASR4 / QA3) ----------
  console.log("\n=== Scenario 3: Recommendation / Review failure isolation (ASR4 / QA3) ===");
  // 1. Call failing recommendation endpoint: should return fallback, NOT 500
  const recFail = await j("GET", "/recommendations?fail=1");
  const recOk = recFail.status === 200 && recFail.data && recFail.data.fallback === true;
  console.log(`Failing recommendation endpoint (/recommendations?fail=1): HTTP ${recFail.status}, fallback=${recFail.data?.fallback}`);

  // 2. Call failing downstream service: returns 503
  const downFail = await j("GET", "/demo/failing-service");
  console.log(`Downstream demo failure endpoint (/demo/failing-service): HTTP ${downFail.status}`);

  // 3. Verify core ordering flow is completely unaffected
  const orderDuringDownstreamFailure = await j(
    "POST",
    "/orders",
    { productId: 2, quantity: 1, paymentProvider: "vnpay", shippingProvider: "ghn" },
    { "X-Idempotency-Key": `loadtest-3-${Date.now()}` }
  );
  const orderSuccess = orderDuringDownstreamFailure.status === 201 && orderDuringDownstreamFailure.data?.status === "CONFIRMED";
  console.log(`Core order placement during downstream failure: HTTP ${orderDuringDownstreamFailure.status}, status=${orderDuringDownstreamFailure.data?.status}`);
  console.log(
    `Downstream failure isolated, core ordering works: ${recOk && orderSuccess ? "YES (100% isolated)" : "NO — ordering was affected"}`
  );
}

main().catch((e) => { console.error("Load test failed:", e.message); process.exit(1); });
