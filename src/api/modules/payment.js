// Payment adapters behind one common interface.
// Adding a new provider = adding one object here (or one file) + one
// entry in PROVIDERS. No change to ordering / Saga code is needed.
// These are MOCKS: no real money moves. Failure is simulated so the
// Saga compensation path can be demonstrated.
let failureRate = parseFloat(process.env.PAYMENT_FAILURE_RATE || "0") || 0;

function setFailureRate(rate) {
  failureRate = Math.min(1, Math.max(0, Number(rate) || 0));
  return failureRate;
}
function getFailureRate() { return failureRate; }

async function mockCharge(providerName, amount) {
  // Small latency so the demo is not instant, and so a timeout is visible.
  await new Promise((r) => setTimeout(r, 20));
  if (Math.random() < failureRate) {
    return { ok: false, provider: providerName, error: "MOCK_PAYMENT_DECLINED" };
  }
  return {
    ok: true,
    provider: providerName,
    transactionId: `MOCK-${providerName}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    amount,
  };
}

const PROVIDERS = {
  vnpay: { name: "vnpay", label: "VNPay (mock)", charge: (amount) => mockCharge("vnpay", amount) },
  momo: { name: "momo", label: "MoMo (mock)", charge: (amount) => mockCharge("momo", amount) },
};

function getPaymentProvider(name) {
  return PROVIDERS[name] || PROVIDERS.vnpay;
}

module.exports = { PROVIDERS, getPaymentProvider, setFailureRate, getFailureRate };
