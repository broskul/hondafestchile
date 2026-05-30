(() => {
  const CART_KEY = "hfc_cart";
  const BUYER_KEY = "hfc_buyer";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function formatCurrency(value) {
    return new Intl.NumberFormat("es-CL", {
      style: "currency",
      currency: "CLP",
      maximumFractionDigits: 0
    }).format(value || 0);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.message || "No se pudo completar la accion");
    }
    return data;
  }

  function setStatus(element, html, isError = false) {
    if (!element) return;
    element.hidden = false;
    element.classList.toggle("error", isError);
    element.innerHTML = html;
  }

  function toast(message) {
    let node = $("#toast");
    if (!node) {
      node = document.createElement("div");
      node.id = "toast";
      node.className = "toast";
      node.setAttribute("role", "status");
      node.setAttribute("aria-live", "polite");
      document.body.appendChild(node);
    }

    node.textContent = message;
    node.hidden = false;
    clearTimeout(window.__hfcToastTimer);
    window.__hfcToastTimer = setTimeout(() => {
      node.hidden = true;
    }, 5200);
  }

  async function getCatalog() {
    if (!window.__hfcCatalog) {
      window.__hfcCatalog = api("/api/catalog");
    }
    return window.__hfcCatalog;
  }

  function ticketAvailability(ticket, eventId) {
    return (
      ticket?.availabilityByEvent?.[eventId] || {
        price: ticket?.price || 0,
        maxQuantity: ticket?.maxQuantity || 1,
        salePhaseId: ticket?.salePhaseId || null,
        salePhaseName: ticket?.salePhaseName || "No disponible",
        salePhaseKind: ticket?.salePhaseKind || null,
        saleRemaining: ticket?.saleRemaining,
        available: Boolean(ticket?.available)
      }
    );
  }

  function readCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    updateCartBadge();
  }

  function lineKey(item) {
    return `${item.eventId}::${item.ticketTypeId}`;
  }

  function addToCart(item) {
    const cart = readCart();
    const existing = cart.find((candidate) => lineKey(candidate) === lineKey(item));
    if (existing) {
      existing.quantity += Number(item.quantity || 1);
    } else {
      cart.push({
        eventId: item.eventId,
        ticketTypeId: item.ticketTypeId,
        quantity: Number(item.quantity || 1)
      });
    }
    saveCart(cart);
    toast("Entrada agregada al carrito.");
    openCartDrawer();
  }

  function removeFromCart(eventId, ticketTypeId) {
    saveCart(readCart().filter((item) => item.eventId !== eventId || item.ticketTypeId !== ticketTypeId));
  }

  function clearCart() {
    saveCart([]);
  }

  function updateQuantity(eventId, ticketTypeId, quantity) {
    const safeQuantity = Math.max(1, Number(quantity || 1));
    const cart = readCart().map((item) =>
      item.eventId === eventId && item.ticketTypeId === ticketTypeId ? { ...item, quantity: safeQuantity } : item
    );
    saveCart(cart);
  }

  function getBuyer() {
    try {
      return JSON.parse(localStorage.getItem(BUYER_KEY) || "null");
    } catch {
      return null;
    }
  }

  function saveBuyer(buyer) {
    localStorage.setItem(BUYER_KEY, JSON.stringify(buyer));
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };
      return entities[char];
    });
  }

  function updateEmailCheck(form) {
    const check = $("[data-email-check]", form);
    if (!check || !form.email) return;
    const email = String(form.email.value || "").trim();
    if (!email) {
      check.hidden = true;
      check.classList.remove("valid", "invalid");
      check.textContent = "";
      return;
    }

    const ok = validEmail(email);
    check.hidden = false;
    check.classList.toggle("valid", ok);
    check.classList.toggle("invalid", !ok);
    check.innerHTML = ok ? "<strong>Email verificado</strong>" : "<strong>Revisa el formato del correo</strong>";
  }

  function mountEmailChecks(root = document) {
    $$("[data-checkout-form]", root).forEach((form) => {
      if (!form.email || form.dataset.emailCheckMounted === "1") return;
      form.dataset.emailCheckMounted = "1";
      form.email.addEventListener("input", () => updateEmailCheck(form));
      form.email.addEventListener("blur", () => updateEmailCheck(form));
      updateEmailCheck(form);
    });
  }

  function loadMercadoPagoSdk() {
    if (window.MercadoPago) return Promise.resolve();
    if (window.__hfcMercadoPagoSdkPromise) return window.__hfcMercadoPagoSdkPromise;

    window.__hfcMercadoPagoSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://sdk.mercadopago.com/js/v2";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("No se pudo cargar Mercado Pago"));
      document.head.appendChild(script);
    });

    return window.__hfcMercadoPagoSdkPromise;
  }

  async function destroyMercadoPagoBrick() {
    if (!window.__hfcCardPaymentBrickController) return;
    try {
      await window.__hfcCardPaymentBrickController.unmount();
    } catch {
      // Mercado Pago may already have destroyed the iframe.
    }
    window.__hfcCardPaymentBrickController = null;
  }

  async function cartDetails() {
    const catalog = await getCatalog();
    return readCart()
      .map((item) => {
        const event = catalog.events.find((candidate) => candidate.id === item.eventId);
        const ticket = catalog.ticketTypes.find((candidate) => candidate.id === item.ticketTypeId);
        if (!event || !ticket) return null;
        const availability = ticketAvailability(ticket, event.id);
        const maxQuantity = availability.maxQuantity || ticket.maxQuantity;
        const unitPrice = availability.price ?? ticket.price;
        const quantity = Math.min(Math.max(1, Number(item.quantity || 1)), maxQuantity);
        return {
          ...item,
          quantity,
          eventName: event.name,
          ticketTypeName: ticket.name,
          description: ticket.description,
          unitPrice,
          total: unitPrice * quantity,
          maxQuantity
        };
      })
      .filter(Boolean);
  }

  function updateCartBadge() {
    const count = readCart().reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    $$("[data-cart-count]").forEach((node) => {
      node.textContent = String(count);
    });
  }

  async function renderCart(container, options = {}) {
    if (!container) return;
    const details = await cartDetails();
    const total = details.reduce((sum, item) => sum + item.total, 0);

    if (!details.length) {
      container.innerHTML = `<div class="empty-state">Tu carrito esta vacio.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="cart-lines">
        ${details
          .map(
            (item) => `
              <article class="cart-line">
                <div>
                  <strong>${item.ticketTypeName}</strong>
                  <span>${item.eventName}</span>
                  <small>${formatCurrency(item.unitPrice)} c/u</small>
                </div>
                <label>
                  Cant.
                  <input class="cart-qty" type="number" min="1" max="${item.maxQuantity}" value="${item.quantity}"
                    data-event-id="${item.eventId}" data-ticket-type-id="${item.ticketTypeId}" />
                </label>
                <strong>${formatCurrency(item.total)}</strong>
                <button class="icon-button" type="button" data-cart-remove data-event-id="${item.eventId}"
                  data-ticket-type-id="${item.ticketTypeId}" aria-label="Quitar">x</button>
              </article>
            `
          )
          .join("")}
      </div>
      <div class="cart-total">
        <span>Total</span>
        <strong>${formatCurrency(total)}</strong>
      </div>
      ${options.full ? "" : `<a class="button secondary full" href="/carrito">Abrir carrito completo</a>`}
    `;

    $$(".cart-qty", container).forEach((input) => {
      input.addEventListener("change", async () => {
        updateQuantity(input.dataset.eventId, input.dataset.ticketTypeId, input.value);
        await renderAllCarts();
      });
    });

    $$("[data-cart-remove]", container).forEach((button) => {
      button.addEventListener("click", async () => {
        removeFromCart(button.dataset.eventId, button.dataset.ticketTypeId);
        await renderAllCarts();
      });
    });
  }

  async function renderAllCarts() {
    await Promise.all(
      $$("[data-cart-list]").map((container) =>
        renderCart(container, { full: container.dataset.cartList === "full" })
      )
    );
    updateCartBadge();
  }

  function buyerFromForm(form) {
    return {
      email: String(form.email.value || "").trim().toLowerCase(),
      termsAccepted: Boolean(form.termsAccepted?.checked)
    };
  }

  async function checkoutCart(form, statusElement) {
    const items = readCart();
    if (!items.length) {
      setStatus(statusElement, "Agrega al menos una entrada al carrito.", true);
      return;
    }

    const catalog = await getCatalog();
    if (catalog.integrations?.paymentMode !== "demo" && catalog.integrations?.checkoutStorageReady === false) {
      setStatus(
        statusElement,
        "La venta online esta casi lista. Falta conectar la base persistente antes de aceptar pagos.",
        true
      );
      return;
    }

    const buyer = buyerFromForm(form);
    if (!validEmail(buyer.email)) {
      setStatus(statusElement, "Ingresa un correo valido para recibir tus entradas.", true);
      return;
    }
    if (!buyer.termsAccepted) {
      setStatus(statusElement, "Acepta terminos y condiciones para continuar.", true);
      return;
    }
    saveBuyer(buyer);
    setStatus(statusElement, "Reservando tu carrito...");

    const data = await api("/api/orders/from-cart", {
      method: "POST",
      body: JSON.stringify({
        ...buyer,
        items
      })
    });

    if (data.paymentMode === "mercadopago_api") {
      await renderInternalPayment(statusElement, data);
      return;
    }

    if (data.paymentMode === "mercadopago") {
      setStatus(
        statusElement,
        `<strong>Email verificado.</strong><br />Te llevamos a Mercado Pago. Los datos del asistente se completan despues del pago.
        <div class="status-actions"><a class="button primary" href="${data.checkoutUrl}">Pagar</a></div>`
      );
      window.location.href = data.checkoutUrl;
      return;
    }

    setStatus(
      statusElement,
      `<strong>Orden demo creada.</strong><br />Total: ${formatCurrency(data.order.total)}
      <div class="status-actions"><button class="button primary" type="button" data-demo-pay="${data.order.id}">Confirmar pago</button></div>`
    );

    $(`[data-demo-pay="${data.order.id}"]`, statusElement)?.addEventListener("click", async () => {
      setStatus(statusElement, "Confirmando pago y emitiendo tickets...");
      const paid = await api(`/api/orders/${data.order.id}/simulate-payment`, {
        method: "POST",
        body: JSON.stringify({})
      });
      await renderOrderResult(statusElement, paid);
    });
  }

  async function renderInternalPayment(statusElement, data) {
    const order = data.order;
    const publicKey = data.mercadoPagoPublicKey || (await getCatalog()).integrations?.mercadoPagoPublicKey;
    if (!order || !publicKey) {
      setStatus(statusElement, "Mercado Pago no esta listo para pago interno.", true);
      return;
    }

    await destroyMercadoPagoBrick();
    const containerId = `cardPaymentBrick_${order.id}`;
    const feedbackId = `cardPaymentFeedback_${order.id}`;
    setStatus(
      statusElement,
      `<strong>Email verificado.</strong><br />Paga aqui mismo con tarjeta. Los datos del asistente se completan despues del pago.
      <div class="internal-payment-shell">
        <div id="${containerId}" class="mp-card-brick"></div>
        <div id="${feedbackId}" class="payment-inline-status" role="status" aria-live="polite">Preparando pago seguro...</div>
      </div>`
    );

    const feedback = document.getElementById(feedbackId);

    try {
      await loadMercadoPagoSdk();
      const mp = new window.MercadoPago(publicKey, { locale: "es-CL" });
      const bricksBuilder = mp.bricks();
      const idempotencyKey = `${order.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      window.__hfcCardPaymentBrickController = await bricksBuilder.create("cardPayment", containerId, {
        initialization: {
          amount: Number(order.total || 0)
        },
        callbacks: {
          onReady: () => {
            if (feedback) feedback.textContent = "Completa los datos de la tarjeta para confirmar.";
          },
          onSubmit: (formData) =>
            new Promise(async (resolve, reject) => {
              try {
                if (feedback) feedback.textContent = "Procesando pago...";
                const result = await api(`/api/orders/${order.id}/pay`, {
                  method: "POST",
                  headers: {
                    "x-idempotency-key": idempotencyKey
                  },
                  body: JSON.stringify({ formData })
                });
                resolve();
                await renderOrderResult(statusElement, result);
              } catch (error) {
                if (feedback) feedback.textContent = error.message;
                reject(error);
              }
            }),
          onError: (error) => {
            if (feedback) {
              feedback.textContent = error?.message || "Mercado Pago no pudo mostrar el formulario.";
            }
          }
        }
      });
    } catch (error) {
      setStatus(statusElement, error.message, true);
    }
  }

  function profileFormHtml(orderId, user = {}) {
    return `
      <form class="profile-completion-form" data-profile-completion data-order-id="${escapeHtml(orderId)}">
        <label>Correo
          <input name="email" type="email" required readonly value="${escapeHtml(user.email || "")}" />
        </label>
        <label>Nombre completo
          <input name="name" autocomplete="name" required value="${escapeHtml(user.name || "")}" placeholder="Nombre y apellido" />
        </label>
        <label>RUT
          <input name="rut" required value="${escapeHtml(user.rut || "")}" placeholder="12.345.678-5" />
        </label>
        <label>Telefono
          <input name="phone" autocomplete="tel" required value="${escapeHtml(user.phone || "")}" placeholder="+56 9 1234 5678" />
        </label>
        <label>Vehiculo
          <input name="vehicle" value="${escapeHtml(user.vehicle || "")}" placeholder="Civic, Integra, S2000..." />
        </label>
        <label>Club o equipo
          <input name="club" value="${escapeHtml(user.club || "")}" placeholder="Club, team o independiente" />
        </label>
        <button class="button primary full" type="submit">Emitir entradas</button>
      </form>
    `;
  }

  function mountProfileCompletion(statusElement) {
    const form = $("[data-profile-completion]", statusElement);
    if (!form || form.dataset.mounted === "1") return;
    form.dataset.mounted = "1";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector("button[type='submit']");
      submit.disabled = true;
      setStatus(statusElement, "Guardando datos y emitiendo entradas...");
      try {
        const payload = Object.fromEntries(new FormData(form).entries());
        const data = await api(`/api/orders/${form.dataset.orderId}/profile`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        await renderOrderResult(statusElement, data);
      } catch (error) {
        const payload = Object.fromEntries(new FormData(form).entries());
        setStatus(
          statusElement,
          `<strong>${escapeHtml(error.message)}</strong>${profileFormHtml(form.dataset.orderId, payload)}`,
          true
        );
        mountProfileCompletion(statusElement);
      } finally {
        submit.disabled = false;
      }
    });
  }

  async function renderOrderResult(statusElement, data) {
    await destroyMercadoPagoBrick();
    const order = data.order;
    if (!order) return;
    if (data.user?.email) {
      saveBuyer({
        email: data.user.email,
        rut: data.user.rut || "",
        termsAccepted: true
      });
    }

    if (order.profileRequired) {
      clearCart();
      await renderAllCarts();
      setStatus(
        statusElement,
        `<strong>Pago recibido.</strong><br />Completa los datos del asistente para emitir entradas y boleta.
        ${profileFormHtml(order.id, data.user || {})}`
      );
      mountProfileCompletion(statusElement);
      return;
    }

    if (order.status === "paid") {
      clearCart();
      await renderAllCarts();
      const tickets = data.tickets || [];
      setStatus(
        statusElement,
        `<strong>Compra confirmada.</strong><br />${tickets
          .map((ticket) => `<code>${ticket.code}</code>`)
          .join(" ")}
        <div class="status-actions"><a class="button secondary" href="/mis-compras">Ver mis entradas</a></div>`
      );
      return;
    }

    const label = order.status === "payment_failed" ? "Pago rechazado" : "Pago pendiente";
    setStatus(statusElement, `<strong>${label}.</strong><br />Orden ${order.id}: ${order.status}.`, order.status === "payment_failed");
  }

  async function inspectCheckoutReturn() {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment") || params.get("status") || params.get("collection_status");
    const orderId = params.get("order") || params.get("external_reference");
    if (!payment || !orderId) return;

    const statusElement = $("#checkoutStatus") || $("[data-checkout-status]");
    if (!statusElement) return;

    setStatus(statusElement, "Consultando estado de la orden...");
    try {
      const data = await api(`/api/orders/${orderId}`);
      await renderOrderResult(statusElement, data);
    } catch (error) {
      setStatus(statusElement, error.message, true);
    }
  }

  function prefillBuyerForms() {
    const buyer = getBuyer();
    if (!buyer) return;
    $$("[data-checkout-form]").forEach((form) => {
      if (form.email) form.email.value = buyer.email || "";
      updateEmailCheck(form);
    });
  }

  function openCartDrawer() {
    const drawer = $("#cartDrawer");
    if (!drawer) return;
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    renderAllCarts();
  }

  function closeCartDrawer() {
    const drawer = $("#cartDrawer");
    if (!drawer) return;
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }

  function mountCartDrawer() {
    if ($("#cartDrawer")) return;
    const drawer = document.createElement("aside");
    drawer.id = "cartDrawer";
    drawer.className = "cart-drawer";
    drawer.setAttribute("aria-hidden", "true");
    drawer.innerHTML = `
      <div class="cart-backdrop" data-cart-close></div>
      <div class="cart-shell" role="dialog" aria-modal="true" aria-labelledby="cartDrawerTitle">
        <header class="cart-header">
          <div>
            <p class="section-kicker">Carrito</p>
            <h2 id="cartDrawerTitle">Tu seleccion</h2>
          </div>
          <button class="icon-button" type="button" data-cart-close aria-label="Cerrar">x</button>
        </header>
        <div data-cart-list></div>
        <form class="checkout-box" data-checkout-form>
          <label>
            Correo electronico
            <input name="email" type="email" required placeholder="tu@correo.cl" />
          </label>
          <label class="terms-check">
            <input name="termsAccepted" type="checkbox" required />
            <span>Acepto terminos y condiciones</span>
          </label>
          <div class="email-check" data-email-check hidden></div>
          <button class="button primary full" type="submit">Pagar ahora</button>
        </form>
        <div class="status-box" data-checkout-status hidden></div>
      </div>
    `;
    document.body.appendChild(drawer);

    $$("[data-cart-close]", drawer).forEach((node) => node.addEventListener("click", closeCartDrawer));
    const form = $("[data-checkout-form]", drawer);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await checkoutCart(form, $("[data-checkout-status]", drawer));
      } catch (error) {
        setStatus($("[data-checkout-status]", drawer), error.message, true);
      }
    });
    prefillBuyerForms();
    mountEmailChecks(drawer);
    renderAllCarts();
  }

  document.addEventListener("DOMContentLoaded", () => {
    mountCartDrawer();
    updateCartBadge();
    prefillBuyerForms();
    mountEmailChecks();
    inspectCheckoutReturn();
    $$("[data-cart-open]").forEach((button) => button.addEventListener("click", openCartDrawer));
  });

  window.HFC = {
    $,
    $$,
    addToCart,
    api,
    cartDetails,
    checkoutCart,
    clearCart,
    formatCurrency,
    getCatalog,
    ticketAvailability,
    openCartDrawer,
    prefillBuyerForms,
    renderAllCarts,
    setStatus,
    toast
  };
})();
