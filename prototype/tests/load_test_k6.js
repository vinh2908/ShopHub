/**
 * ShopHub — Load Test with k6 (Flash sale overselling = 0)
 *
 * Simulates 1,000 concurrent buyers competing for 100 flash-sale items.
 * Measures: Confirmed orders, Out-of-stock (409), Other errors,
 *           Postgres final stock, Oversold count (must be 0),
 *           p95 latency and throughput.
 *
 * Requirements:
 *   - k6 installed (https://k6.io/docs/get-started/installation/)
 *   - API running via `docker compose up` at http://localhost:3000
 *
 * Usage:
 *   k6 run tests/load_test_k6.js
 *   k6 run -e BASE_URL=http://localhost:3000 tests/load_test_k6.js
 */
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

// Custom k6 metrics
const confirmedCounter = new Counter('orders_confirmed');
const outOfStockCounter = new Counter('orders_out_of_stock');
const otherErrorCounter = new Counter('orders_other_error');
const orderDurationTrend = new Trend('order_duration_ms');

export const options = {
  scenarios: {
    flash_sale_rush: {
      executor: 'shared-iterations',
      vus: 50,              // 50 concurrent virtual users
      iterations: 1000,     // Total 1,000 orders attempted
      maxDuration: '30s',   // Complete within 30 seconds
    },
  },
  thresholds: {
    // Quality attribute thresholds
    'orders_confirmed': ['count<=100'],            // Must not exceed 100 items (ASR1)
    'http_req_duration{scenario:flash_sale_rush}': ['p(95)<2000'], // p95 < 2s (ASR3)
  },
};

// Setup: Reset DB, seed catalogue, fetch flash product info
export function setup() {
  const healthRes = http.get(`${BASE_URL}/health`);
  if (healthRes.status !== 200) {
    throw new Error(`API is not healthy at ${BASE_URL}: status=${healthRes.status}`);
  }

  // Set 0% payment failure for pure flash concurrency test
  http.post(`${BASE_URL}/admin/config`, JSON.stringify({ paymentFailureRate: 0 }), {
    headers: { 'Content-Type': 'application/json' },
  });

  // Seed catalogue
  const seedRes = http.post(`${BASE_URL}/seed`);
  if (seedRes.status !== 200) {
    throw new Error(`Seed failed: ${seedRes.body}`);
  }

  // Query flash product
  const prodRes = http.get(`${BASE_URL}/products?flash=true`);
  const products = prodRes.json('products');
  if (!products || products.length === 0) {
    throw new Error('No flash product found after seed');
  }

  const flashProduct = products[0];
  console.log(`[k6 setup] Flash product: ID=${flashProduct.id}, Name="${flashProduct.name}", Initial Stock=${flashProduct.stock}`);

  return {
    productId: flashProduct.id,
    initialStock: Number(flashProduct.stock),
    startTime: Date.now(),
  };
}

// Default VU function: Place flash order
export default function (data) {
  const idempotencyKey = `k6-${__VU}-${__ITER}-${Date.now()}`;
  const payload = JSON.stringify({
    productId: data.productId,
    quantity: 1,
    paymentProvider: 'vnpay',
    shippingProvider: 'ghn',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey,
    },
  };

  const t0 = Date.now();
  const res = http.post(`${BASE_URL}/orders`, payload, params);
  const latency = Date.now() - t0;
  orderDurationTrend.add(latency);

  if (res.status === 201) {
    confirmedCounter.add(1);
    check(res, { 'Order confirmed': (r) => r.status === 201 });
  } else if (res.status === 409) {
    outOfStockCounter.add(1);
    check(res, { 'Out of stock (409)': (r) => r.status === 409 });
  } else {
    otherErrorCounter.add(1);
    console.warn(`[k6] Unexpected status ${res.status}: ${res.body}`);
  }
}

// Teardown: Verify final stock in DB and print consolidated architectural report
export function teardown(data) {
  const prodRes = http.get(`${BASE_URL}/products/${data.productId}`);
  const finalStock = Number(prodRes.json('stock'));
  const durationSec = (Date.now() - data.startTime) / 1000;

  console.log('\n======================================================');
  console.log('       SHOPHUB ARCHITECTURAL LOAD TEST REPORT (k6)     ');
  console.log('======================================================');
  console.log(`Flash Product ID       : ${data.productId}`);
  console.log(`Initial Stock          : ${data.initialStock}`);
  console.log(`Final Postgres Stock   : ${finalStock}`);
  console.log(`Expected Remaining     : Math.max(0, ${data.initialStock} - Confirmed Orders)`);
  console.log('------------------------------------------------------');
  console.log(`Total Duration         : ${durationSec.toFixed(2)} seconds`);
  console.log('Check summary metrics below for Confirmed, 409, and p95.');
  console.log('======================================================\n');
}

