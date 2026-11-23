import { randomUUID } from "node:crypto";
import { fail } from "./security.js";

export class LocalOrderService {
  constructor(db) {
    this.db = db;
  }

  positions(items) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
      fail(400, "Der Warenkorb muss 1 bis 100 Positionen enthalten.");
    }
    const seen = new Set();
    return items.map((item) => {
      if (
        !item ||
        !Number.isSafeInteger(item.productId) ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 99 ||
        seen.has(item.productId)
      ) {
        fail(
          400,
          "Ungültige Warenkorbposition. Erlaubt sind 1 bis 99 Stück je Produkt.",
        );
      }
      seen.add(item.productId);
      const product = this.db
        .prepare("SELECT * FROM products WHERE id = ? AND active = 1")
        .get(item.productId);
      if (!product)
        fail(
          409,
          "Ein Produkt ist nicht mehr verfügbar. Bitte den Warenkorb aktualisieren.",
        );
      return { product, quantity: item.quantity };
    });
  }

  placeOrder(customer, items) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const positions = this.positions(items);
      for (const { product, quantity } of positions) {
        if (product.stock !== null && quantity > product.stock)
          fail(
            409,
            `Für „${product.name}“ reicht der Bestand laut letztem Import nicht aus.`,
          );
      }
      // Preise und Gesamtbetrag werden ausschließlich anhand der Datenbank berechnet.
      const total = positions.reduce(
        (sum, item) => sum + item.product.price_cents * item.quantity,
        0,
      );
      const result = this.db
        .prepare(
          `INSERT INTO orders
        (customer_id, customer_name, customer_email, shipping_address, total_cents) VALUES (?,?,?,?,?)`,
        )
        .run(
          customer.id,
          customer.name,
          customer.email,
          customer.address,
          total,
        );
      const id = Number(result.lastInsertRowid);
      const insert = this.db.prepare(`INSERT INTO order_items
        (order_id, product_id, product_name, unit_price_cents, quantity) VALUES (?,?,?,?,?)`);
      for (const { product, quantity } of positions)
        insert.run(id, product.id, product.name, product.price_cents, quantity);
      this.db.exec("COMMIT");
      return this.getOrder(id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getOrder(id) {
    const order = this.db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    if (!order) fail(404, "Bestellung nicht gefunden.");
    order.items = this.db
      .prepare(
        "SELECT product_id, product_name, unit_price_cents, quantity FROM order_items WHERE order_id = ?",
      )
      .all(id);
    return order;
  }

  listOrders(customerId = null) {
    const ids =
      customerId === null
        ? this.db.prepare("SELECT id FROM orders ORDER BY id DESC").all()
        : this.db
            .prepare(
              "SELECT id FROM orders WHERE customer_id = ? ORDER BY id DESC",
            )
            .all(customerId);
    return ids.map(({ id }) => this.getOrder(id));
  }
}

const erpStatuses = {
  NEW: "pending", PICKED: "picked", SHIPPED: "shipped",
  COMPLETED: "completed", CANCELED: "canceled",
};

function erpReceipt(order, checkout, productNames = new Map()) {
  if (!Number.isSafeInteger(order?.orderID) || !Array.isArray(order.items))
    fail(502, "Das ERP hat keine gültige Bestellbestätigung geliefert.");
  return {
    id: order.orderID,
    source: "erp",
    created_at: order.createdAt,
    status: erpStatuses[order.orderStatus_code] || "pending",
    customer_name: checkout.customer_name,
    customer_email: checkout.customer_email,
    shipping_address: checkout.shipping_address,
    total_cents: Math.round(Number(order.orderAmount) * 100),
    items: order.items.map((item) => ({
      product_name: productNames.get(item.product_ID) || item.product?.name || item.product_ID,
      unit_price_cents: Math.round((Number(item.itemAmount) * 100) / item.quantity),
      quantity: item.quantity,
    })),
  };
}

export class ErpOrderService extends LocalOrderService {
  constructor(db, erp) {
    super(db);
    this.erp = erp;
  }

