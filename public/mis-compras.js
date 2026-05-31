function renderPurchases(data) {
  const list = HFC.$("#purchaseList");
  if (!data.orders.length) {
    list.innerHTML = `<div class="empty-state">Aun no tienes compras asociadas.</div>`;
    return;
  }

  list.innerHTML = data.orders
    .map(
      (order) => `
        <article class="purchase-card">
          <header>
            <div>
              <p class="section-kicker">${order.status}</p>
              <h3>Orden ${order.id}</h3>
            </div>
            <strong>${HFC.formatCurrency(order.total)}</strong>
          </header>
          <ul class="order-items">
            ${(order.items || [])
              .map((item) => `<li>${item.quantity} x ${item.ticketTypeName} · ${item.eventName}</li>`)
              .join("")}
          </ul>
          <div class="ticket-grid">
            ${order.tickets
              .map(
                (ticket) => `
                  <div class="ticket-pass">
                    <img src="${ticket.qrUrl}" alt="QR ticket ${ticket.code}" />
                    <strong>${ticket.ticketTypeName || "Entrada"}</strong>
                    <span>${ticket.eventName || ""}</span>
                    <code>${ticket.code}</code>
                    <small>${ticket.status}</small>
                  </div>
                `
              )
              .join("")}
          </div>
          <div class="status-actions">
            ${order.profileRequired && order.enrollmentUrl ? `<a class="button primary" href="${order.enrollmentUrl}">Enrolar pendiente</a>` : ""}
            ${order.invoice?.pdfUrl ? `<a class="button secondary" href="${order.invoice.pdfUrl}">Ver boleta</a>` : ""}
            <a class="button secondary" href="/validar?code=${encodeURIComponent(order.tickets[0]?.code || "")}">Probar QR</a>
          </div>
        </article>
      `
    )
    .join("");
}

document.addEventListener("DOMContentLoaded", () => {
  HFC.prefillBuyerForms();

  HFC.$("#purchasesForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = HFC.$("#purchasesStatus");
    const query = new URLSearchParams({
      email: form.email.value,
      rut: form.rut.value,
      phone: form.phone.value
    });

    HFC.setStatus(status, "Buscando compras...");

    try {
      const data = await HFC.api(`/api/users/purchases?${query.toString()}`);
      localStorage.setItem("hfc_buyer", JSON.stringify({ email: form.email.value, rut: form.rut.value, phone: form.phone.value }));
      HFC.setStatus(status, `<strong>${data.user.name}</strong><br />Compras encontradas: ${data.orders.length}`);
      renderPurchases(data);
    } catch (error) {
      HFC.setStatus(status, error.message, true);
    }
  });
});
