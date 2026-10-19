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
  authMode: "login",
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
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": state.csrfToken,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Die Anfrage ist fehlgeschlagen.");
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
function addToCart(productId) {
  const item = state.cart.find((p) => p.productId === productId);
  if (item?.quantity >= 99)
    return notify("Maximal 99 Stück pro Produkt.", true);
  if (item) item.quantity++;
  else state.cart.push({ productId, quantity: 1 });
  saveCart();
  notify("Zum Warenkorb hinzugefügt.");
}

function illustration(product) {
  const name = product.name.toLowerCase();
  let drawing;
  let theme;
  if (name.includes("kopfhörer")) {
    theme = "sage";
    drawing =
      '<path d="M66 112V88a54 54 0 0 1 108 0v24" fill="none" stroke="#304d44" stroke-width="16"/><path d="M66 99V84a54 54 0 0 1 108 0v15" fill="none" stroke="#729083" stroke-width="5"/><rect x="48" y="98" width="35" height="58" rx="16" fill="#304d44"/><rect x="157" y="98" width="35" height="58" rx="16" fill="#304d44"/><rect x="54" y="104" width="16" height="44" rx="8" fill="#617b70"/><rect x="170" y="104" width="16" height="44" rx="8" fill="#617b70"/>';
  } else if (name.includes("notiz")) {
    theme = "peach";
    drawing =
      '<g transform="rotate(-12 120 100)"><rect x="72" y="27" width="103" height="146" rx="6" fill="#a55e3c"/><path d="M83 30v140" stroke="#d08a60" stroke-width="3"/><path d="M92 168h76" stroke="#f5ead8" stroke-width="5"/><rect x="153" y="27" width="6" height="139" fill="#6e3f2a"/><text x="101" y="88" font-size="12" letter-spacing="3" fill="#f2d0a2" font-family="sans-serif">NOTES</text><path d="M111 105h30" stroke="#d8ae82"/></g>';
  } else if (name.includes("tasse")) {
    theme = "sand";
    drawing =
      '<path d="M151 79h15c37 0 34 58 0 58h-15" fill="none" stroke="#b18159" stroke-width="14"/><path d="M68 72h89v66a29 29 0 0 1-29 29H97a29 29 0 0 1-29-29z" fill="#bf946d"/><ellipse cx="112.5" cy="73" rx="44.5" ry="10" fill="#d8b493"/><ellipse cx="112.5" cy="74" rx="35" ry="6" fill="#5d4232"/><path d="M90 95v37" stroke="#d3ad88" stroke-width="6" stroke-linecap="round"/>';
  } else if (name.includes("tastatur")) {
    theme = "blue";
    drawing =
      '<g transform="rotate(-10 120 100)"><rect x="25" y="63" width="190" height="92" rx="9" fill="#52636b"/><rect x="28" y="60" width="184" height="89" rx="9" fill="#c3ccce"/>' +
      Array.from(
        { length: 40 },
        (_, i) =>
          `<rect x="${36 + (i % 10) * 17}" y="${69 + Math.floor(i / 10) * 17}" width="13" height="12" rx="2" fill="${i % 9 === 0 ? "#7e9a98" : "#edf1ef"}"/>`,
      ).join("") +
      '<rect x="83" y="123" width="65" height="12" rx="2" fill="#edf1ef"/></g>';
  } else if (name.includes("lampe")) {
    theme = "yellow";
    drawing =
      '<ellipse cx="120" cy="171" rx="45" ry="8" fill="#a98c40"/><path d="M120 166v-57l31-54" stroke="#4a5543" stroke-width="8" fill="none"/><circle cx="120" cy="110" r="7" fill="#6b7455"/><path d="M125 43q21-13 40 8l16 29-66-3z" fill="#738062"/><path d="M117 78h61l-13 36h-41z" fill="#f1d980" opacity=".4"/><ellipse cx="148" cy="78" rx="33" ry="7" fill="#ded3a0"/>';
  } else if (name.includes("rucksack")) {
    theme = "rose";
    drawing =
      '<path d="M101 42v-8q19-18 38 0v8" stroke="#615b4d" stroke-width="8" fill="none"/><path d="M70 83q0-42 50-42t50 42v77q0 12-14 12H84q-14 0-14-12z" fill="#7c8069"/><path d="M79 81q0-30 41-30t41 30" stroke="#a2a48b" stroke-width="3" fill="none"/><rect x="85" y="111" width="70" height="48" rx="9" fill="#656e58"/><path d="M92 120h56" stroke="#b3b49b" stroke-width="3"/><rect x="109" y="79" width="22" height="12" rx="2" fill="#c5ac7e"/>';
  } else {
    theme = "sage";
    drawing =
      '<path d="m65 73 55-28 55 28v73l-55 28-55-28z" fill="#7e9c8c"/><path d="m65 73 55 28 55-28M120 101v73M92 59l55 28" fill="none" stroke="#d9e6de" stroke-width="3"/>';
  }
  return `<div class="product-art ${theme}" aria-hidden="true"><svg viewBox="0 0 240 200"><ellipse cx="120" cy="177" rx="72" ry="7" fill="#000" opacity=".055"/>${drawing}</svg></div>`;
}

