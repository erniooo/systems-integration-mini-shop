import { parse } from "csv-parse/sync";
import { readSheet } from "read-excel-file/node";
import { fail } from "./security.js";

const aliases = {
  productId: ["productid", "produktid", "produktnummer"],
  name: ["name", "productname", "produktname"],
  description: [
    "description",
    "productdescription",
    "beschreibung",
    "produktbeschreibung",
  ],
  price: ["price", "preis"],
  stock: ["stock", "bestand", "lagerbestand"],
  currency: ["currency", "currencycode", "wahrung", "wahrungscode"],
};
const labels = {
  productId: "Product ID / productID",
  name: "Product Name / name",
  description: "Beschreibung / description",
  price: "Price / price",
  stock: "Stock / stock",
  currency: "Währung / currency",
};

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function columnsFor(header) {
  if (!Array.isArray(header)) fail(400, "Die Datei enthält keine Kopfzeile.");
  const normalized = header.map(normalizeHeader);
  const result = {};
  for (const [field, possible] of Object.entries(aliases)) {
    const matches = normalized
      .map((name, index) => (possible.includes(name) ? index : -1))
      .filter((i) => i >= 0);
    if (matches.length > 1)
      fail(400, `Die Spalte „${labels[field]}“ ist mehrfach vorhanden.`);
    if (!matches.length && field !== "currency")
      fail(400, `Eine erforderliche Spalte fehlt: ${labels[field]}.`);
    result[field] = matches.length ? matches[0] : -1;
  }
  return result;
}

function requiredText(value, label, row, maxLength) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maxLength
  )
    fail(
      400,
      `Zeile ${row}: ${label} muss zwischen 1 und ${maxLength} Zeichen enthalten.`,
    );
  return value.trim();
}

function cents(value, currency, row) {
  let raw = String(value ?? "").trim();
  const suffix = raw.match(/\s+([A-Za-z]{3})$/);
  if (suffix) raw = raw.slice(0, suffix.index).trim();
  const currencies = [currency, suffix?.[1]].filter(
    (v) => v !== null && v !== undefined && String(v).trim() !== "",
  );
  if (currencies.some((v) => String(v).trim().toUpperCase() !== "EUR"))
    fail(400, `Zeile ${row}: Der Shop unterstützt nur Preise in EUR.`);
  if (!/^\d{1,6}(?:[.,]\d{1,2})?$/.test(raw))
    fail(
      400,
      `Zeile ${row}: Ungültiger Preis. Erwartet wird z. B. 1200.00 EUR.`,
    );
  const [whole, fraction = ""] = raw.replace(",", ".").split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function stockNumber(value, row) {
  const raw = String(value ?? "").trim();
  if (!/^\d{1,9}$/.test(raw))
    fail(
      400,
      `Zeile ${row}: Der Bestand muss eine nichtnegative ganze Zahl sein.`,
    );
  return Number(raw);
}

async function readRows(file) {
  const name = file.originalname.toLowerCase();
  if (name.endsWith(".xlsx")) {
    if (file.buffer.length < 4 || file.buffer.readUInt32LE(0) !== 0x04034b50)
      fail(400, "Die Excel-Datei ist ungültig oder beschädigt.");
    try {
      return await readSheet(file.buffer);
    } catch {
      fail(400, "Die Excel-Datei konnte nicht gelesen werden.");
    }
  }
  if (!name.endsWith(".csv"))
    fail(400, "Bitte eine CSV- oder XLSX-Datei auswählen.");
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(
      file.buffer,
    );
    return parse(content, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: false,
      max_record_size: 16384,
    });
  } catch {
    fail(
      400,
      "Die CSV-Datei ist ungültig. Bitte eine UTF-8-CSV-Datei mit korrekten Spalten verwenden.",
    );
  }
}

export async function importProducts(db, file) {
  if (!file || !file.buffer.length) fail(400, "Bitte eine Datei auswählen.");
  const rows = await readRows(file);
  if (rows.length < 2) fail(400, "Die Datei enthält keine Produktdaten.");
  if (rows.length > 10001)
    fail(400, "Die Datei darf höchstens 10.000 Produkte enthalten.");
  const columns = columnsFor(rows[0]);
  const seen = new Set();
  const products = rows.slice(1).map((values, index) => {
    const row = index + 2;
    const id = requiredText(values[columns.productId], "Produkt-ID", row, 50);
    if (seen.has(id))
      fail(400, `Zeile ${row}: Produkt-ID „${id}“ kommt mehrfach vor.`);
    seen.add(id);
    const name = requiredText(values[columns.name], "Produktname", row, 100);
    const rawDescription = values[columns.description];
    if (
      rawDescription !== null &&
      rawDescription !== undefined &&
      typeof rawDescription !== "string"
    )
      fail(400, `Zeile ${row}: Die Beschreibung muss Text sein.`);
    const description = String(rawDescription ?? "").trim();
    if (description.length > 1000)
      fail(400, `Zeile ${row}: Beschreibung ist zu lang.`);
    return {
      id,
      name,
      description,
      price: cents(values[columns.price], values[columns.currency], row),
      stock: stockNumber(values[columns.stock], row),
    };
  });

  let created = 0;
  let updated = 0;
  const importedAt = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const find = db.prepare("SELECT id FROM products WHERE erp_id = ?");
    const insert = db.prepare(
      "INSERT INTO products (erp_id,name,description,price_cents,stock,stock_imported_at) VALUES (?,?,?,?,?,?)",
    );
    const update = db.prepare(
      "UPDATE products SET name=?, description=?, price_cents=?, stock=?, stock_imported_at=?, active=1 WHERE erp_id=?",
    );
    for (const product of products) {
      if (find.get(product.id)) {
        update.run(
          product.name,
          product.description,
          product.price,
          product.stock,
          importedAt,
          product.id,
        );
        updated++;
      } else {
        insert.run(
          product.id,
          product.name,
          product.description,
          product.price,
          product.stock,
          importedAt,
        );
        created++;
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { created, updated, total: products.length, importedAt };
}
