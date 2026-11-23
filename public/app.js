const $ = (selector) => document.querySelector(selector);
const main = $("#main");
const money = (cents) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    cents / 100,
  );
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const state = {
  user: null,
  csrfToken: "",
  products: [],
  cart: [],
  search: "",
  category: "Alle",
  importResult: null,
  liveErp: false,
  checkoutPending: null,
  checkingOut: false,
};
try {
  const saved = JSON.parse(localStorage.getItem("minishop-cart") || "[]");
  if (Array.isArray(saved))
    state.cart = saved.filter(
      (p) =>
        p &&
        Number.isSafeInteger(p.productId) &&
        Number.isInteger(p.quantity) &&
        p.quantity > 0 &&
        p.quantity <= 99,
    );
} catch {
  /* Ein beschädigter Warenkorb wird leer gestartet. */
}
let toastTimer;
let renderVersion = 0;

function notify(message, error = false) {
  const toast = $("#toast");
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = error ? "error" : "";
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 5000);
}

async function api(path, { method = "GET", body } = {}) {
  const isFileUpload = body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(isFileUpload ? {} : { "Content-Type": "application/json" }),
      "X-CSRF-Token": state.csrfToken,
    },
    ...(body === undefined
      ? {}
      : { body: isFileUpload ? body : JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error || "Die Anfrage ist fehlgeschlagen."), { status: response.status });
  return result;
}

function updateHeader() {
  $("#account-button").textContent = state.user ? "Mein Konto" : "Anmelden";
  $("#admin-nav").hidden = state.user?.role !== "admin";
  $("#cart-count").textContent = state.cart.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const page = location.hash.slice(1) || "products";
  document
    .querySelectorAll("[data-nav]")
    .forEach((link) =>
      link.classList.toggle("active", link.dataset.nav === page),
    );
}
function saveCart() {
  try {
    localStorage.setItem("minishop-cart", JSON.stringify(state.cart));
  } catch {
    /* Der Warenkorb funktioniert auch ohne Browserspeicher. */
  }
  updateHeader();
}
function stockLabel(product) {
  if (product.stock_source === "unlinked") return "Keinem ERP-Produkt zugeordnet";
  if (product.stock_source === "missing") return "Im ERP nicht verfügbar";
  if (product.stock_source === "unavailable") return "ERP-Bestand derzeit nicht abrufbar";
  if (product.stock === null) return "Bestand nicht erfasst";
  return product.stock === 0 ? "Nicht verfügbar" : `${product.stock} verfügbar`;
}

function stockAllows(product, quantity) {
  return Boolean(product && (product.stock === null
    ? !product.stock_source
    : quantity <= product.stock));
}

function checkoutAttempt() {
  if (!state.liveErp || !state.user) return null;
  const signature = JSON.stringify(
    [...state.cart].sort((a, b) => a.productId - b.productId),
  );
  const key = `minishop-checkout-${state.user.id}`;
  let saved = state.checkoutPending;
  try {
    saved = JSON.parse(localStorage.getItem(key)) || saved;
  } catch {
    // Wenn der Browserspeicher fehlt, bleibt die laufende Seite nutzbar.
  }
  return saved?.key === key && saved.signature === signature ? saved : null;
}

function saveCheckout(attempt, key = attempt.key) {
  state.checkoutPending = attempt;
  try {
    if (attempt) localStorage.setItem(key, JSON.stringify(attempt));
    else localStorage.removeItem(key);
  } catch {
    // Der laufende Checkout behält seine Kennung im Seitenspeicher.
  }
}

function addToCart(productId) {
  const product = state.products.find((p) => p.id === productId);
  const item = state.cart.find((p) => p.productId === productId);
  if (!product) return notify("Dieses Produkt ist nicht mehr verfügbar.", true);
  if (!stockAllows(product, (item?.quantity || 0) + 1))
    return notify("Die gewünschte Menge ist zurzeit nicht verfügbar.", true);
  if (item?.quantity >= 99)
    return notify("Maximal 99 Stück pro Produkt.", true);
  if (item) item.quantity++;
  else state.cart.push({ productId, quantity: 1 });
  saveCart();
  notify("Zum Warenkorb hinzugefügt.");
}

function productArtwork(product) {
  if (!product?.has_photo)
    return '<div class="product-art product-photo-placeholder">Kein Produktfoto</div>';
  return `<div class="product-art photo-art"><img src="/api/products/${product.id}/photo" alt="${escape(product.name)}" loading="lazy" decoding="async"></div>`;
}

