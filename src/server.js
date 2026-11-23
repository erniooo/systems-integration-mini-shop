import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { createErpClient } from "./erp-client.js";

const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
mkdirSync(dataDir, { recursive: true });
const secretPath = resolve(dataDir, "session-secret");
if (!existsSync(secretPath))
  writeFileSync(secretPath, randomBytes(48).toString("hex"), { mode: 0o600 });
const adminPassword =
  process.env.ADMIN_PASSWORD || randomBytes(12).toString("base64url");
const erp = process.env.SHOP_MODE === "lab2" ? null : createErpClient({
  url: process.env.ERP_URL || "http://127.0.0.1:4004",
  username: process.env.ERP_USER || "service-user",
  password: process.env.ERP_PASSWORD || "service-user",
});
const { app, db } = await createApp({
  dbPath: process.env.DB_PATH || resolve(dataDir, "shop.sqlite"),
  sessionSecret: process.env.SESSION_SECRET || readFileSync(secretPath, "utf8"),
  adminPassword,
  erp,
  demoLogin: true,
});
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Mini-Shop läuft auf http://localhost:${port}`);
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
