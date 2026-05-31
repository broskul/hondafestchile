async function renderProducts() {
  const catalog = await HFC.getCatalog();
  const grid = HFC.$("#productGrid");

  grid.innerHTML = catalog.events
    .map(
      (event) => {
        const tickets = catalog.ticketTypes.filter(
          (ticket) => !Array.isArray(ticket.eventIds) || !ticket.eventIds.length || ticket.eventIds.includes(event.id)
        );
        return `
          <section class="event-products">
            <div class="event-products-heading">
              <p class="section-kicker">${event.eyebrow}</p>
              <h3>${event.name}</h3>
              <span>${event.dateLabel}</span>
            </div>
            <div class="ticket-product-grid">
              ${
                tickets
                  .map((ticket) => {
                    const availability = HFC.ticketAvailability(ticket, event.id);
                    const pricing = HFC.priceBreakdownFromAvailability(availability);
                    return `
                      <article class="product-card">
                        <div>
                          <h4>${ticket.name}</h4>
                          <p>${ticket.description}</p>
                          <small>${availability.available ? availability.salePhaseName : "Venta no disponible"}</small>
                        </div>
                        <div class="ticket-price-breakdown">
                          <div>
                            <span>Valor neto + IVA</span>
                            <strong>${HFC.formatCurrency(pricing.netWithVat)}</strong>
                          </div>
                          <div>
                            <span>+ Cargo 12% (${HFC.formatCurrency(pricing.netWithVat)} x 12%)</span>
                            <strong>${HFC.formatCurrency(pricing.serviceCharge)}</strong>
                          </div>
                          <div class="ticket-price-total">
                            <span>Total</span>
                            <strong>${HFC.formatCurrency(pricing.total)}</strong>
                          </div>
                        </div>
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
                  })
                  .join("") || `<div class="empty-state">Aun no hay entradas cargadas para este evento.</div>`
              }
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