function productCard(p) {
  const stockText = stockLabel(p);
  const stockDetail = p.stock_imported_at ? " · Stand letzter Import" : "";
  return `<article class="product-card">${productArtwork(p)}<div class="product-info"><span class="eyebrow">${escape(p.category)}</span><h3>${escape(p.name)}</h3><p>${escape(p.description)}</p><div class="stock-note ${p.stock === 0 ? "out-of-stock" : ""}">${stockText}${stockDetail}</div><div class="product-bottom"><strong>${money(p.price_cents)}</strong><button class="add-button" data-add="${p.id}" aria-label="${escape(p.name)} in den Warenkorb" ${stockAllows(p, 1) ? "" : "disabled"}><span aria-hidden="true">+</span> Hinzufügen</button></div></div></article>`;
}

function filterProducts() {
  const products = state.products.filter(
    (p) =>
      (state.category === "Alle" || p.category === state.category) &&
      `${p.name} ${p.description}`
        .toLowerCase()
        .includes(state.search.toLowerCase()),
  );
  $("#product-grid").innerHTML =
    products.map(productCard).join("") ||
    (state.products.length
      ? '<p class="empty-inline">Keine Produkte gefunden. Probiere einen anderen Suchbegriff.</p>'
      : '<p class="empty-inline">Zurzeit sind keine Produkte verfügbar.</p>');
  $("#product-results").textContent =
    `${products.length} ${products.length === 1 ? "Produkt" : "Produkte"}`;
  document.querySelectorAll("[data-category]").forEach((button) => {
    button.classList.toggle(
      "selected",
      button.dataset.category === state.category,
    );
    button.setAttribute(
      "aria-pressed",
      button.dataset.category === state.category,
    );
  });
}
function renderProducts() {
  const categories = [
    "Alle",
    ...new Set(state.products.map((p) => p.category)),
  ];
  if (!categories.includes(state.category)) state.category = "Alle";
  main.innerHTML = `<section class="hero"><div><span class="eyebrow"><span class="little-line"></span> EINFACH GUT AUSGESTATTET</span><h1>Für deinen Alltag.<br><em>Und deine Ideen.</em></h1><p>Lieblingsstücke für den Schreibtisch, den Campus<br class="desktop-break"> und alles dazwischen. Entdecke unsere Auswahl.</p><a class="button" href="#catalog">Produkte entdecken <span aria-hidden="true">↗</span></a></div><div class="hero-art" aria-hidden="true"><span class="hero-circle"></span><div class="hero-note">good<br>things<span>FOR EVERY DAY</span></div><span class="hero-pencil"></span><div class="hero-cup"><span></span></div><span class="hero-spark">✳</span><span class="hero-caption">WENIGER SUCHEN. MEHR FINDEN.</span></div></section>
    <section class="catalog" id="catalog" aria-labelledby="catalog-heading"><div class="section-heading"><div><span class="eyebrow">UNSERE AUSWAHL</span><h2 id="catalog-heading">Kleine Dinge, die bleiben.</h2></div><span class="muted" id="product-results"></span></div><div class="catalog-toolbar"><div class="filters" aria-label="Produktkategorien">${categories.map((c) => `<button data-category="${escape(c)}" aria-pressed="false">${escape(c)}</button>`).join("")}</div><label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input id="product-search" type="search" placeholder="Produkte suchen" aria-label="Produkte suchen" value="${escape(state.search)}"></label></div><div class="product-grid" id="product-grid"></div></section>
    <aside class="shop-note"><span class="note-symbol" aria-hidden="true">✳</span><div><strong>Alles, was du brauchst. Ganz unkompliziert.</strong><p>In Ruhe stöbern, Lieblingsstücke auswählen und einfach bestellen.</p></div><a href="#cart">Zum Warenkorb <span aria-hidden="true">↗</span></a></aside>`;
  filterProducts();
}
function heading(kicker, title, description = "") {
  return `<div class="page-heading"><span class="eyebrow">${kicker}</span><h1>${title}</h1>${description ? `<p class="muted">${description}</p>` : ""}</div>`;
}
function empty(
  title,
  description,
  action = '<a class="button" href="#products">Produkte entdecken</a>',
) {
  return `<div class="empty-state"><span class="empty-mark" aria-hidden="true">m.</span><h2>${title}</h2><p>${description}</p>${action}</div>`;
}
function renderCart() {
  const rows = state.cart.map((item) => ({
    ...item,
    product: state.products.find((p) => p.id === item.productId),
  }));
  const total = rows.reduce(
    (sum, item) => sum + (item.product?.price_cents || 0) * item.quantity,
    0,
  );
  const retry = Boolean(checkoutAttempt());
  const blocked = rows.some(({ product, quantity }) => !stockAllows(product, quantity));
  main.innerHTML =
    heading(
      "DEINE AUSWAHL",
      "Dein Warenkorb.",
      "Noch ein Schritt bis zu deinen neuen Lieblingsstücken.",
    ) +
    (!rows.length
      ? empty(
          "Hier ist noch Platz.",
          "Entdecke unsere Produkte und stelle deine Auswahl zusammen.",
        )
      : `<div class="cart-layout"><section class="cart-items" aria-label="Warenkorbpositionen">${rows.map((item) => `<article class="cart-row">${productArtwork(item.product)}<div class="cart-product"><h3>${escape(item.product?.name || "Produkt nicht mehr verfügbar")}</h3><p class="muted">${item.product ? `${money(item.product.price_cents)} / Stück · ${stockLabel(item.product)}` : "Bitte aus dem Warenkorb entfernen."}</p><button class="text-button remove" data-remove="${item.productId}">Entfernen</button></div><label class="quantity">Menge<input type="number" min="1" max="99" value="${item.quantity}" data-quantity="${item.productId}" aria-label="Menge für ${escape(item.product?.name || "entferntes Produkt")}"></label><strong>${item.product ? money(item.product.price_cents * item.quantity) : "—"}</strong></article>`).join("")}</section><aside class="summary"><h2>Deine Bestellung</h2><div class="summary-line"><span>Zwischensumme</span><span>${money(total)}</span></div><div class="summary-line"><span>Versand</span><span>Kostenlos</span></div><div class="summary-line total"><span>Gesamt</span><strong>${money(total)}</strong></div>${state.user ? `<div class="shipping"><span class="eyebrow">LIEFERUNG AN</span><strong>${escape(state.user.name)}</strong><p>${escape(state.user.address)}</p><a href="#account">Adresse bearbeiten</a></div>${blocked && !retry ? '<p class="form-error">Prüfe den Bestand oder passe die Menge an.</p>' : ""}<button class="button full" id="checkout" ${blocked && !retry ? "disabled" : ""}>${retry ? "Bestellung erneut prüfen" : "Jetzt bestellen"} <span aria-hidden="true">↗</span></button><p class="small muted">Übungs-Shop: Es erfolgt keine Zahlung und kein tatsächlicher Versand.</p>` : '<p class="muted">Melde dich an, um zu bestellen.</p><button class="button full" data-open-auth>Anmelden & bestellen</button>'}</aside></div>`);
}
function orderCard(order, admin = false) {
  const labels = {
    pending: "Offen",
    shipped: "Versendet",
    completed: "Abgeschlossen",
    picked: "Kommissioniert",
    canceled: "Storniert",
  };
  return `<article class="order-card"><div class="order-head"><div><span class="eyebrow">${order.source === "erp" ? "ERP-BESTELLUNG" : "BESTELLUNG"} #${String(order.id).padStart(4, "0")}</span><h3>${new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.created_at))}</h3></div><span class="badge ${escape(order.status)}">${labels[order.status]}</span></div>${admin ? `<p class="muted">${escape(order.customer_name)} · ${escape(order.customer_email)}</p>` : ""}<ul class="order-items">${order.items.map((item) => `<li><span>${item.quantity} × ${escape(item.product_name)}</span><strong>${money(item.unit_price_cents * item.quantity)}</strong></li>`).join("")}</ul><div class="order-foot"><span class="muted address">${escape(order.shipping_address)}</span><strong>Gesamt ${money(order.total_cents)}</strong></div>${
    admin && order.source !== "erp"
      ? `<label class="status-control">Bestellstatus<select aria-label="Bestellstatus" data-order-status="${order.id}">${Object.entries(labels).filter(([value]) => ["pending", "shipped", "completed"].includes(value))
          .map(
            ([value, label]) =>
              `<option value="${value}" ${value === order.status ? "selected" : ""}>${label}</option>`,
          )
          .join("")}</select></label>`
      : ""
  }</article>`;
}
function renderAccount() {
  if (!state.user) {
    main.innerHTML =
      heading("DEIN KONTO", "Schön, dass du da bist.") +
      empty(
        "Alles an einem Ort.",
        "Melde dich an, um deine Daten und Bestellungen zu sehen.",
        '<button class="button" data-open-auth>Anmelden</button>',
      );
    return;
  }
  main.innerHTML =
    heading(
      "DEIN KONTO",
      "Hallo, " + escape(state.user.name) + ".",
      "Hier kannst du deine persönlichen Daten und deine Lieferadresse ändern.",
    ) +
    `<div class="account-layout"><form id="profile-form" class="panel"><h2>Persönliche Daten</h2><label>Name<input name="name" required autocomplete="name" maxlength="100" value="${escape(state.user.name)}"></label><label>E-Mail<input name="email" type="email" required autocomplete="email" maxlength="254" value="${escape(state.user.email)}"></label><label>Lieferadresse<textarea name="address" required autocomplete="street-address" maxlength="500" rows="4">${escape(state.user.address)}</textarea></label><button class="button" type="submit">Änderungen speichern</button></form><aside class="panel account-aside"><span class="eyebrow">GUT ZU WISSEN</span><h2>Deine nächste Bestellung?</h2><p class="muted">Deine Lieferadresse wird beim Bestellen übernommen. Bereits aufgegebene Bestellungen behalten die damalige Adresse.</p><a href="#orders">Meine Bestellungen ansehen ↗</a><hr><div class="form-actions"><button class="text-button" data-open-auth>Konto wechseln</button><button class="text-button" id="logout">Abmelden</button></div></aside></div>`;
}
function renderImportPanel() {
  const result = state.importResult;
  return `<section class="panel import-panel" aria-labelledby="import-heading">
    <div><span class="eyebrow">LAB 2 · DATEIAUSTAUSCH</span><h2 id="import-heading">Produkte aus dem ERP importieren</h2>
    <p class="muted">Exportiere die Produktliste im Mini-ERP als Excel und wähle die Datei hier aus. Alternativ kannst du die CSV-Datei der ERP-Schnittstelle verwenden.</p>
    <p class="small muted">${state.liveErp ? "Neue ERP-Produkte erscheinen automatisch. Mit dem Dateiimport kannst du vorhandene Katalogdaten aktualisieren." : "Der Bestand zeigt den Stand des letzten Imports. Produkte, die in der Datei fehlen, bleiben im Shop."}</p></div>
    <form id="import-form" enctype="multipart/form-data"><label>ERP-Produktdatei (.xlsx oder .csv, höchstens 2 MB)<input type="file" name="file" accept=".xlsx,.csv" required></label>
    <p id="import-error" class="form-error" role="alert"></p><button class="button" type="submit">Datei importieren</button>
    ${result ? `<p class="import-success" role="status">Import abgeschlossen: ${result.created} neu, ${result.updated} aktualisiert.</p>` : ""}</form>
  </section>`;
}

