import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";

const password = "Test-Verwaltung-2026";
const csvFixture = await readFile(
  new URL("./fixtures/erp-products.csv", import.meta.url),
);
const xlsxFixture = await readFile(
  new URL("./fixtures/erp-products.xlsx", import.meta.url),
);

function client(base) {
  let cookie = "";
  let token = "";
  return {
    async request(path, { method = "GET", body, csrf = true } = {}) {
      const isForm = body instanceof FormData;
      const headers = {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-CSRF-Token": token } : {}),
      };
      if (!isForm) headers["Content-Type"] = "application/json";
      const response = await fetch(base + "/api" + path, {
        method,
        headers,
        ...(body === undefined
          ? {}
          : { body: isForm ? body : JSON.stringify(body) }),
      });
      if (response.headers.has("set-cookie"))
        cookie = response.headers.get("set-cookie").split(";")[0];
      const data = await response.json();
      if (data.csrfToken) token = data.csrfToken;
      return { status: response.status, data };
    },
    upload(file, name = "produkte.csv", csrf = true) {
      const body = new FormData();
      body.append("file", new Blob([file]), name);
      return this.request("/admin/import/products", {
        method: "POST",
        body,
        csrf,
      });
    },
  };
}

test("ERP-Dateiimport: Originalexporte, Abgleich, Fehler und Berechtigungen", async (t) => {
  const runtime = await createApp({
    dbPath: ":memory:",
    sessionSecret: "test-secret-for-isolated-import-tests",
    adminPassword: password,
  });
  const server = runtime.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    runtime.db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const admin = client(base);
  const customer = client(base);
  await admin.request("/session");
  await customer.request("/session");
  assert.equal(
    (
      await admin.request("/login", {
        method: "POST",
        body: { email: "admin@minishop.local", password },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await customer.request("/register", {
        method: "POST",
        body: {
          name: "Ada",
          email: "ada@example.test",
          address: "Campus 1",
          password: "Passwort2026!",
        },
      })
    ).status,
    201,
  );

  await t.test(
    "Nur Verwaltung mit gültigem CSRF-Token darf importieren",
    async () => {
      assert.equal((await customer.upload(csvFixture)).status, 403);
      assert.equal(
        (await admin.upload(csvFixture, "produkte.csv", false)).status,
        403,
      );
      assert.equal((await admin.request("/products")).data.length, 6);
    },
  );

  let id;
  await t.test(
    "Echter SAP-Oberflächenexport wird importiert, auch mit leeren Beschreibungen",
    async () => {
      const result = await admin.upload(xlsxFixture, "Products.xlsx");
      assert.equal(result.status, 200);
      assert.deepEqual([result.data.created, result.data.updated], [2, 0]);
      const products = (await admin.request("/products")).data;
      assert.equal(products.length, 8);
      const mtb = products.find((p) => p.erp_id === "DXTR1000");
      id = mtb.id;
      assert.equal(mtb.name, "MTB");
      assert.equal(mtb.description, "");
      assert.equal(mtb.price_cents, 120000);
      assert.equal(mtb.stock, 25);
      assert.ok(mtb.stock_imported_at);
      assert.equal(products.find((p) => p.erp_id === "GRVL1000").stock, 15);
      assert.equal(products.find((p) => p.name === "Notizbuch A5").stock, null);
    },
  );

  await t.test(
    "Echter CSV-Export aktualisiert vorhandene Produkte ohne Duplikate",
    async () => {
      const result = await admin.upload(csvFixture);
      assert.equal(result.status, 200);
      assert.deepEqual([result.data.created, result.data.updated], [0, 2]);
      const products = (await admin.request("/products")).data;
      assert.equal(products.length, 8);
      assert.equal(products.find((p) => p.erp_id === "DXTR1000").id, id);
    },
  );

  await t.test(
    "Geänderte Preise und Bestände werden übernommen, andere Produkte bleiben erhalten",
    async () => {
      const csv =
        'productID,name,description,price,stock\nDXTR1000,MTB,"Leicht, robust",1300.99 EUR,0\nHELM1,Helm,,40 EUR,3\n';
      const result = await admin.upload(csv);
      assert.equal(result.status, 200);
      assert.deepEqual([result.data.created, result.data.updated], [1, 1]);
      const products = (await admin.request("/products")).data;
      assert.equal(products.length, 9);
      const mtb = products.find((p) => p.erp_id === "DXTR1000");
      assert.deepEqual(
        [mtb.id, mtb.description, mtb.price_cents, mtb.stock],
        [id, "Leicht, robust", 130099, 0],
      );
      assert.equal(products.find((p) => p.erp_id === "GRVL1000").stock, 15);
      assert.equal(
        (
          await customer.request("/orders", {
            method: "POST",
            body: { items: [{ productId: id, quantity: 1 }] },
          })
        ).status,
        409,
      );
      const helmet = products.find((p) => p.erp_id === "HELM1");
      assert.equal(
        (
          await customer.request("/orders", {
            method: "POST",
            body: { items: [{ productId: helmet.id, quantity: 4 }] },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await customer.request("/orders", {
            method: "POST",
            body: { items: [{ productId: helmet.id, quantity: 2 }] },
          })
        ).status,
        201,
      );
    },
  );

  await t.test("Fehlerhafte Dateien werden vollständig abgelehnt", async () => {
    const csv =
      "productID,name,description,price,stock\nDXTR1000,MTB,,1 EUR,2\nHELM1,Helm,,kaputt,3\n";
    assert.equal((await admin.upload(csv)).status, 400);
    const mtb = (await admin.request("/products")).data.find(
      (p) => p.erp_id === "DXTR1000",
    );
    assert.deepEqual([mtb.price_cents, mtb.stock], [130099, 0]);
    const duplicate =
      "productID,name,description,price,stock\nX,A,,1 EUR,2\nX,B,,2 EUR,3\n";
    assert.equal((await admin.upload(duplicate)).status, 400);
    assert.equal(
      (await admin.upload("productID,name,price\nX,A,5")).status,
      400,
    );
    assert.equal(
      (
        await admin.upload(
          "productID,name,description,price,stock\nX,A,,5 USD,1",
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await admin.upload(
          "productID,name,description,price,stock\nX,A,,5 EUR,-1",
        )
      ).status,
      400,
    );
    assert.equal(
      (await admin.upload("keine Excel-Datei", "falsch.xlsx")).status,
      400,
    );
    assert.equal((await admin.upload("nichts", "falsch.txt")).status, 400);
    assert.equal(
      (await admin.upload(Buffer.alloc(2 * 1024 * 1024 + 1), "gross.csv"))
        .status,
      413,
    );
    assert.equal((await admin.request("/products")).data.length, 9);
  });
});

test("Bestehende Lab-1-Datenbank wird ohne Datenverlust erweitert", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "minishop-migration-"));
  const path = join(dir, "legacy.sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY, erp_id TEXT UNIQUE, name TEXT NOT NULL,
    description TEXT NOT NULL, price_cents INTEGER NOT NULL, category TEXT NOT NULL DEFAULT 'Sonstiges', active INTEGER NOT NULL DEFAULT 1);
    INSERT INTO products (name,description,price_cents) VALUES ('Altes Produkt','bleibt',1234);`);
  legacy.close();
  const runtime = await createApp({
    dbPath: path,
    sessionSecret: "test-secret-for-migration",
    adminPassword: password,
  });
  t.after(async () => {
    runtime.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const product = runtime.db
    .prepare(
      "SELECT name,price_cents,stock,stock_imported_at FROM products WHERE name = ?",
    )
    .get("Altes Produkt");
  assert.equal(product.price_cents, 1234);
  assert.equal(product.stock, null);
  assert.equal(product.stock_imported_at, null);
});
