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
      rut: String(form.rut.value || "").trim()
    };
  }

  async function checkoutCart(form, statusElement) {
    const items = readCart();
    if (!items.length) {
      setStatus(statusElement, "Agrega al menos una entrada al carrito.", true);
      return;
    }

    const buyer = buyerFromForm(form);
    saveBuyer(buyer);
    setStatus(statusElement, "Creando orden...");

    const data = await api("/api/orders/from-cart", {
      method: "POST",
      body: JSON.stringify({
        ...buyer,
        items
      })
    });

    if (data.paymentMode === "mercadopago") {
      setStatus(
        statusElement,
        `<strong>Orden creada.</strong><br />Continua en Mercado Pago.
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
      clearCart();
      await renderAllCarts();
      setStatus(
        statusElement,
        `<strong>Compra confirmada.</strong><br />${paid.tickets
          .map((ticket) => `<code>${ticket.code}</code>`)
          .join(" ")}
        <div class="status-actions"><a class="button secondary" href="/mis-compras">Ver mis entradas</a></div>`
      );
    });
  }

  function prefillBuyerForms() {
    const buyer = getBuyer();
    if (!buyer) return;
    $$("[data-checkout-form]").forEach((form) => {
      if (form.email) form.email.value = buyer.email || "";
      if (form.rut) form.rut.value = buyer.rut || "";
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
            Correo registrado
            <input name="email" type="email" required placeholder="tu@correo.cl" />
          </label>
          <label>
            RUT registrado
            <input name="rut" required placeholder="12.345.678-5" />
          </label>
          <button class="button primary full" type="submit">Finalizar compra</button>
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
    renderAllCarts();
  }

  document.addEventListener("DOMContentLoaded", () => {
    mountCartDrawer();
    updateCartBadge();
    prefillBuyerForms();
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