function productPhotoForm() {
  return `<form id="product-photo-form" class="product-photo-form" hidden>
    <label>Produktfoto<input type="file" name="file" accept="image/jpeg,image/png,image/webp" required></label>
    <p class="small muted">JPEG, PNG oder WebP, bis 5 MB.</p>
    <img id="product-photo-preview" alt="Aktuelles Produktfoto" width="160" height="100" hidden>
    <div class="form-actions"><button class="quiet" type="submit">Foto speichern</button>
      <button class="text-button remove" type="button" id="remove-product-photo" hidden>Foto entfernen</button></div>
    <p class="form-error" id="product-photo-error" role="alert"></p>
  </form>`;
}

function showProductPhotoForm(product) {
  const form = $("#product-photo-form");
  form.reset();
  form.dataset.productId = product.id;
  form.hidden = false;
  const preview = $("#product-photo-preview");
  preview.hidden = !product.has_photo;
  $("#remove-product-photo").hidden = !product.has_photo;
  $("#product-photo-error").textContent = "";
  if (product.has_photo) preview.src = `/api/products/${product.id}/photo?v=${Date.now()}`;
  else preview.removeAttribute("src");
}

async function changeProductPhoto(form, method) {
  const product = state.products.find((item) => item.id === Number(form.dataset.productId));
  if (!product) return;
  const controls = form.querySelectorAll("button");
  controls.forEach((control) => (control.disabled = true));
  $("#product-photo-error").textContent = "";
  try {
    const body = method === "POST" ? new FormData(form) : {};
    await api(`/products/${product.id}/photo`, { method, body });
    product.has_photo = method === "POST";
    if (!form.hidden && Number(form.dataset.productId) === product.id)
      showProductPhotoForm(product);
    notify(method === "POST" ? "Produktfoto gespeichert." : "Produktfoto entfernt.");
  } catch (error) {
    if (!form.hidden && Number(form.dataset.productId) === product.id)
      form.querySelector("#product-photo-error").textContent = error.message;
  } finally {
    controls.forEach((control) => (control.disabled = false));
  }
}

