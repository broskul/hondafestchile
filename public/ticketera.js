function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isPublicTicket(ticket) {
  const label = `${ticket.id || ""} ${ticket.name || ""}`.toLowerCase();
  return (
    ticket.entryType !== "guest" &&
    ticket.entryType !== "pilot" &&
    !label.includes("piloto") &&
    !label.includes("pilot") &&
    !label.includes("stand") &&
    !label.includes("foodtruck") &&
    !label.includes("food truck")
  );
}

function eventPurchaseDetails(event) {
  const detailsByEventId = {
    "hfc-2026-sabado-drag-day": {
      day: "Sábado 28",
      sequence: "Día 01",
      date: "28 NOV",
      meaning: "Aceleración en recta, potencia y duelos durante toda la jornada.",
      exclusivity: "Entrada válida solo para el sábado 28."
    },
    "hfc-2026-domingo-track-day": {
      day: "Domingo 29",
      sequence: "Día 02",
      date: "29 NOV",
      meaning: "Autos en pista, curvas, tandas y manejo vuelta a vuelta.",
      exclusivity: "Entrada válida solo para el domingo 29."
    }
  };
  return (
    detailsByEventId[event.id] || {
      day: event.dateLabel || "jornada seleccionada",
      sequence: "Jornada",
      date: event.dateLabel || "",
      meaning: event.summary || "Revisa los detalles de esta jornada antes de comprar.",
      exclusivity: `Esta entrada es válida exclusivamente para ${event.dateLabel || "la jornada seleccionada"}.`
    }
  );
}

function renderPriceBreakdown(pricing) {
  const netPrice = Number(pricing.netPrice || 0);
  const netWithVat = Number(pricing.netWithVat || 0);
  const vatAmount = Math.max(0, netWithVat - netPrice);
  const serviceRate = Math.round(Number(pricing.serviceChargeRate || 0) * 100);

  return `
    <dl class="ticket-price-breakdown" aria-label="Detalle de precio">
      <div class="ticket-price-net">
        <dt>Valor neto</dt>
        <dd>${HFC.formatCurrency(netPrice)}</dd>
      </div>
      <div>
        <dt>IVA (19%)</dt>
        <dd>${HFC.formatCurrency(vatAmount)}</dd>
      </div>
      <div>
        <dt>Cargo de servicio (${serviceRate}%)</dt>
        <dd>${HFC.formatCurrency(pricing.serviceCharge)}</dd>
      </div>
      <div class="ticket-price-total">
        <dt>Total online</dt>
        <dd>${HFC.formatCurrency(pricing.total)}</dd>
      </div>
    </dl>
  `;
}

let salesCountdownTimer = null;

function countdownPart(value, label) {
  return `<span><strong>${String(Math.max(0, value)).padStart(2, "0")}</strong><small>${label}</small></span>`;
}

