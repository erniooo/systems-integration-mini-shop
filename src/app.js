import express from "express";
import session from "express-session";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { ensureDemoCustomer, openDatabase, SQLiteSessionStore } from "./database.js";
import { ErpOrderService, LocalOrderService } from "./order-service.js";
import { importProducts } from "./product-import.js";
import { readProductPhoto } from "./product-photos.js";
import { refreshErpCatalog } from "./erp-catalog.js";
import {
  fail,
  text,
  email,
  password,
  hashPassword,
  verifyPassword,
} from "./security.js";

export async function createApp({ dbPath, sessionSecret, adminPassword, erp, demoLogin = false }) {
  const { db, adminCreated } = await openDatabase(dbPath, adminPassword);
  const demoCustomerId = demoLogin ? await ensureDemoCustomer(db) : null;
  const orderService = erp ? new ErpOrderService(db, erp) : new LocalOrderService(db);
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "upgrade-insecure-requests": null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use(
    "/api",
    session({
      name: "minishop.sid",
      secret: sessionSecret,
      store: new SQLiteSessionStore(db),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 8 * 60 * 60 * 1000,
      },
    }),
  );
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const isUpload = req.method === "POST" && req.is("multipart/form-data") &&
        (req.path === "/admin/import/products" || /^\/products\/[1-9]\d*\/photo$/.test(req.path));
      if (!isUpload && !req.is("application/json"))
        return next(
          Object.assign(new Error("Bitte JSON senden."), { status: 415 }),
        );
      if (
        !req.session.csrfToken ||
        req.get("X-CSRF-Token") !== req.session.csrfToken
      ) {
        return next(
          Object.assign(
            new Error("Sitzung abgelaufen. Bitte die Seite neu laden."),
            { status: 403 },
          ),
        );
      }
      if (
        !isUpload &&
        (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
      ) {
        return next(
          Object.assign(new Error("Bitte ein JSON-Objekt senden."), {
            status: 400,
          }),
        );
      }
    }
    req.user = req.session.customerId
      ? db
          .prepare(
            "SELECT id, name, email, address, role FROM customers WHERE id = ?",
          )
          .get(req.session.customerId)
      : null;
    next();
  });

  function requireLogin(req, res, next) {
    if (!req.user)
      return next(
        Object.assign(new Error("Bitte zuerst anmelden."), { status: 401 }),
      );
    next();
  }
  function requireAdmin(req, res, next) {
    if (req.user?.role !== "admin")
      return next(
        Object.assign(
          new Error("Nur die Verwaltung darf diese Aktion ausführen."),
          { status: 403 },
        ),
      );
    next();
  }
  function sessionResult(req) {
    req.session.csrfToken ??= randomBytes(24).toString("hex");
    return { user: req.user || null, csrfToken: req.session.csrfToken, liveErp: Boolean(erp) };
  }
  async function login(req, customerId) {
    await new Promise((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    req.session.customerId = customerId;
    req.user = db
      .prepare(
        "SELECT id, name, email, address, role FROM customers WHERE id = ?",
      )
      .get(customerId);
    return sessionResult(req);
  }
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.",
    },
  });

  app.get("/api/session", (req, res) => res.json(sessionResult(req)));
  if (demoLogin) {
    app.post("/api/demo-login", async (req, res) => {
      const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
      if (!local.includes(req.socket.remoteAddress) ||
          !["localhost", "127.0.0.1", "[::1]"].includes(req.hostname))
        fail(403, "Der Demo-Login ist nur lokal verfügbar.");
      const { role } = req.body;
      if (role !== "admin" && role !== "customer")
        fail(400, "Bitte Nutzer oder Admin auswählen.");
      const account = role === "admin"
        ? db.prepare("SELECT id FROM customers WHERE role = 'admin' ORDER BY id LIMIT 1").get()
        : db.prepare("SELECT id FROM customers WHERE id = ? AND role = 'customer'").get(demoCustomerId);
      if (!account) fail(404, "Das Konto ist nicht verfügbar.");
      res.json(await login(req, account.id));
    });
  }
  app.post("/api/register", authLimit, async (req, res) => {
    const name = text(req.body.name, "Name", 100);
    const mail = email(req.body.email);
    const address = text(req.body.address, "Adresse", 500);
    const hash = await hashPassword(password(req.body.password));
    if (db.prepare("SELECT id FROM customers WHERE email = ?").get(mail))
      fail(409, "Diese E-Mail-Adresse ist bereits registriert.");
    const result = db
      .prepare(
        "INSERT INTO customers (name,email,address,password_hash) VALUES (?,?,?,?)",
      )
      .run(name, mail, address, hash);
    res.status(201).json(await login(req, Number(result.lastInsertRowid)));
  });
  app.post("/api/login", authLimit, async (req, res) => {
    const mail = email(req.body.email);
    if (typeof req.body.password !== "string" || req.body.password.length > 128)
      fail(400, "Bitte ein gültiges Passwort eingeben.");
    const customer = db
      .prepare("SELECT * FROM customers WHERE email = ?")
      .get(mail);
    if (
      !customer ||
      !(await verifyPassword(req.body.password, customer.password_hash))
    )
      fail(401, "E-Mail oder Passwort ist falsch.");
    res.json(await login(req, customer.id));
  });
  app.post("/api/logout", (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie("minishop.sid", {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
      res.json({ ok: true });
    });
  });
  app.patch("/api/profile", requireLogin, (req, res) => {
    const name = text(req.body.name, "Name", 100);
    const mail = email(req.body.email);
    const address = text(req.body.address, "Adresse", 500);
    if (
      db
        .prepare("SELECT id FROM customers WHERE email = ? AND id != ?")
        .get(mail, req.user.id)
    ) {
      fail(409, "Diese E-Mail-Adresse ist bereits vergeben.");
    }
    db.prepare(
      "UPDATE customers SET name=?, email=?, address=? WHERE id=?",
    ).run(name, mail, address, req.user.id);
    req.user = { ...req.user, name, email: mail, address };
    res.json({ user: req.user });
  });

  app.get("/api/products", async (req, res) => {
    let stock;
    if (erp) {
      try {
        stock = refreshErpCatalog(db, await erp.products());
      } catch (error) {
        if (![502, 503].includes(error.status)) throw error;
      }
    }
    const fields = erp ? "" : ", stock, stock_imported_at";
    const products = db.prepare(
      `SELECT id, erp_id, name, description, price_cents, category${fields},
        EXISTS(SELECT 1 FROM product_photos WHERE product_id=products.id) AS has_photo
        FROM products WHERE active=1 ORDER BY id`,
    ).all();
    if (!erp) return res.json(products);
    const withStock = products.map((p) => {
      const quantity = stock?.get(p.erp_id) ?? null;
      const source = !p.erp_id ? "unlinked" : !stock ? "unavailable"
        : quantity === null ? "missing" : "erp";
      return { ...p, stock: quantity, stock_source: source };
    });
    const visible = req.query.view === "catalog"
      ? withStock.filter((p) => p.stock > 0 || p.stock_source === "unavailable")
      : withStock;
    res.json(visible);
  });
  app.get("/api/products/:id/photo", (req, res) => {
    const photo = db.prepare(
      `SELECT image FROM product_photos
       JOIN products ON products.id=product_photos.product_id WHERE id=? AND active=1`,
    ).get(id(req.params.id));
    if (!photo) fail(404, "Kein Produktfoto vorhanden.");
    res.type("image/webp").send(Buffer.from(photo.image));
  });
  function productValues(body) {
    const name = text(body.name, "Produktname", 100);
    if (
      typeof body.description !== "string" ||
      body.description.trim().length > 1000
    )
      fail(400, "Beschreibung: Bitte höchstens 1000 Zeichen eingeben.");
    const description = body.description.trim();
    const category = text(body.category, "Kategorie", 50);
    const raw =
      typeof body.price === "string" ? body.price.trim().replace(",", ".") : "";
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(raw))
      fail(
        400,
        "Preis: Bitte 0 bis 999999,99 mit höchstens zwei Nachkommastellen eingeben.",
      );
    const [euros, cents = ""] = raw.split(".");
    return [
      name,
      description,
      Number(euros) * 100 + Number(cents.padEnd(2, "0")),
      category,
    ];
  }
  function id(value) {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
      fail(400, "Ungültige ID.");
    return Number(value);
  }
  app.post("/api/products", requireAdmin, (req, res) => {
    const result = db
      .prepare(
        "INSERT INTO products (name,description,price_cents,category) VALUES (?,?,?,?)",
      )
      .run(...productValues(req.body));
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });
  app.patch("/api/products/:id", requireAdmin, (req, res) => {
    const values = productValues(req.body);
    const result = db
      .prepare(
        "UPDATE products SET name=?,description=?,price_cents=?,category=? WHERE id=? AND active=1",
      )
      .run(...values, id(req.params.id));
    if (!result.changes) fail(404, "Produkt nicht gefunden.");
    res.json({ ok: true });
  });
  app.delete("/api/products/:id", requireAdmin, (req, res) => {
    const result = db
      .prepare("UPDATE products SET active=0 WHERE id=? AND active=1")
      .run(id(req.params.id));
    if (!result.changes) fail(404, "Produkt nicht gefunden.");
    res.json({ ok: true });
  });
  function receiveFile(maxMb) {
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 0 },
    }).single("file");
    return (req, res, next) => {
      upload(req, res, (error) => {
        if (!error) return next();
        const tooLarge = error.code === "LIMIT_FILE_SIZE";
        const message = tooLarge ? `Die Datei darf höchstens ${maxMb} MB groß sein.`
          : "Der Datei-Upload ist ungültig. Bitte genau eine Datei auswählen.";
        next(Object.assign(new Error(message), { status: tooLarge ? 413 : 400 }));
      });
    };
  }
  app.post("/api/products/:id/photo", requireAdmin, receiveFile(5), async (req, res) => {
    const productId = id(req.params.id);
    const image = await readProductPhoto(req.file);
    const result = db.prepare(
      `INSERT INTO product_photos (product_id, image)
       SELECT id, ? FROM products WHERE id=? AND active=1
       ON CONFLICT(product_id) DO UPDATE SET image=excluded.image`,
    ).run(image, productId);
    if (!result.changes) fail(404, "Produkt nicht gefunden.");
    res.json({ ok: true });
  });
  app.delete("/api/products/:id/photo", requireAdmin, (req, res) => {
    db.prepare("DELETE FROM product_photos WHERE product_id=?").run(id(req.params.id));
    res.json({ ok: true });
  });
  app.post(
    "/api/admin/import/products",
    requireAdmin,
    receiveFile(2),
    async (req, res) => {
      res.json(await importProducts(db, req.file, { keepStock: !erp }));
    },
  );
  app.post("/api/orders", requireLogin, async (req, res) => {
    res.status(201).json(await orderService.placeOrder(req.user, req.body.items, req.body.requestID));
  });
  app.get("/api/orders", requireLogin, async (req, res) =>
    res.json(await orderService.listOrders(req.user.id)),
  );
  app.get("/api/admin/orders", requireAdmin, async (req, res) =>
    res.json(await orderService.listOrders()),
  );
  app.patch("/api/admin/orders/:id", requireAdmin, (req, res) => {
    if (!["pending", "shipped", "completed"].includes(req.body.status))
      fail(400, "Ungültiger Bestellstatus.");
    const result = db
      .prepare("UPDATE orders SET status=? WHERE id=?")
      .run(req.body.status, id(req.params.id));
    if (!result.changes) fail(404, "Bestellung nicht gefunden.");
    res.json(orderService.getOrder(id(req.params.id)));
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API-Endpunkt nicht gefunden." }),
  );
  app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || 500;
    if (status >= 500 && ![502, 503].includes(status)) console.error(error);
    res.status(status).json({
      error:
        status >= 500 && ![502, 503].includes(status)
          ? "Ein interner Fehler ist aufgetreten." : error.message,
    });
  });
  return { app, db, adminCreated };
}
