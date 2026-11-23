import { setTimeout as delay } from "node:timers/promises";
import { fail } from "./security.js";

const service = "/odata/v4/simple-erp";
const expandItems = "$expand=items($expand=product($select=name))";

export function createErpClient({ url, username, password, timeout = 1800 }) {
  const base = new URL(url);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password)
    throw new Error("ERP_URL muss eine HTTP(S)-Adresse ohne Zugangsdaten sein.");
  const authorization = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  async function request(path, { body, allowMissing = false } = {}) {
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
      fail(503, "Das ERP ist vorübergehend nicht erreichbar. Bitte erneut versuchen.");
    }
    if (response.ok)
      return response.json().catch(() => fail(502, "Das ERP hat keine gültige Antwort geliefert."));
    if (allowMissing && response.status === 404) return null;
    if (response.status === 409)
      fail(409, "Das ERP hat die Anfrage wegen eines Konflikts abgelehnt. Bitte den Bestand prüfen.");
    if ([400, 422].includes(response.status))
      fail(422, "Das ERP konnte die gesendeten Daten nicht verarbeiten.");
    if ([401, 403].includes(response.status))
      fail(503, "ERP-Zugriff verweigert. Bitte ERP-Zugangsdaten und Berechtigungen prüfen.");
    fail(503, "Das ERP hat die Anfrage nicht bestätigt. Bitte erneut versuchen.");
  }

  async function read(path, allowMissing = false) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request(path, { allowMissing });
      } catch (error) {
        if (attempt === 2 || ![502, 503].includes(error.status)) throw error;
        await delay(150 * (attempt + 1));
      }
    }
  }

  async function create(collection, record, find) {
    // Die UUID bleibt gleich. Nach einer unklaren Antwort zuerst lesen, ob
    // das ERP den Datensatz bereits gespeichert hat.
    for (let attempt = 0; ; attempt++) {
      try {
        return await request(`${service}/${collection}`, { body: record });
      } catch (error) {
        if (![409, 502, 503].includes(error.status)) throw error;
        const existing = await find();
        if (existing) return existing;
        if (attempt === 2 || error.status === 409) throw error;
        await delay(150 * (attempt + 1));
      }
    }
  }

  function findOrder(id) {
    return read(`${service}/Orders(${id})?${expandItems}`, true);
  }

  return {
    async products() {
      const products = await read("/rest/api/products");
      if (!Array.isArray(products))
        fail(502, "Das ERP hat keine gültige Produktliste geliefert.");
      return products;
    },
    findOrder,
    async ensureCustomer(customer) {
      const find = () => read(`${service}/Customers(${customer.ID})`, true);
      return (await find()) ?? create("Customers", customer, find);
    },
    createOrder(order) {
      return create("Orders", order, () => findOrder(order.ID));
    },
    async listOrders(ids) {
      const orders = [];
      for (let offset = 0; offset < ids.length; offset += 40) {
        const filter = encodeURIComponent(`ID in (${ids.slice(offset, offset + 40).join(",")})`);
        const result = await read(`${service}/Orders?${expandItems}&$filter=${filter}`);
        if (!Array.isArray(result?.value))
          fail(502, "Das ERP hat keine gültige Bestellübersicht geliefert.");
        orders.push(...result.value);
      }
      return orders;
    },
  };
}
