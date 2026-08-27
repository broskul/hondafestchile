const PARTICIPATION_WHATSAPP_URL =
  window.HFC_CONTACT_LINKS?.eventUrl ||
  window.HFC_CONTACT_LINKS?.participationUrl ||
  `https://wa.me/56975766596?text=${encodeURIComponent(
    "Hola Pablo, tengo una pregunta sobre el evento Honda Fest Chile."
  )}`;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isManagedParticipationTicket(ticket) {
  const label = `${ticket.id || ""} ${ticket.name || ""}`.toLowerCase();
  return (
    ticket.entryType === "pilot" ||
    label.includes("piloto") ||
    label.includes("pilot") ||
    label.includes("stand") ||
    label.includes("foodtruck") ||
    label.includes("food truck")
  );
}

function renderTicketCard(ticket, event) {
  const availability = HFC.ticketAvailability(ticket, event.id);
  const pricing = HFC.priceBreakdownFromAvailability(availability);
  return `
    <article class="product-card">
      <div>
        <h4>${ticket.name}</h4>
        <p>${ticket.description}</p>
        <small>${availability.available ? availability.salePhaseName : "Venta no disponible"}</small>
      </div>
      <div class="ticket-display-price">
        <span>Entrada con IVA</span>
        <strong>${HFC.formatCurrency(pricing.netWithVat)}</strong>
        <small>+ cargo de servicio al finalizar</small>
      </div>
      ${ticket.parkingNote ? `<p class="parking-reference">${escapeHtml(ticket.parkingNote)}</p>` : ""}
      <label>
        Cantidad
        <input type="number" min="1" max="${availability.maxQuantity}" value="1" ${availability.available ? "" : "disabled"}
          data-qty="${event.id}-${ticket.id}" />
      </label>
      <button class="button primary full" type="button" data-add-ticket ${availability.available ? "" : "disabled"}
        data-event-id="${event.id}" data-ticket-type-id="${ticket.id}">
        ${availability.available ? "Agregar al carrito" : "No disponible"}
      </button>
    </article>
  `;
}

function renderParticipationTicketCard() {
  return `
    <article class="product-card participation-ticket-card">
      <div>
        <small class="ticket-participation-eyebrow">Coordinacion directa</small>
        <h4>Preguntas del evento</h4>
        <p>Horarios, ubicacion, pilotos, foodtrucks, stands y participacion se coordinan por WhatsApp con Pablo.</p>
      </div>
      <div class="ticket-display-price ticket-display-price--contact">
        <span>Gestion</span>
        <strong>WhatsApp</strong>
      </div>
      <a class="button secondary full" href="${PARTICIPATION_WHATSAPP_URL}" target="_blank" rel="noreferrer">
        Preguntar a Pablo
      </a>
    </article>
  `;
}

function renderTicketCards(tickets, event) {
  const cards = tickets.map((ticket) => renderTicketCard(ticket, event));
  const generalIndex = tickets.findIndex((ticket) => {
    const label = `${ticket.id || ""} ${ticket.name || ""}`.toLowerCase();
    return label.includes("general");
  });
  const participationIndex = generalIndex >= 0 ? generalIndex + 1 : cards.length;
  cards.splice(participationIndex, 0, renderParticipationTicketCard());
  return cards.join("");
}

async function renderProducts() {
  const catalog = await HFC.getCatalog();
  const grid = HFC.$("#productGrid");

  grid.innerHTML = catalog.events
    .map(
      (event) => {
        const tickets = catalog.ticketTypes.filter(
          (ticket) =>
            ticket.entryType !== "guest" &&
            !isManagedParticipationTicket(ticket) &&
            (!Array.isArray(ticket.eventIds) || !ticket.eventIds.length || ticket.eventIds.includes(event.id))
        );
        return `
          <section class="event-products">
            <div class="event-products-heading">
              <p class="section-kicker">${event.eyebrow}</p>
              <h3>${event.name}</h3>
              <span>Compra para: ${event.dateLabel}</span>
            </div>
            <div class="ticket-product-grid">
              ${renderTicketCards(tickets, event)}
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
}

document.addEventListener("DOMContentLoaded", () => {
  renderProducts().catch((error) => HFC.toast(error.message));
});