function renderAdmin(orders, orderError) {
  main.innerHTML =
    heading(
      "VERWALTUNG",
      "Dein Shop im Überblick.",
      "Produkte pflegen und Bestellungen bearbeiten.",
    ) +
    renderImportPanel() +
    `<div class="admin-layout"><section class="panel"><h2 id="product-form-heading">Produkt hinzufügen</h2><form id="product-form"><input type="hidden" name="id"><label>Produktname<input name="name" required maxlength="100"></label><label>Beschreibung<textarea name="description" maxlength="1000" rows="3"></textarea></label><div class="form-columns"><label>Preis in €<input name="price" inputmode="decimal" required placeholder="19,90" pattern="[0-9]{1,6}([.,][0-9]{1,2})?"></label><label>Kategorie<input name="category" required maxlength="50" list="categories"><datalist id="categories"><option value="Technik"><option value="Schreibtisch"><option value="Alltag"></datalist></label></div><div class="form-actions"><button class="button" type="submit" id="product-submit">Produkt hinzufügen</button><button class="quiet" type="button" id="reset-product" hidden>Abbrechen</button></div></form>${productPhotoForm()}</section><section class="panel"><h2>Produkte <span class="muted">(${state.products.length})</span></h2><div class="manage-products">${state.products.map((p) => `<div class="manage-row"><div><strong>${escape(p.name)}</strong><span class="muted">${money(p.price_cents)} · ${escape(p.category)}${p.erp_id ? ` · ERP-ID: ${escape(p.erp_id)}` : ""}</span></div><div class="manage-actions"><button class="text-button" data-edit="${p.id}">Bearbeiten</button><button class="text-button remove" data-delete="${p.id}" aria-label="${escape(p.name)} entfernen">Entfernen</button></div></div>`).join("") || '<p class="muted">Noch keine Produkte angelegt.</p>'}</div></section></div><section class="admin-orders"><div class="section-heading"><h2>Alle Bestellungen</h2><span class="muted">${orderError ? "" : orders.length + (orders.length === 1 ? " Bestellung" : " Bestellungen")}</span></div>${orderError ? `<p class="form-error" role="alert">${escape(orderError)}</p><button class="quiet" data-retry>Erneut versuchen</button>` : orders.length ? `<div class="order-grid">${orders.map((order) => orderCard(order, true)).join("")}</div>` : '<p class="muted">Es sind noch keine Bestellungen eingegangen.</p>'}</section>`;
}

