const state = {
  events: [],
  ticketTypes: [],
  selectedOrderId: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - clamp(value), 3);
}

function easeInOutCubic(value) {
  const safe = clamp(value);
  return safe < 0.5 ? 4 * safe * safe * safe : 1 - Math.pow(-2 * safe + 2, 3) / 2;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function setStatus(element, html, isError = false) {
  element.hidden = false;
  element.classList.toggle("error", isError);
  element.innerHTML = html;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 5200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || "No se pudo completar la accion");
  }
  return data;
}

function renderEvents() {
  const grid = $("#eventGrid");
  if (!grid) return;
  grid.innerHTML = state.events
    .map(
      (event) => `
        <article class="event-card" data-accent="${event.accent}">
          <div>
            <p class="section-kicker">${event.eyebrow}</p>
            <h3>${event.name}</h3>
            <div class="event-meta">
              <span>${event.dateLabel}</span>
              <span>${event.venue}</span>
            </div>
            <p>${event.summary}</p>
          </div>
          <ul class="highlight-list">
            ${event.highlights.map((item) => `<li>${item}</li>`).join("")}
          </ul>
        </article>
      `
    )
    .join("");
}

function populateSelects() {
  const eventSelect = $("#eventSelect");
  const ticketSelect = $("#ticketSelect");
  if (!eventSelect || !ticketSelect) return;

  eventSelect.innerHTML = state.events.map((event) => `<option value="${event.id}">${event.name}</option>`).join("");
  ticketSelect.innerHTML = state.ticketTypes
    .map((ticket) => `<option value="${ticket.id}">${ticket.name} - ${formatCurrency(ticket.price)}</option>`)
    .join("");

  updateTotal();
}

function updateTotal() {
  if (!$("#ticketSelect") || !$("#quantityInput") || !$("#totalOutput")) return;
  const ticket = state.ticketTypes.find((item) => item.id === $("#ticketSelect").value);
  const quantityInput = $("#quantityInput");
  const quantity = Math.max(1, Number(quantityInput.value || 1));

  if (ticket) {
    quantityInput.max = ticket.maxQuantity;
    if (quantity > ticket.maxQuantity) {
      quantityInput.value = ticket.maxQuantity;
    }
  }

  const safeQuantity = Math.max(1, Number(quantityInput.value || 1));
  $("#totalOutput").textContent = formatCurrency((ticket?.price || 0) * safeQuantity);
}

function switchTab(tabName) {
  $$(".tab").forEach((button) => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  $("#registerPanel")?.classList.toggle("active", tabName === "register");
  $("#buyPanel")?.classList.toggle("active", tabName === "buy");
}

function formToJson(form) {
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  payload.interests = data.getAll("interests");
  return payload;
}

function rememberUser(user) {
  localStorage.setItem("hfc_user", JSON.stringify(user));
}

function loadRememberedUser() {
  try {
    return JSON.parse(localStorage.getItem("hfc_user") || "null");
  } catch {
    return null;
  }
}

function prefillOrderForm(user) {
  if (!user) return;
  const form = $("#orderForm");
  if (!form) return;
  form.email.value = user.email || "";
  form.rut.value = user.rut || "";
}

async function handleRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#registerStatus");
  const submit = form.querySelector("button[type='submit']");

  submit.disabled = true;
  setStatus(status, "Creando registro...");

  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(formToJson(form))
    });

    rememberUser(data.user);
    prefillOrderForm(data.user);

    const devButton = data.devVerificationUrl
      ? `<div class="status-actions"><a class="button secondary" href="${data.devVerificationUrl}">Confirmar correo</a></div>`
      : "";

    setStatus(
      status,
      `<strong>Registro creado.</strong><br />Revisa tu correo para confirmar el enrolamiento.${devButton}`
    );
    toast("Registro creado. Falta confirmar el correo.");
  } catch (error) {
    setStatus(status, error.message, true);
  } finally {
    submit.disabled = false;
  }
}

async function handleOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#orderStatus");
  const submit = form.querySelector("button[type='submit']");

  submit.disabled = true;
  setStatus(status, "Creando orden...");

  try {
    const payload = {
      eventId: form.eventId.value,
      ticketTypeId: form.ticketTypeId.value,
      quantity: Number(form.quantity.value),
      email: form.email.value,
      rut: form.rut.value
    };

    const data = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    state.selectedOrderId = data.order.id;

    if (data.paymentMode === "mercadopago") {
      setStatus(
        status,
        `<strong>Orden creada.</strong><br />Continua en Mercado Pago para finalizar la compra.
        <div class="status-actions"><a class="button primary" href="${data.checkoutUrl}">Pagar con Mercado Pago</a></div>`
      );
      window.location.href = data.checkoutUrl;
      return;
    }

    setStatus(
      status,
      `<strong>Orden creada.</strong><br />Total: ${formatCurrency(data.order.total)}.
      <div class="status-actions">
        <button class="button primary" type="button" id="simulatePaymentButton">Confirmar pago</button>
      </div>`
    );

    $("#simulatePaymentButton").addEventListener("click", simulatePayment);
  } catch (error) {
    setStatus(status, error.message, true);
  } finally {
    submit.disabled = false;
  }
}

