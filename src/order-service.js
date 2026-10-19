import { fail } from "./security.js";

// Später kann hier ein ERP- oder Messaging-Adapter eingesetzt werden.
// Die Oberfläche bleibt dabei unverändert.
export class LocalOrderService {
  constructor(db) {
    this.db = db;
  }

  placeOrder(customer, items) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
      fail(400, "Der Warenkorb muss 1 bis 100 Positionen enthalten.");
    }
    const seen = new Set();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const positions = items.map((item) => {
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