async function render() {
  const version = ++renderVersion;
  updateHeader();
  const page = location.hash.slice(1) || "products";
  try {
    if (page === "cart") {
      const products = await api("/products");
      if (version !== renderVersion) return;
      state.products = products;
      renderCart();
    } else if (page === "account") renderAccount();
    else if (page === "orders" || page === "admin") {
      if (!state.user) {
        main.innerHTML =
          heading("DEINE BESTELLUNGEN", "Ein Blick auf deine Auswahl.") +
          empty(
            "Bitte melde dich an.",
            "Deine Bestellungen sind nur für dich sichtbar.",
            '<button class="button" data-open-auth>Jetzt anmelden</button>',
          );
        return;
      }
      if (page === "admin" && state.user.role !== "admin") {
        main.innerHTML = empty(
          "Nur für die Verwaltung.",
          "Mit deinem Kundenkonto kannst du Produkte entdecken und bestellen.",
        );
        return;
      }
      main.innerHTML = '<p class="loading">Bestellungen werden geladen …</p>';
      if (page === "admin") {
        let orderError;
        const [products, orders] = await Promise.all([
          api("/products"),
          api("/admin/orders").catch((error) => {
            if (![502, 503].includes(error.status)) throw error;
            orderError = error.message;
            return [];
          }),
        ]);
        if (version !== renderVersion) return;
        state.products = products;
        renderAdmin(orders, orderError);
      } else {
        const orders = await api("/orders");
        if (version !== renderVersion) return;
        main.innerHTML =
          heading(
            "DEINE KAUFHISTORIE",
            "Deine Bestellungen.",
            "Alle Bestellungen und ihr aktueller Status auf einen Blick.",
          ) +
          (orders.length
            ? `<div class="order-grid">${orders.map((order) => orderCard(order)).join("")}</div>`
            : empty(
                "Deine erste Bestellung wartet.",
                "Sobald du etwas bestellst, findest du es hier wieder.",
              ));
      }
    } else {
      const products = await api("/products?view=catalog");
      if (version !== renderVersion) return;
      state.products = products;
      renderProducts();
      if (page === "catalog")
        $("#catalog").scrollIntoView({ behavior: "smooth" });
    }
  } catch (error) {
    if (version === renderVersion)
      main.innerHTML = empty(
        "Das hat gerade nicht geklappt.",
        escape(error.message),
        '<button class="button" data-retry>Erneut versuchen</button>',
      );
  }
}

