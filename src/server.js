import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createApp } from "./app.js";

const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
mkdirSync(dataDir, { recursive: true });
const secretPath = resolve(dataDir, "session-secret");
if (!existsSync(secretPath))
  writeFileSync(secretPath, randomBytes(48).toString("hex"), { mode: 0o600 });
const adminPassword =
  process.env.ADMIN_PASSWORD || randomBytes(12).toString("base64url");
const { app, db, adminCreated } = await createApp({
  dbPath: process.env.DB_PATH || resolve(dataDir, "shop.sqlite"),
  sessionSecret: process.env.SESSION_SECRET || readFileSync(secretPath, "utf8"),
  adminPassword,
});
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Mini-Shop läuft auf http://localhost:${port}`);
  if (adminCreated) {
    console.log("\nVerwaltungskonto wurde angelegt:");
    console.log("E-Mail: admin@minishop.local");
    console.log(`Passwort: ${adminPassword}`);
    console.log(
      "Bitte das Passwort aufbewahren. Es wird nur beim ersten Start angezeigt.\n",
    );
  }
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