function mountSalesHold(sales) {
  const notice = HFC.$("#ticketSalesHold");
  const countdown = HFC.$("[data-sales-countdown]", notice);
  if (!notice || !countdown) return;

  if (!sales || sales.enabled) {
    notice.hidden = true;
    if (salesCountdownTimer) window.clearInterval(salesCountdownTimer);
    salesCountdownTimer = null;
    return;
  }

  const target = new Date(sales.availableAt).getTime();
  const updateCountdown = () => {
    const remaining = target - Date.now();
    if (remaining <= 0) {
      window.clearInterval(salesCountdownTimer);
      salesCountdownTimer = null;
      countdown.innerHTML = "<strong>Activando venta...</strong>";
      window.setTimeout(() => window.location.reload(), 750);
      return;
    }
    const seconds = Math.floor(remaining / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    countdown.innerHTML = [
      countdownPart(days, "días"),
      countdownPart(hours, "horas"),
      countdownPart(minutes, "min"),
      countdownPart(remainingSeconds, "seg")
    ].join("");
  };

  notice.hidden = false;
  if (salesCountdownTimer) window.clearInterval(salesCountdownTimer);
  updateCountdown();
  salesCountdownTimer = window.setInterval(updateCountdown, 1000);
}

function renderTicketCard(ticket, event, sales) {
  const availability = HFC.ticketAvailability(ticket, event.id);
  const pricing = HFC.priceBreakdownFromAvailability(availability);
  const details = eventPurchaseDetails(event);
  const ticketVariant = ticket.id.includes("parque-cerrado") ? "paddock" : "gallery";
  const ticketName = escapeHtml(ticket.name);
  const purchaseAvailable = Boolean(availability.available && sales?.enabled !== false);
  const availabilityLabel = purchaseAvailable
    ? availability.salePhaseName
    : sales?.enabled === false
      ? "Venta temporalmente pausada"
      : "Venta no disponible";

  return `
    <article class="product-card ticket-product-card ticket-product-card--${ticketVariant}">
      <div>
        <p class="ticket-phase">${escapeHtml(availabilityLabel)}</p>
        <h3>${ticketName}</h3>
        <p>${escapeHtml(ticket.description)}</p>
      </div>
      ${renderPriceBreakdown(pricing)}
      ${ticket.parkingNote ? `<p class="parking-reference">${escapeHtml(ticket.parkingNote)}</p>` : ""}
      <div class="ticket-quantity">
        <span>Cantidad</span>
        <div class="quantity-stepper">
          <button type="button" class="quantity-step" data-quantity-step="-1" aria-label="Disminuir cantidad de ${ticketName}" ${purchaseAvailable ? "" : "disabled"}>−</button>
          <input type="number" min="1" max="${availability.maxQuantity}" value="1" inputmode="numeric" aria-label="Cantidad de ${ticketName}" ${purchaseAvailable ? "" : "disabled"}
            data-qty="${event.id}-${ticket.id}" />
          <button type="button" class="quantity-step" data-quantity-step="1" aria-label="Aumentar cantidad de ${ticketName}" ${purchaseAvailable ? "" : "disabled"}>+</button>
        </div>
      </div>
      <button class="button primary full" type="button" data-add-ticket ${purchaseAvailable ? "" : "disabled"}
        data-event-id="${event.id}" data-ticket-type-id="${ticket.id}">
        ${purchaseAvailable ? `Agregar entrada del ${details.day}` : sales?.enabled === false ? "Venta en pausa" : "No disponible"}
      </button>
    </article>
  `;
}

function renderTicketCards(tickets, event, sales) {
  return tickets.map((ticket) => renderTicketCard(ticket, event, sales)).join("");
}

function clampQuantityInput(input, delta) {
  if (!input || input.disabled) return;
  const min = Number(input.min || 1);
  const max = Number(input.max || Number.MAX_SAFE_INTEGER);
  const current = Number(input.value || min);
  input.value = String(Math.min(max, Math.max(min, current + delta)));
}

async function renderProducts() {
  const catalog = await HFC.getCatalog();
  const grid = HFC.$("#productGrid");
  mountSalesHold(catalog.sales);

  grid.innerHTML = catalog.events
    .map(
      (event) => {
        const details = eventPurchaseDetails(event);
        const tickets = catalog.ticketTypes.filter(
          (ticket) =>
            isPublicTicket(ticket) &&
            (!Array.isArray(ticket.eventIds) || !ticket.eventIds.length || ticket.eventIds.includes(event.id))
        );
        return `
          <section class="event-products" id="${escapeHtml(event.id)}">
            <header class="event-products-heading">
              <div>
                <p class="event-sequence">${details.sequence}</p>
                <h2>${escapeHtml(event.name)}</h2>
                <p class="event-purchase-meaning">${details.meaning}</p>
              </div>
              <div class="event-purchase-date">
                <span>${details.sequence}</span>
                <strong>${details.date}</strong>
                <small>${details.day}</small>
              </div>
            </header>
            <p class="event-single-day-notice">${details.exclusivity} Para vivir el fin de semana completo, agrega una entrada para ambas jornadas.</p>
            <div class="ticket-product-grid">
              ${renderTicketCards(tickets, event, catalog.sales)}
            </div>
          </section>
        `;
      }
    )
    .join("");

  HFC.$$("[data-add-ticket]").forEach((button) => {
    button.addEventListener("click", () => {
      const quantityInput = HFC.$(`[data-qty="${button.dataset.eventId}-${button.dataset.ticketTypeId}"]`);
      HFC.addToCart({
        eventId: button.dataset.eventId,
        ticketTypeId: button.dataset.ticketTypeId,
        quantity: Number(quantityInput.value || 1)
      });
    });
  });

  HFC.$$('[data-quantity-step]').forEach((button) => {
    button.addEventListener("click", () => {
      const input = HFC.$("input", button.closest(".quantity-stepper"));
      clampQuantityInput(input, Number(button.dataset.quantityStep || 0));
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderProducts().catch((error) => HFC.toast(error.message));
});
