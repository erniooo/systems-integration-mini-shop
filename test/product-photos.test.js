import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import sharp from "sharp";
import { fail } from "../src/security.js";

test("Katalog übernimmt neue ERP-Produkte und zeigt den Live-Bestand", async (t) => {
  let online = true;
  const erpProducts = [
    { productID: "GRVL1000", name: "ERP Gravel", price: "2300.00", currency: "EUR", stock: 3 },
    { productID: "EMPTY", name: "Ausverkauft", price: "10.00", currency: "EUR", stock: 0 },
    { productID: "USD", name: "Dollars", price: "12.00", currency: "USD", stock: 2 },
    { productID: "BADPRICE", name: "Fehlerhafter Preis", price: null, currency: "EUR", stock: 2 },
  ];
  const { app, db } = await createApp({
    dbPath: ":memory:",
    sessionSecret: "test-secret-for-catalog",
    adminPassword: "Verwaltung-Test-Passwort",
    erp: {
      async products() {
        if (!online) fail(503, "ERP ist offline.");
        return erpProducts;
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const insert = db.prepare(
    "INSERT INTO products (erp_id, name, description, price_cents) VALUES (?, ?, '', 100)",
  );
  const { lastInsertRowid: gravel } = insert.run("GRVL1000", "Gravel");
  insert.run("MISSING", "Fehlt im ERP");
  const { lastInsertRowid: removed } = insert.run("HIDDEN", "Ausgeblendet");
  db.prepare("UPDATE products SET active=0 WHERE id=?").run(removed);
  erpProducts.push({ productID: "HIDDEN", name: "Ausgeblendet", price: 500, currency: "EUR", stock: 1 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path) => (await fetch(base + path)).json();
  const catalog = await get("/api/products?view=catalog");
  assert.deepEqual(catalog.map(({ name }) => name), ["Gravel"]);
  assert.equal(catalog[0].price_cents, 100);
  const all = await get("/api/products");
  assert.equal(all.find((p) => p.erp_id === "EMPTY").stock, 0);
  assert.equal(all.find((p) => p.erp_id === "MISSING").stock_source, "missing");
  assert.equal(catalog[0].id, gravel);
  assert.equal(catalog[0].has_photo, 0);
  assert.equal((await fetch(`${base}/api/products/${gravel}/photo`)).status, 404);
  const bmx = { productID: "BMX1002", name: "BMX Bike", description: null, price: "499.90", currency: "EUR", stock: 1 };
  erpProducts.push(bmx);
  const catalogPath = "/api/products?view=catalog";
  const [first, second] = await Promise.all([get(catalogPath), get(catalogPath)]);
  const imported = first.find((product) => product.erp_id === bmx.productID);
  assert.equal(imported.price_cents, 49990);
  assert.equal(imported.description, "");
  assert.equal(imported.stock, 1);
  assert.deepEqual(second, first);
  assert.equal(db.prepare("SELECT count(*) AS count FROM products WHERE erp_id=?").get(bmx.productID).count, 1);
  assert.equal(db.prepare("SELECT stock FROM products WHERE id=?").get(imported.id).stock, null);
  bmx.stock = 0;
  assert.ok(!(await get(catalogPath)).some((product) => product.id === imported.id));
  online = false;
  const offline = await get(catalogPath);
  assert.ok(offline.length > 0 && offline.every((p) =>
    p.stock === null && p.stock_source === "unavailable",
  ));
});

test("Nur Admins können ein geprüftes Foto einem konkreten Produkt zuordnen", async (t) => {
  const { app, db } = await createApp({
    dbPath: ":memory:",
    sessionSecret: "test-secret-for-photos",
    adminPassword: "Verwaltung-Test-Passwort",
    demoLogin: true,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const route = "/products/1/photo";
  const image = await sharp({
    create: { width: 48, height: 32, channels: 3, background: "#3d5a4f" },
  }).png().toBuffer();
  function upload(data = image) {
    const form = new FormData();
    form.append("file", new Blob([data], { type: "image/png" }), "produkt.png");
    return form;
  }
  async function session(role) {
    const response = await fetch(base + "/session");
    const { csrfToken } = await response.json();
    const login = await fetch(base + "/demo-login", {
      method: "POST",
      headers: {
        Cookie: response.headers.get("set-cookie").split(";")[0],
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role }),
    });
    assert.equal(login.status, 200);
    return {
      Cookie: login.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": (await login.json()).csrfToken,
    };
  }

  const customer = await session("customer");
  const admin = await session("admin");
  const post = (headers, body) => fetch(base + route, { method: "POST", headers, body });
  assert.equal((await post(customer, upload())).status, 403);
  assert.equal((await post({ Cookie: admin.Cookie }, upload())).status, 403);
  assert.equal((await post(admin, upload("<svg></svg>"))).status, 400);
  assert.equal((await post(admin, upload())).status, 200);

  const product = (await (await fetch(base + "/products")).json())[0];
  assert.equal(product.has_photo, 1);
  const photo = await fetch(base + route);
  assert.equal(photo.headers.get("content-type"), "image/webp");
  const stored = Buffer.from(await photo.arrayBuffer());
  assert.equal((await sharp(stored).metadata()).width, 48);
  assert.equal((await fetch(base + "/products/2/photo")).status, 404);

  assert.equal((await post(admin, upload(image.subarray(0, 16)))).status, 400);
  assert.deepEqual(Buffer.from(await (await fetch(base + route)).arrayBuffer()), stored);
  const removed = await fetch(base + route, {
    method: "DELETE",
    headers: { ...admin, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(removed.status, 200);
  assert.equal((await fetch(base + route)).status, 404);
});
