import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";

const adminPassword = "Test-Verwaltung-2026";

function browser(base) {
  let cookie = "";
  let csrfToken = "";
  return async (path, method = "GET", body, { csrf = true } = {}) => {
    const response = await fetch(
      (typeof base === "function" ? base() : base) + "/api" + path,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          ...(csrf ? { "X-CSRF-Token": csrfToken } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    if (response.headers.has("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    const data = await response.json();
    if (data.csrfToken) csrfToken = data.csrfToken;
    return { status: response.status, data };
  };
}

test("Shop-Abläufe, Berechtigungen und dauerhafte Daten", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "minishop-test-"));
  const dbPath = join(dir, "shop.sqlite");
  let runtime;
  let server;
  let base;
  async function boot() {
    runtime = await createApp({
      dbPath,
      sessionSecret: "test-secret-for-an-isolated-test-environment",
      adminPassword,
    });
    server = runtime.app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    runtime.db.close();
  }
  await boot();
  t.after(async () => {
    await stop();
    await rm(dir, { recursive: true, force: true });
  });
  const customer = browser(() => base);
  const admin = browser(() => base);
  const stranger = browser(() => base);
  let productId;
  let orderId;

  await t.test(
    "Produkte sind öffentlich; Änderungen benötigen CSRF und Verwaltungsrechte",
    async () => {
      const products = await customer("/products");
      assert.equal(products.status, 200);
      assert.equal(products.data.length, 6);
      productId = products.data[0].id;
      assert.equal((await customer("/products", "POST", {})).status, 403);
      await customer("/session");
      assert.equal((await customer("/orders")).status, 401);
      assert.equal((await customer("/products", "POST", {})).status, 403);
      assert.equal((await customer("/register", "POST", null)).status, 400);
    },
  );
  await t.test(
    "Registrierung, Passwortprüfung, Profil und Rollen sind korrekt",
    async () => {
      assert.equal(
        (
          await customer("/register", "POST", {
            name: "Ada",
            email: "ada@example.com",
            address: "Campus 7",
            password: "kurz",
          })
        ).status,
        400,
      );
      const result = await customer("/register", "POST", {
        name: "Ada Lovelace",
        email: "Ada@example.com",
        address: "Campus 7",
        password: "MeinPasswort2026",
        role: "admin",
      });
      assert.equal(result.status, 201);
      assert.equal(result.data.user.role, "customer");
      assert.equal(result.data.user.email, "ada@example.com");
      assert.equal(result.data.user.password_hash, undefined);
      assert.equal((await customer("/admin/orders")).status, 403);
      assert.equal(
        (
          await customer("/profile", "PATCH", {
            name: "Ada",
            email: "ada@example.com",
            address: "Neue Straße 8",
          })
        ).status,
        200,
      );
      assert.equal(
        (await customer("/session")).data.user.address,
        "Neue Straße 8",
      );
      const row = runtime.db
        .prepare(
          "SELECT password_hash FROM customers WHERE email='ada@example.com'",
        )
        .get();
      assert.ok(!row.password_hash.includes("MeinPasswort2026"));
      await stranger("/session");
      assert.equal(
        (
          await stranger("/login", "POST", {
            email: "ada@example.com",
            password: "falsch",
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await stranger("/register", "POST", {
            name: "Kopie",
            email: "ada@example.com",
            address: "X",
            password: "MeinPasswort2026",
          })
        ).status,
        409,
      );
      await admin("/session");
      assert.equal(
        (
          await admin("/login", "POST", {
            email: "admin@minishop.local",
            password: adminPassword,
          })
        ).status,
        200,
      );
    },
  );
  await t.test(
    "Bestellungen verwenden Serverpreise, speichern Positionen und sind privat",
    async () => {
      const result = await customer("/orders", "POST", {
        items: [{ productId, quantity: 2 }],
        total_cents: 1,
      });
      assert.equal(result.status, 201);
      orderId = result.data.id;
      assert.equal(result.data.total_cents, 13980);
      assert.equal(result.data.items[0].unit_price_cents, 6990);
      assert.equal(result.data.shipping_address, "Neue Straße 8");
      assert.equal(result.data.status, "pending");
      await stranger("/register", "POST", {
        name: "Grace",
        email: "grace@example.com",
        address: "Campus 9",
        password: "AnderesPasswort2026",
      });
      assert.deepEqual((await stranger("/orders")).data, []);
      assert.equal(
        (
          await stranger(`/admin/orders/${orderId}`, "PATCH", {
            status: "completed",
          })
        ).status,
        403,
      );
      assert.equal((await customer("/orders")).data.length, 1);
      assert.equal((await admin("/admin/orders")).data.length, 1);
    },
  );
  await t.test(
    "Ungültige Positionen werden ohne Teilbestellung verworfen",
    async () => {
      for (const items of [
        [],
        [{ productId, quantity: -1 }],
        [{ productId, quantity: 1.5 }],
        [{ productId, quantity: 100 }],
        [
          { productId, quantity: 1 },
          { productId, quantity: 2 },
        ],
      ]) {
        assert.equal(
          (await customer("/orders", "POST", { items })).status,
          400,
        );
      }
      assert.equal(
        (
          await customer("/orders", "POST", {
            items: [
              { productId, quantity: 1 },
              { productId: 99999, quantity: 1 },
            ],
          })
        ).status,
        409,
      );
      assert.equal((await customer("/orders")).data.length, 1);
      assert.equal(
        runtime.db.prepare("SELECT count(*) AS n FROM order_items").get().n,
        1,
      );
    },
  );
  await t.test(
    "Produktverwaltung und Statusänderung erhalten historische Bestelldaten",
    async () => {
      const product = {
        name: "Neuer Name",
        description: "Neue Beschreibung",
        price: "79,95",
        category: "Technik",
      };
      assert.equal(
        (
          await admin(`/products/${productId}`, "PATCH", {
            ...product,
            price: "-3",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await admin(`/products/${productId}`, "PATCH", {
            ...product,
            price: "3.999",
          })
        ).status,
        400,
      );
      assert.equal(
        (await admin(`/products/${productId}`, "PATCH", product)).status,
        200,
      );
      assert.equal(
        (await customer("/orders")).data[0].items[0].product_name,
        "Studio Kopfhörer",
      );
      assert.equal((await customer("/orders")).data[0].total_cents, 13980);
      assert.equal(
        (
          await admin(`/admin/orders/${orderId}`, "PATCH", {
            status: "shipped",
          })
        ).status,
        200,
      );
      assert.equal((await customer("/orders")).data[0].status, "shipped");
      const created = await admin("/products", "POST", {
        ...product,
        name: "<script>Test</script>",
      });
      assert.equal(created.status, 201);
      assert.equal(
        (await admin(`/products/${created.data.id}`, "DELETE", {})).status,
        200,
      );
      assert.equal(
        (await admin(`/products/${productId}`, "DELETE", {})).status,
        200,
      );
      assert.ok(
        !(await customer("/products")).data.some((p) => p.id === productId),
      );
      assert.equal(
        (
          await customer("/orders", "POST", {
            items: [{ productId, quantity: 1 }],
          })
        ).status,
        409,
      );
      assert.equal(
        (await customer("/orders")).data[0].items[0].product_name,
        "Studio Kopfhörer",
      );
      await customer("/profile", "PATCH", {
        name: "Ada",
        email: "ada@example.com",
        address: "Andere Adresse 10",
      });
      assert.equal(
        (await customer("/orders")).data[0].shipping_address,
        "Neue Straße 8",
      );
    },
  );
  await t.test(
    "Daten und Sitzungen überleben einen Serverneustart; Logout beendet den Zugriff",
    async () => {
      await stop();
      await boot();
      assert.equal(runtime.adminCreated, false);
      // Derselbe Client verwendet nach dem Neustart sein bisheriges Cookie weiter.
      assert.equal(
        (await customer("/session")).data.user.email,
        "ada@example.com",
      );
      assert.equal((await customer("/orders")).data[0].id, orderId);
      assert.equal(
        runtime.db
          .prepare("SELECT total_cents FROM orders WHERE id=?")
          .get(orderId).total_cents,
        13980,
      );
      assert.equal(
        runtime.db
          .prepare("SELECT active FROM products WHERE id=?")
          .get(productId).active,
        0,
      );
      const client = browser(base);
      await client("/session");
      assert.equal(
        (
          await client("/login", "POST", {
            email: "ada@example.com",
            password: "MeinPasswort2026",
          })
        ).status,
        200,
      );
      assert.equal((await client("/orders")).data[0].status, "shipped");
      assert.equal((await client("/logout", "POST", {})).status, 200);
      assert.equal((await client("/orders")).status, 401);
    },
  );
});