function productCard(p) {
  return `<article class="product-card">${illustration(p)}<div class="product-info"><span class="eyebrow">${escape(p.category)}</span><h3>${escape(p.name)}</h3><p>${escape(p.description)}</p><div class="product-bottom"><strong>${money(p.price_cents)}</strong><button class="add-button" data-add="${p.id}" aria-label="${escape(p.name)} in den Warenkorb"><span aria-hidden="true">+</span> Hinzufügen</button></div></div></article>`;
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
    '<p class="empty-inline">Keine Produkte gefunden. Probiere einen anderen Suchbegriff.</p>';
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
      : `<div class="cart-layout"><section class="cart-items" aria-label="Warenkorbpositionen">${rows.map((item) => `<article class="cart-row">${item.product ? illustration(item.product) : '<div class="unavailable-art">?</div>'}<div class="cart-product"><h3>${escape(item.product?.name || "Produkt nicht mehr verfügbar")}</h3><p class="muted">${item.product ? `${money(item.product.price_cents)} / Stück` : "Bitte aus dem Warenkorb entfernen."}</p><button class="text-button remove" data-remove="${item.productId}">Entfernen</button></div><label class="quantity">Menge<input type="number" min="1" max="99" value="${item.quantity}" data-quantity="${item.productId}" aria-label="Menge für ${escape(item.product?.name || "entferntes Produkt")}"></label><strong>${item.product ? money(item.product.price_cents * item.quantity) : "—"}</strong></article>`).join("")}</section><aside class="summary"><h2>Deine Bestellung</h2><div class="summary-line"><span>Zwischensumme</span><span>${money(total)}</span></div><div class="summary-line"><span>Versand</span><span>Kostenlos</span></div><div class="summary-line total"><span>Gesamt</span><strong>${money(total)}</strong></div>${state.user ? `<div class="shipping"><span class="eyebrow">LIEFERUNG AN</span><strong>${escape(state.user.name)}</strong><p>${escape(state.user.address)}</p><a href="#account">Adresse bearbeiten</a></div><button class="button full" id="checkout" ${rows.some((i) => !i.product) ? "disabled" : ""}>Jetzt bestellen <span aria-hidden="true">↗</span></button><p class="small muted">Übungs-Shop: Es erfolgt keine Zahlung und kein tatsächlicher Versand.</p>` : '<p class="muted">Melde dich an oder erstelle ein Konto, um zu bestellen.</p><button class="button full" data-open-auth>Anmelden & bestellen</button>'}</aside></div>`);
}
function orderCard(order, admin = false) {
  const labels = {
    pending: "Offen",
    shipped: "Versendet",
    completed: "Abgeschlossen",
  };
  return `<article class="order-card"><div class="order-head"><div><span class="eyebrow">BESTELLUNG #${String(order.id).padStart(4, "0")}</span><h3>${new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(order.created_at))}</h3></div><span class="badge ${escape(order.status)}">${labels[order.status]}</span></div>${admin ? `<p class="muted">${escape(order.customer_name)} · ${escape(order.customer_email)}</p>` : ""}<ul class="order-items">${order.items.map((item) => `<li><span>${item.quantity} × ${escape(item.product_name)}</span><strong>${money(item.unit_price_cents * item.quantity)}</strong></li>`).join("")}</ul><div class="order-foot"><span class="muted address">${escape(order.shipping_address)}</span><strong>Gesamt ${money(order.total_cents)}</strong></div>${
    admin
      ? `<label class="status-control">Bestellstatus<select aria-label="Bestellstatus" data-order-status="${order.id}">${Object.entries(
          labels,
        )
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
        '<button class="button" data-open-auth>Anmelden oder registrieren</button>',
      );
    return;
  }
  main.innerHTML =
    heading(
      "DEIN KONTO",
      "Hallo, " + escape(state.user.name) + ".",
      "Hier kannst du deine persönlichen Daten und deine Lieferadresse ändern.",
    ) +
    `<div class="account-layout"><form id="profile-form" class="panel"><h2>Persönliche Daten</h2><label>Name<input name="name" required autocomplete="name" maxlength="100" value="${escape(state.user.name)}"></label><label>E-Mail<input name="email" type="email" required autocomplete="email" maxlength="254" value="${escape(state.user.email)}"></label><label>Lieferadresse<textarea name="address" required autocomplete="street-address" maxlength="500" rows="4">${escape(state.user.address)}</textarea></label><button class="button" type="submit">Änderungen speichern</button></form><aside class="panel account-aside"><span class="eyebrow">GUT ZU WISSEN</span><h2>Deine nächste Bestellung?</h2><p class="muted">Deine Lieferadresse wird beim Bestellen übernommen. Bereits aufgegebene Bestellungen behalten die damalige Adresse.</p><a href="#orders">Meine Bestellungen ansehen ↗</a><hr><button class="text-button" id="logout">Abmelden</button></aside></div>`;
}
function renderAdmin(orders) {
  main.innerHTML =
    heading(
      "VERWALTUNG",
      "Dein Shop im Überblick.",
      "Produkte pflegen und Bestellungen bearbeiten.",
    ) +
    `<div class="admin-layout"><section class="panel"><h2 id="product-form-heading">Produkt hinzufügen</h2><form id="product-form"><input type="hidden" name="id"><label>Produktname<input name="name" required maxlength="100"></label><label>Beschreibung<textarea name="description" required maxlength="1000" rows="3"></textarea></label><div class="form-columns"><label>Preis in €<input name="price" inputmode="decimal" required placeholder="19,90" pattern="[0-9]{1,6}([.,][0-9]{1,2})?"></label><label>Kategorie<input name="category" required maxlength="50" list="categories"><datalist id="categories"><option value="Technik"><option value="Schreibtisch"><option value="Alltag"></datalist></label></div><div class="form-actions"><button class="button" type="submit" id="product-submit">Produkt hinzufügen</button><button class="quiet" type="button" id="reset-product" hidden>Abbrechen</button></div></form></section><section class="panel"><h2>Produkte <span class="muted">(${state.products.length})</span></h2><div class="manage-products">${state.products.map((p) => `<div class="manage-row"><div><strong>${escape(p.name)}</strong><span class="muted">${money(p.price_cents)} · ${escape(p.category)}</span></div><div class="manage-actions"><button class="text-button" data-edit="${p.id}">Bearbeiten</button><button class="text-button remove" data-delete="${p.id}" aria-label="${escape(p.name)} entfernen">Entfernen</button></div></div>`).join("") || '<p class="muted">Noch keine Produkte angelegt.</p>'}</div></section></div><section class="admin-orders"><div class="section-heading"><h2>Alle Bestellungen</h2><span class="muted">${orders.length} ${orders.length === 1 ? "Bestellung" : "Bestellungen"}</span></div>${orders.length ? `<div class="order-grid">${orders.map((order) => orderCard(order, true)).join("")}</div>` : '<p class="muted">Es sind noch keine Bestellungen eingegangen.</p>'}</section>`;
}

