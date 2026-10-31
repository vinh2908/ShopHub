const $ = (id) => document.getElementById(id);
const base = () => $("apiBase").value.replace(/\/$/, "");

async function seed() {
  const r = await fetch(base() + "/seed", { method: "POST" });
  alert("Seeded: " + (await r.json()).seeded + " products");
  loadProducts();
}
async function loadProducts() {
  const r = await fetch(base() + "/products");
  const data = await r.json();
  $("products").innerHTML = data.products.map((p) =>
    `<div class="card"><b>${p.id}. ${p.name}</b> — ${Number(p.price).toLocaleString()} VND — ton kho: ${p.stock} ${p.is_flash ? "(FLASH SALE)" : ""}<br>${p.description}</div>`
  ).join("");
}
async function placeOrder() {
  const body = {
    productId: Number($("productId").value),
    quantity: Number($("qty").value),
    paymentProvider: $("pay").value,
    shippingProvider: $("ship").value,
  };
  const key = "web-" + Date.now() + "-" + Math.floor(Math.random() * 1e9);
  const r = await fetch(base() + "/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Idempotency-Key": key },
    body: JSON.stringify(body),
  });
  $("orderResult").textContent = r.status + " " + JSON.stringify(await r.json(), null, 2);
}
async function lookupOrder() {
  const r = await fetch(base() + "/orders/" + $("orderId").value);
  $("lookupResult").textContent = r.status + " " + JSON.stringify(await r.json(), null, 2);
}
async function loadRecs(fail) {
  const r = await fetch(base() + "/recommendations?fail=" + (fail ? "1" : "0"));
  const data = await r.json();
  $("recs").textContent = data.fallback
    ? "Dich vu goi y loi, nhung trang van hien thi binh thuong (fallback rong) — luong dat hang khong bi anh huong."
    : JSON.stringify(data, null, 2);
}
loadProducts();
