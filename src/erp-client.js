import { setTimeout as delay } from "node:timers/promises";
import { fail } from "./security.js";

const statuses = {
  NEW: "pending",
  PICKED: "picked",
  SHIPPED: "shipped",
  COMPLETED: "completed",
  CANCELED: "canceled",
};

function shopOrder(order) {
  if (!Number.isSafeInteger(order?.orderID) || !Array.isArray(order.items))
    fail(502, "Das ERP hat keine gültige Bestellbestätigung geliefert.");
  return {
    id: order.orderID,
    source: "erp",
    created_at: order.createdAt,
    status: statuses[order.status] || "pending",
    customer_name: order.customerName,
    customer_email: order.customerEmail,
    shipping_address: order.shippingAddress,
    total_cents: Number(order.totalCents),
    items: order.items.map((item) => ({
      product_name: item.productName,
      unit_price_cents: item.unitPriceCents,
      quantity: item.quantity,
    })),
  };
}

export function createErpClient({ url, username, password, timeout = 1800 }) {
  const base = new URL(url);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password)
    throw new Error("ERP_URL muss eine HTTP(S)-Adresse ohne Zugangsdaten sein.");
  const authorization = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  async function request(path, body) {
    // Eine Bestellung kann sicher erneut gesendet werden, da alle Versuche
    // dieselbe Kennung im ERP verwenden.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await delay(150 * attempt);
      let response;
      try {
        response = await fetch(new URL(path, base), {
          headers: {
            Authorization: authorization,
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          method: body ? "POST" : "GET",
          body: body ? JSON.stringify(body) : undefined,
          redirect: "error",
          signal: AbortSignal.timeout(timeout),
        });
      } catch {
        continue;
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          continue;
        }
      }
      const failure = await response.json().catch(() => null);
      if (response.status === 409)
        fail(409, failure?.error?.message === "This checkout ID belongs to another order."
          ? "Diese Kennung gehört bereits zu einer anderen Bestellung."
          : "Mindestens ein Produkt ist im ERP nicht in der gewünschten Menge verfügbar.");
      if ([400, 422].includes(response.status))
        fail(422, "Das ERP konnte die Bestelldaten nicht verarbeiten.");
      if (response.status < 500 && ![408, 429].includes(response.status))
        fail(503, "Verbindung zum ERP fehlgeschlagen. Bitte die ERP-Konfiguration prüfen.");
    }
    fail(503, body
      ? "Das ERP hat die Bestellung noch nicht bestätigt. Bitte denselben Kauf erneut versuchen."
      : "Das ERP ist vorübergehend nicht erreichbar. Bitte erneut versuchen.");
  }

  return {
    async products() {
      const products = await request("/rest/api/products");
      if (!Array.isArray(products))
        fail(502, "Das ERP hat keine gültige Produktliste geliefert.");
      return products;
    },
    async placeOrder(data) {
      return shopOrder(await request("/rest/api/placeShopOrder", data));
    },
    async listOrders(buyer) {
      const query = buyer ? `?buyer=${encodeURIComponent(buyer)}` : "";
      const orders = await request(`/rest/api/shopOrders${query}`);
      if (!Array.isArray(orders))
        fail(502, "Das ERP hat keine gültige Bestellübersicht geliefert.");
      return orders.map(shopOrder);
    },
  };
}