async function render() {
  const version = ++renderVersion;
  updateHeader();
  const page = location.hash.slice(1) || "products";
  try {
    if (page === "cart") renderCart();
    else if (page === "account") renderAccount();
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
      const orders = await api(page === "admin" ? "/admin/orders" : "/orders");
      if (version !== renderVersion) return;
      if (page === "admin") renderAdmin(orders);
      else
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
    } else {
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

function setAuthMode(mode) {
  state.authMode = mode;
  const register = mode === "register";
  $("#auth-heading").textContent = register
    ? "Dein Alltag. Dein Konto."
    : "Willkommen zurück.";
  $("#auth-description").textContent = register
    ? "Erstelle dein Konto und entdecke deine Lieblingsstücke."
    : "Melde dich an, um deine Bestellung abzuschließen.";
  $("#register-name").hidden = !register;
  $("#register-address").hidden = !register;
  $("#auth-form").elements.name.required = register;
  $("#auth-form").elements.address.required = register;
  $("#auth-form").elements.password.minLength = register ? 10 : 1;
  $("#auth-form").elements.password.autocomplete = register
    ? "new-password"
    : "current-password";
  $("#auth-submit").textContent = register ? "Konto erstellen" : "Anmelden";
  $("#toggle-auth").textContent = register
    ? "Schon ein Konto? Anmelden"
    : "Neu hier? Konto erstellen";
  $("#auth-error").textContent = "";
}
function openAuth() {
  setAuthMode("login");
  $("#auth-dialog").showModal();
}
$("#account-button").addEventListener("click", () => {
  if (state.user) location.hash = "account";
  else openAuth();
});
$("#close-auth").addEventListener("click", () => $("#auth-dialog").close());
$("#toggle-auth").addEventListener("click", () =>
  setAuthMode(state.authMode === "login" ? "register" : "login"),
);
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
$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#auth-submit");
  button.disabled = true;
  $("#auth-error").textContent = "";
  try {
    const data = Object.fromEntries(new FormData(event.target));
    const result = await api(
      state.authMode === "login" ? "/login" : "/register",
      { method: "POST", body: data },
    );
    Object.assign(state, result);
    event.target.reset();
    $("#auth-dialog").close();
    notify("Du bist angemeldet. Schön, dass du da bist!");
    await render();
  } catch (error) {
    $("#auth-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  try {
    if (target.hasAttribute("data-add")) addToCart(Number(target.dataset.add));
    else if (target.hasAttribute("data-category")) {
      state.category = target.dataset.category;
      filterProducts();
    } else if (target.hasAttribute("data-open-auth")) openAuth();
    else if (target.hasAttribute("data-retry")) await render();
    else if (target.hasAttribute("data-remove")) {
      state.cart = state.cart.filter(
        (p) => p.productId !== Number(target.dataset.remove),
      );
      saveCart();
      renderCart();
    } else if (target.id === "checkout") {
      target.disabled = true;
      try {
        const order = await api("/orders", {
          method: "POST",
          body: { items: state.cart },
        });
        state.cart = [];
        saveCart();
        location.hash = "orders";
        notify(
          `Bestellung #${String(order.id).padStart(4, "0")} wurde aufgenommen.`,
        );
      } finally {
        target.disabled = false;
      }
    } else if (target.id === "logout") {
      await api("/logout", { method: "POST", body: {} });
      state.user = null;
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
      form.elements.name.focus();
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (target.id === "reset-product") {
      $("#product-form").reset();
      $("#product-form").elements.id.value = "";
      $("#product-form-heading").textContent = "Produkt hinzufügen";
      $("#product-submit").textContent = "Produkt hinzufügen";
      target.hidden = true;
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
      state.products = await api("/products");
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
  if (!["profile-form", "product-form"].includes(formId)) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (formId === "profile-form") {
      const result = await api("/profile", { method: "PATCH", body: data });
      state.user = result.user;
      await render();
      notify("Deine Daten wurden gespeichert.");
    } else {
      await api(data.id ? `/products/${data.id}` : "/products", {
        method: data.id ? "PATCH" : "POST",
        body: data,
      });
      state.products = await api("/products");
      await render();
      notify("Produkt gespeichert.");
    }
  } catch (error) {
    notify(error.message, true);
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
    const [session, products] = await Promise.all([
      api("/session"),
      api("/products"),
    ]);
    Object.assign(state, session, { products });
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
