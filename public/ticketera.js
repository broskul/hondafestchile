function formToJson(form) {
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  payload.interests = data.getAll("interests");
  return payload;
}

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
                    return `
                      <article class="product-card">
                        <div>
                          <h4>${ticket.name}</h4>
                          <p>${ticket.description}</p>
                          <small>${availability.available ? availability.salePhaseName : "Venta no disponible"}</small>
                        </div>
                        <strong>${HFC.formatCurrency(availability.price)}</strong>
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

async function handleRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = HFC.$("#registerStatus");
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  HFC.setStatus(status, "Creando registro...");

  try {
    const data = await HFC.api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(formToJson(form))
    });

    localStorage.setItem(
      "hfc_buyer",
      JSON.stringify({
        email: data.user.email,
        rut: data.user.rut
      })
    );
    HFC.prefillBuyerForms();

    const devButton = data.devVerificationUrl
      ? `<div class="status-actions"><a class="button secondary" href="${data.devVerificationUrl}">Confirmar correo</a></div>`
      : "";

    HFC.setStatus(status, `<strong>Registro creado.</strong><br />Confirma tu correo para comprar.${devButton}`);
  } catch (error) {
    HFC.setStatus(status, error.message, true);
  } finally {
    submit.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderProducts().catch((error) => HFC.toast(error.message));
  HFC.$("#registerForm").addEventListener("submit", handleRegister);
});
