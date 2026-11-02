import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import session from "express-session";
import { hashPassword } from "./security.js";

export async function openDatabase(path, adminPassword) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      address TEXT NOT NULL, password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer', 'admin'))
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY, erp_id TEXT UNIQUE, name TEXT NOT NULL,
      description TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
      category TEXT NOT NULL DEFAULT 'Sonstiges', active INTEGER NOT NULL DEFAULT 1,
      stock INTEGER CHECK(stock IS NULL OR stock >= 0), stock_imported_at TEXT
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id),
      customer_name TEXT NOT NULL, customer_email TEXT NOT NULL,
      shipping_address TEXT NOT NULL, total_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','shipped','completed')),
      integration_status TEXT NOT NULL DEFAULT 'local', erp_order_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id), product_name TEXT NOT NULL,
      unit_price_cents INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0)
    );
    CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  // Vorhandene Lab-1-Datenbanken erhalten die neuen Felder, ohne Daten zu löschen.
  const columns = db
    .prepare("PRAGMA table_info(products)")
    .all()
    .map((column) => column.name);
  if (!columns.includes("stock"))
    db.exec(
      "ALTER TABLE products ADD COLUMN stock INTEGER CHECK(stock IS NULL OR stock >= 0)",
    );
  if (!columns.includes("stock_imported_at"))
    db.exec("ALTER TABLE products ADD COLUMN stock_imported_at TEXT");
  if (!db.prepare("SELECT 1 FROM metadata WHERE key = 'seeded'").get()) {
    const insert = db.prepare(
      "INSERT INTO products (name, description, price_cents, category) VALUES (?, ?, ?, ?)",
    );
    const products = [
      [
        "Studio Kopfhörer",
        "Kabelloser Sound für konzentriertes Arbeiten und deine Lieblingsmusik.",
        6990,
        "Technik",
      ],
      [
        "Notizbuch A5",
        "Punktkarierte Seiten, fester Einband und Platz für deine nächsten Ideen.",
        1290,
        "Schreibtisch",
      ],
      [
        "Keramiktasse",
        "Dein Begleiter für die erste Kaffeepause. 350 ml, spülmaschinenfest.",
        1490,
        "Alltag",
      ],
      [
        "Kompakte Tastatur",
        "Mehr Platz auf dem Schreibtisch. Kabelgebunden mit deutschem Layout.",
        4990,
        "Technik",
      ],
      [
        "Schreibtischlampe",
        "Warmes Licht mit drei Helligkeitsstufen für lange Lernabende.",
        3490,
        "Schreibtisch",
      ],
      [
        "Campus Rucksack",
        "Leicht unterwegs mit Laptopfach, robustem Stoff und 18 Litern Volumen.",
        3990,
        "Alltag",
      ],
    ];
    // Seed und Marker werden gemeinsam gespeichert, damit kein halber Datenbestand entsteht.
    db.exec("BEGIN");
    try {
      for (const product of products) insert.run(...product);
      db.prepare("INSERT INTO metadata VALUES ('seeded', '1')").run();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (!db.prepare("SELECT id FROM customers WHERE role = 'admin'").get()) {
    db.prepare(
      "INSERT INTO customers (name,email,address,password_hash,role) VALUES (?,?,?,?,?)",
    ).run(
      "Shop Verwaltung",
      "admin@minishop.local",
      "Campus 1, 52062 Aachen",
      await hashPassword(adminPassword),
      "admin",
    );
    return { db, adminCreated: true };
  }
  return { db, adminCreated: false };
}

// Sitzungen überleben einen Neustart; Passwörter stehen niemals in der Sitzung.
export class SQLiteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
  }
  get(sid, callback) {
    try {
      const row = this.db
        .prepare("SELECT data FROM sessions WHERE sid = ? AND expires > ?")
        .get(sid, Date.now());
      callback(null, row ? JSON.parse(row.data) : null);
    } catch (error) {
      callback(error);
    }
  }
  set(sid, value, callback = () => {}) {
    try {
      this.db
        .prepare("DELETE FROM sessions WHERE expires <= ?")
        .run(Date.now());
      this.db
        .prepare("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)")
        .run(
          sid,
          JSON.stringify(value),
          new Date(value.cookie.expires).getTime(),
        );
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
  destroy(sid, callback = () => {}) {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
  touch(sid, value, callback = () => {}) {
    this.set(sid, value, callback);
  }
}
