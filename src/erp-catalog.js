function priceCents(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value);
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function refreshErpCatalog(db, products) {
  const byId = new Map();
  for (const product of products) {
    const id = product?.productID;
    if (typeof id !== "string" || !id || id.length > 50 || id !== id.trim())
      continue;
    // Uneindeutige IDs dürfen weder in den Katalog noch in den Checkout gelangen.
    byId.set(id, byId.has(id) ? null : product);
  }

  const knownIds = new Set(
    db.prepare("SELECT erp_id FROM products WHERE erp_id IS NOT NULL")
      .all().map((product) => product.erp_id),
  );
  const stock = new Map();
  const newProducts = [];
  for (const [id, product] of byId) {
    if (product?.currency !== "EUR" ||
        !Number.isSafeInteger(product.stock) || product.stock < 0)
      continue;
    stock.set(id, product.stock);
    if (knownIds.has(id)) continue;

    const name = typeof product.name === "string" ? product.name.trim() : "";
    const price = priceCents(product.price);
    if (!name || name.length > 100 || price === null) continue;
    const description = typeof product.description === "string"
      ? product.description.trim().slice(0, 1000) : "";
    newProducts.push([id, name, description, price]);
  }

  if (newProducts.length) {
    const insert = db.prepare(
      `INSERT INTO products (erp_id, name, description, price_cents)
       VALUES (?, ?, ?, ?) ON CONFLICT(erp_id) DO NOTHING`,
    );
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const product of newProducts) insert.run(...product);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return stock;
}
