// Shipping adapters behind one common interface.
// Adding a new carrier = adding one object here + one entry in CARRIERS.
// No change to ordering / Saga code is needed. These are MOCKS.
async function mockShipment(carrierName, order) {
  await new Promise((r) => setTimeout(r, 10));
  return {
    ok: true,
    carrier: carrierName,
    trackingCode: `${carrierName.toUpperCase()}-${order.id}-${Date.now()}`,
    estimatedDays: carrierName === "ghn" ? 2 : 3,
  };
}

const CARRIERS = {
  ghn: { name: "ghn", label: "GHN (mock)", createShipment: (order) => mockShipment("ghn", order) },
  ghtk: { name: "ghtk", label: "GHTK (mock)", createShipment: (order) => mockShipment("ghtk", order) },
};

function getShippingCarrier(name) {
  return CARRIERS[name] || CARRIERS.ghn;
}

module.exports = { CARRIERS, getShippingCarrier };