function openAuth() {
  $("#auth-error").textContent = "";
  $("#auth-dialog").showModal();
}
$("#account-button").addEventListener("click", () => {
  if (state.user) location.hash = "account";
  else openAuth();
});
$("#close-auth").addEventListener("click", () => $("#auth-dialog").close());
$("#auth-dialog").addEventListener("click", (event) => {
  if (event.target === $("#auth-dialog")) {
    const box = event.target.getBoundingClientRect();
    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    )
      event.target.close();
  }
});
async function demoLogin(role) {
  const buttons = document.querySelectorAll("[data-demo-role]");
  buttons.forEach((button) => (button.disabled = true));
  $("#auth-error").textContent = "";
  try {
    if (!state.csrfToken) Object.assign(state, await api("/session"));
    const result = await api("/demo-login", { method: "POST", body: { role } });
    Object.assign(state, result, { importResult: null });
    $("#auth-dialog").close();
    const page = role === "admin" ? "#admin"
      : location.hash === "#cart" ? "#cart" : "#products";
    if (location.hash === page) await render();
    else location.hash = page;
  } catch (error) {
    $("#auth-error").textContent = error.message;
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  try {
    if (target.hasAttribute("data-add")) addToCart(Number(target.dataset.add));
    else if (target.hasAttribute("data-category")) {
      state.category = target.dataset.category;
      filterProducts();
    } else if (target.hasAttribute("data-demo-role")) await demoLogin(target.dataset.demoRole);
    else if (target.hasAttribute("data-open-auth")) openAuth();
    else if (target.hasAttribute("data-retry")) await render();
    else if (target.hasAttribute("data-remove")) {
      state.cart = state.cart.filter(
        (p) => p.productId !== Number(target.dataset.remove),
      );
      saveCart();
      renderCart();
    } else if (target.id === "checkout") {
      if (state.checkingOut) return;
      state.checkingOut = true;
      target.disabled = true;
      let attempt = checkoutAttempt();
      try {
        if (state.liveErp && !attempt) {
          attempt = {
            key: `minishop-checkout-${state.user.id}`,
            signature: JSON.stringify([...state.cart].sort((a, b) => a.productId - b.productId)),
            requestID: crypto.randomUUID(),
          };
          saveCheckout(attempt);
        }
        const order = await api("/orders", {
          method: "POST",
          body: { items: state.cart, requestID: attempt?.requestID },
        });
        if (attempt) saveCheckout(null, attempt.key);
        state.cart = [];
        saveCart();
        location.hash = "orders";
        notify(
          `${order.source === "erp" ? "ERP-Bestellung" : "Bestellung"} #${String(order.id).padStart(4, "0")} bestätigt.`,
        );
      } catch (error) {
        if (attempt && [400, 409, 422].includes(error.status))
          saveCheckout(null, attempt.key);
        if (location.hash === "#cart") await render();
        throw error;
      } finally {
        state.checkingOut = false;
        target.disabled = false;
      }
    } else if (target.id === "logout") {
      await api("/logout", { method: "POST", body: {} });
      state.user = null;
      state.importResult = null;
      state.cart = [];
      saveCart();
      Object.assign(state, await api("/session"));
      location.hash = "products";
      notify("Du bist abgemeldet.");
    } else if (target.hasAttribute("data-edit")) {
      const product = state.products.find(
        (p) => p.id === Number(target.dataset.edit),
      );
      const form = $("#product-form");
      for (const key of ["id", "name", "description", "category"])
        form.elements[key].value = product[key];
      form.elements.price.value = (product.price_cents / 100)
        .toFixed(2)
        .replace(".", ",");
      $("#product-form-heading").textContent = "Produkt bearbeiten";
      $("#product-submit").textContent = "Änderungen speichern";
      $("#reset-product").hidden = false;
      showProductPhotoForm(product);
      form.elements.name.focus();
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (target.id === "reset-product") {
      $("#product-form").reset();
      $("#product-form").elements.id.value = "";
      $("#product-form-heading").textContent = "Produkt hinzufügen";
      $("#product-submit").textContent = "Produkt hinzufügen";
      target.hidden = true;
      $("#product-photo-form").hidden = true;
    } else if (target.id === "remove-product-photo") {
      await changeProductPhoto($("#product-photo-form"), "DELETE");
    } else if (target.hasAttribute("data-delete")) {
      const product = state.products.find(
        (p) => p.id === Number(target.dataset.delete),
      );
      if (
        !confirm(
          `„${product.name}“ aus dem Shop entfernen? Bestehende Bestellungen bleiben erhalten.`,
        )
      )
        return;
      await api(`/products/${product.id}`, { method: "DELETE", body: {} });
      await render();
      notify("Produkt entfernt.");
    }
  } catch (error) {
    notify(error.message, true);
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "product-search") {
    state.search = event.target.value;
    filterProducts();
  }
});
document.addEventListener("change", async (event) => {
  const target = event.target;
  if (target.hasAttribute("data-quantity")) {
    const item = state.cart.find(
      (p) => p.productId === Number(target.dataset.quantity),
    );
    const quantity = Number(target.value);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      target.value = item.quantity;
      return notify("Bitte eine Menge von 1 bis 99 eingeben.", true);
    }
    item.quantity = quantity;
    saveCart();
    renderCart();
  }
  if (target.hasAttribute("data-order-status")) {
    target.disabled = true;
    try {
      await api(`/admin/orders/${target.dataset.orderStatus}`, {
        method: "PATCH",
        body: { status: target.value },
      });
      const badge = target.closest(".order-card").querySelector(".badge");
      badge.className = `badge ${target.value}`;
      badge.textContent = target.selectedOptions[0].textContent;
      notify("Bestellstatus aktualisiert.");
    } catch (error) {
      const badge = target.closest(".order-card").querySelector(".badge");
      target.value = ["pending", "shipped", "completed"].find((status) =>
        badge.classList.contains(status),
      );
      notify(error.message, true);
    } finally {
      target.disabled = false;
    }
  }
});
document.addEventListener("submit", async (event) => {
  const form = event.target;
  const formId = form.getAttribute("id");
  if (formId === "product-photo-form") {
    event.preventDefault();
    await changeProductPhoto(form, "POST");
    return;
  }
  if (!["profile-form", "product-form", "import-form"].includes(formId)) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const formData = new FormData(form);
  const data =
    formId === "import-form" ? formData : Object.fromEntries(formData);
  try {
    if (formId === "import-form") {
      form.querySelector("#import-error").textContent = "";
      form.querySelector(".import-success")?.remove();
      state.importResult = null;
      state.importResult = await api("/admin/import/products", {
        method: "POST",
        body: data,
      });
      await render();
      notify("Produktdatei erfolgreich importiert.");
    } else if (formId === "profile-form") {
      const result = await api("/profile", { method: "PATCH", body: data });
      state.user = result.user;
      await render();
      notify("Deine Daten wurden gespeichert.");
    } else {
      await api(data.id ? `/products/${data.id}` : "/products", {
        method: data.id ? "PATCH" : "POST",
        body: data,
      });
      await render();
      notify("Produkt gespeichert.");
    }
  } catch (error) {
    if (formId === "import-form")
      form.querySelector("#import-error").textContent = error.message;
    else notify(error.message, true);
  } finally {
    button.disabled = false;
  }
});
window.addEventListener("hashchange", () => {
  render();
  if (location.hash !== "#catalog") window.scrollTo(0, 0);
});

async function start() {
  try {
    Object.assign(state, await api("/session"));
    await render();
  } catch (error) {
    main.innerHTML = empty(
      "Der Shop ist gerade nicht erreichbar.",
      escape(error.message),
      '<a class="button" href="/">Neu laden</a>',
    );
  }
}
start();