  async placeOrder(customer, items, requestID) {
    if (typeof requestID !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestID))
      fail(400, "Die Kennung für den Kaufversuch fehlt oder ist ungültig.");
    const id = requestID.toLowerCase();
    const lines = this.positions(items).map(({ product, quantity }) => {
      if (!product.erp_id)
        fail(409, `„${product.name}“ ist keinem ERP-Produkt zugeordnet.`);
      return {
        productID: product.erp_id,
        quantity,
        name: product.name,
        unitPriceCents: product.price_cents,
      };
    });
    const cart = JSON.stringify(lines.map(({ productID, quantity }) => [productID, quantity])
      .sort(([a], [b]) => a.localeCompare(b)));
    this.db.prepare(`INSERT INTO erp_checkouts
      (request_id, customer_id, cart, customer_name, customer_email, shipping_address)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING`,
    ).run(id, customer.id, cart, customer.name, customer.email, customer.address);
    const checkout = this.db.prepare("SELECT * FROM erp_checkouts WHERE request_id=?").get(id);
    if (checkout.customer_id !== customer.id || checkout.cart !== cart)
      fail(409, "Diese Kennung gehört bereits zu einem anderen Kaufversuch.");
    const { erp_buyer_id: buyer } = this.db.prepare(
      "UPDATE customers SET erp_buyer_id=COALESCE(erp_buyer_id, ?) WHERE id=? RETURNING erp_buyer_id",
    ).get(randomUUID(), customer.id);
    const existing = await this.erp.findOrder(id);
    if (existing) {
      if (existing.customer_ID !== buyer)
        fail(409, "Diese Kennung gehört bereits zu einer anderen Bestellung.");
      return erpReceipt(existing, checkout);
    }

    const products = new Map();
    for (const product of await this.erp.products())
      products.set(product.productID, products.has(product.productID) ? null : product);
    const names = new Map();
    let total = 0;
    const positions = lines.map(({ productID, quantity, name, unitPriceCents }) => {
      const product = products.get(productID);
      if (!product?.ID || product.currency !== "EUR" ||
          !Number.isInteger(product.stock) || product.stock < quantity)
        fail(409, `„${name}“ ist im ERP nicht in der gewünschten Menge verfügbar.`);
      const amount = quantity * unitPriceCents;
      if (amount < 1 || amount > 9_999_999_999)
        fail(422, `Der Betrag für „${name}“ liegt außerhalb des ERP-Preisbereichs.`);
      total += amount;
      names.set(product.ID, name);
      return { product_ID: product.ID, quantity, itemAmount: (amount / 100).toFixed(2), currency_code: "EUR" };
    });
    if (total > 9_999_999_999) fail(422, "Der Gesamtbetrag ist für das ERP zu hoch.");

    await this.erp.ensureCustomer({
      ID: buyer, name: checkout.customer_name, email: checkout.customer_email,
      ...(checkout.shipping_address.length <= 100 && { street: checkout.shipping_address }),
    });
    const order = await this.erp.createOrder({
      ID: id, customer_ID: buyer, orderDate: new Date().toISOString().slice(0, 10),
      orderAmount: (total / 100).toFixed(2), currency_code: "EUR", items: positions,
    });
    if (order?.customer_ID !== buyer)
      fail(409, "Diese Kennung gehört bereits zu einer anderen Bestellung.");
    return erpReceipt(order, checkout, names);
  }

  async listOrders(customerId = null) {
    const history = super.listOrders(customerId);
    const query = `SELECT erp_checkouts.*, customers.erp_buyer_id
      FROM erp_checkouts JOIN customers ON customers.id = erp_checkouts.customer_id`;
    const checkouts = customerId === null ? this.db.prepare(query).all()
      : this.db.prepare(`${query} WHERE customer_id=?`).all(customerId);
    if (!checkouts.length) return history;
    const byId = new Map(checkouts.map((checkout) => [checkout.request_id, checkout]));
    const records = await this.erp.listOrders([...byId.keys()]);
    const orders = records.flatMap((order) => {
      const checkout = byId.get(order.ID);
      return checkout && checkout.erp_buyer_id === order.customer_ID ? [erpReceipt(order, checkout)] : [];
    });
    return [...orders, ...history].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
  }
}
