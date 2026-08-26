const PARTICIPATION_WHATSAPP_URL =
  window.HFC_CONTACT_LINKS?.participationUrl ||
  `https://wa.me/56975766596?text=${encodeURIComponent(
    "Hola Pablo, quiero participar en Honda Fest Chile como piloto, foodtruck o stand."
  )}`;

const PISTONS_WHATSAPP_URL = `https://wa.me/56972934950?text=${encodeURIComponent(
  "Hola, quiero conocer los Pistones y las experiencias especiales de Honda Fest Chile 2026."
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

function renderTicketPrice(pricing) {
  const vatAmount = Math.max(0, Number(pricing.netWithVat || 0) - Number(pricing.netPrice || 0));
  return `
    <div class="ticket-display-price" aria-label="Desglose del precio de la entrada">
      <div class="ticket-price-net">
        <span>Precio neto</span>
        <strong>${HFC.formatCurrency(pricing.netPrice)}</strong>
      </div>
      <div class="ticket-price-vat">
        <span>IVA (19%)</span>
        <strong>${HFC.formatCurrency(vatAmount)}</strong>
      </div>
      <div class="ticket-price-total">
        <span>Total con IVA</span>
        <strong>${HFC.formatCurrency(pricing.netWithVat)}</strong>
      </div>
      <small>Cargo de servicio de 8% calculado en el carrito</small>
    </div>
  `;
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
      ${renderTicketPrice(pricing)}
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
        <h4>Pilotos, Foodtrucks y Stands</h4>
        <p>Pista, puestos de comida y stands se coordinan por WhatsApp con Pablo.</p>
      </div>
      <div class="ticket-display-price ticket-display-price--contact">
        <span>Gestion</span>
        <strong>WhatsApp</strong>
      </div>
      <a class="button secondary full" href="${PARTICIPATION_WHATSAPP_URL}" target="_blank" rel="noreferrer">
        Quiero participar
      </a>
    </article>
  `;
}

function renderPistonsUpgradeCard() {
  return `
    <article class="product-card pistons-upgrade-card">
      <div>
        <small class="ticket-participation-eyebrow">Mejora tu experiencia</small>
        <h4>Suma Pistones. Gana premios.</h4>
        <p>Cada Pistón suma una oportunidad. Mejora tu entrada con refrigerios, experiencias y beneficios especiales.</p>
      </div>
      <div class="pistons-upgrade-benefit">
        <span>Más Pistones</span>
        <strong>Más oportunidades de ganar</strong>
      </div>
      <a class="button upgrade-button full" href="${PISTONS_WHATSAPP_URL}" target="_blank" rel="noreferrer">
        Mejorar mi experiencia
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
  cards.splice(participationIndex + 1, 0, renderPistonsUpgradeCard());
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
              <span>${event.dateLabel}</span>
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
