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

export class ErpOrderService extends LocalOrderService {
  constructor(db, erp) {
    super(db);
    this.erp = erp;
  }

  async placeOrder(customer, items, requestID) {
    if (typeof requestID !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestID))
      fail(400, "Die Kennung für den Kaufversuch fehlt oder ist ungültig.");
    const lines = this.positions(items).map(({ product, quantity }) => {
      if (!product.erp_id)
        fail(409, `„${product.name}“ ist keinem ERP-Produkt zugeordnet.`);
      return {
        productID: product.erp_id,
        quantity,
        unitPriceCents: product.price_cents,
      };
    });
    const { erp_buyer_id: buyer } = this.db.prepare(
      "UPDATE customers SET erp_buyer_id=COALESCE(erp_buyer_id, ?) WHERE id=? RETURNING erp_buyer_id",
    ).get(randomUUID(), customer.id);
    return this.erp.placeOrder({
      requestID: requestID.toLowerCase(),
      buyer,
      name: customer.name,
      email: customer.email,
      address: customer.address,
      items: lines,
    });
  }

  async listOrders(customerId = null) {
    const history = super.listOrders(customerId);
    const buyer = customerId === null ? undefined : this.db.prepare(
      "SELECT erp_buyer_id FROM customers WHERE id=?",
    ).get(customerId)?.erp_buyer_id;
    if (customerId !== null && !buyer) return history;
    const orders = await this.erp.listOrders(buyer);
    return [...orders, ...history].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
  }
}