async function simulatePayment() {
  const status = $("#orderStatus");
  if (!state.selectedOrderId) return;

  setStatus(status, "Confirmando pago y emitiendo tickets...");

  try {
    const data = await api(`/api/orders/${state.selectedOrderId}/simulate-payment`, {
      method: "POST",
      body: JSON.stringify({})
    });

    setStatus(
      status,
      `<strong>Compra confirmada.</strong><br />
      Tickets emitidos: ${data.tickets.map((ticket) => `<code>${ticket.code}</code>`).join(" ")}<br />
      Boleta: ${data.invoice.folio || data.invoice.providerId}`
    );
    toast("Entradas emitidas y correo enviado.");
  } catch (error) {
    setStatus(status, error.message, true);
  }
}

async function inspectReturnParams() {
  const params = new URLSearchParams(window.location.search);
  const verified = params.get("verified");
  const payment = params.get("payment");
  const orderId = params.get("order");

  if (verified === "1") {
    toast("Correo confirmado. Ya puedes comprar entradas.");
    if ($("#buyPanel")) switchTab("buy");
    const remembered = loadRememberedUser();
    if (remembered) {
      remembered.emailVerified = true;
      rememberUser(remembered);
      prefillOrderForm(remembered);
    }
  }

  if (payment && orderId) {
    if ($("#buyPanel")) switchTab("buy");
    const status = $("#orderStatus");
    if (!status) return;
    setStatus(status, "Consultando estado de la orden...");

    try {
      const data = await api(`/api/orders/${orderId}`);
      setStatus(
        status,
        `<strong>Estado de pago:</strong> ${payment}.<br />
        Orden ${data.order.id}: ${data.order.status}.`
      );
    } catch (error) {
      setStatus(status, error.message, true);
    }
  }
}

function initHeroDrive() {
  const hero = $(".hero-drive");
  if (!hero) return;

  const menuNode = $("#heroPlateMenu");
  const menuLinks = menuNode ? Array.from(menuNode.querySelectorAll("a")) : [];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let ticking = false;

  function setMenuFocus(enabled) {
    menuLinks.forEach((link) => {
      link.tabIndex = enabled ? 0 : -1;
    });
  }

  function render() {
    ticking = false;

    const rect = hero.getBoundingClientRect();
    const scrollable = Math.max(1, hero.offsetHeight - window.innerHeight);
    const progress = clamp(-rect.top / scrollable);
    const reduced = reduceMotion.matches;
    const drive = reduced ? 0.5 : easeInOutCubic(progress);
    const close = reduced ? 0 : easeOutCubic((progress - 0.08) / 0.88);
    const menuProgress = easeOutCubic((progress - 0.42) / 0.28);
    const contentOpacity = reduced ? 1 - menuProgress : 1 - easeOutCubic((progress - 0.08) / 0.32);
    const compact = window.innerWidth < 700;

    hero.style.setProperty("--content-opacity", contentOpacity.toFixed(3));
    hero.style.setProperty("--content-y", `${(1 - contentOpacity) * -34}px`);
    hero.style.setProperty("--media-scale", (1.04 + progress * 0.11).toFixed(3));
    hero.style.setProperty("--media-x", `${progress * (compact ? -8 : -22)}px`);
    hero.style.setProperty("--media-y", `${progress * -12}px`);
    hero.style.setProperty("--car-scroll-x", `${(drive - 0.5) * (compact ? 18 : 34)}px`);
    hero.style.setProperty("--car-scroll-y", `${close * (compact ? 48 : 74)}px`);
    hero.style.setProperty("--car-scroll-scale", (1 + close * (compact ? 0.82 : 1.14)).toFixed(3));
    hero.style.setProperty("--wheel-rotation", `${Math.round(progress * 820)}deg`);
    hero.style.setProperty("--plate-opacity", (1 - menuProgress).toFixed(3));
    hero.style.setProperty("--plate-scale", (1 + menuProgress * 3.2).toFixed(3));
    hero.style.setProperty("--menu-opacity", menuProgress.toFixed(3));
    hero.style.setProperty("--menu-y", `${(1 - menuProgress) * 105}%`);
    hero.style.setProperty("--menu-scale-x", (0.08 + menuProgress * 0.92).toFixed(3));
    hero.style.setProperty("--menu-scale-y", (0.16 + menuProgress * 0.84).toFixed(3));
    hero.style.setProperty("--menu-radius", `${Math.round((1 - menuProgress) * 8)}px`);

    const menuReady = menuProgress > 0.82;
    hero.dataset.menuReady = String(menuReady);
    hero.dataset.contentHidden = String(contentOpacity < 0.08);
    setMenuFocus(menuReady);
  }

  function queueRender() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(render);
  }

  window.addEventListener("scroll", queueRender, { passive: true });
  window.addEventListener("resize", queueRender);
  reduceMotion.addEventListener?.("change", queueRender);
  render();
}

async function init() {
  initHeroDrive();

  const catalog = await api("/api/catalog");
  state.events = catalog.events;
  state.ticketTypes = catalog.ticketTypes;
  renderEvents();
  if ($("#eventSelect")) {
    populateSelects();
    prefillOrderForm(loadRememberedUser());
  }

  $$(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  $("#ticketSelect")?.addEventListener("change", updateTotal);
  $("#quantityInput")?.addEventListener("input", updateTotal);
  $("#registerForm")?.addEventListener("submit", handleRegister);
  $("#orderForm")?.addEventListener("submit", handleOrder);

  inspectReturnParams();
}

init().catch((error) => {
  toast(error.message);
});
