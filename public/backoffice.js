let adminToken = localStorage.getItem("hfc_admin_token") || "";

async function adminApi(path, options = {}) {
  return HFC.api(path, {
    ...options,
    headers: {
      "x-admin-token": adminToken,
      ...(options.headers || {})
    }
  });
}

function renderBackoffice(data) {
  const content = HFC.$("#adminContent");
  content.hidden = false;
  content.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><span>Ventas</span><strong>${data.summary.orders}</strong></div>
      <div class="kpi"><span>Pagadas</span><strong>${data.summary.paidOrders}</strong></div>
      <div class="kpi"><span>Ingresos</span><strong>${HFC.formatCurrency(data.summary.revenue)}</strong></div>
      <div class="kpi"><span>Entradas</span><strong>${data.summary.tickets}</strong></div>
      <div class="kpi"><span>Validadas</span><strong>${data.summary.checkedInTickets}</strong></div>
      <div class="kpi"><span>Enrolados</span><strong>${data.summary.enrolados}</strong></div>
    </div>
    <section class="admin-table-section">
      <h2>Ventas</h2>
      <div class="table-scroll">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Orden</th><th>Cliente</th><th>Total</th><th>Estado</th><th>Tickets</th><th>DTE</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${data.orders
              .map(
                (order) => `
                  <tr>
                    <td><code>${order.id}</code></td>
                    <td>${order.user?.name || ""}<br /><small>${order.user?.email || ""}</small></td>
                    <td>${HFC.formatCurrency(order.total)}</td>
                    <td>${order.status}</td>
                    <td>${order.tickets.length}</td>
                    <td>${order.invoice?.folio || order.invoice?.providerId || order.invoiceStatus}</td>
                    <td><button class="button secondary" type="button" data-resend="${order.id}">Reenviar</button></td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
    <section class="admin-table-section">
      <h2>Entradas</h2>
      <div class="table-scroll">
        <table class="admin-table">
          <thead><tr><th>Codigo</th><th>Evento</th><th>Asistente</th><th>RUT</th><th>Estado</th></tr></thead>
          <tbody>
            ${data.tickets
              .map(
                (ticket) => `
                  <tr>
                    <td><code>${ticket.code}</code></td>
                    <td>${ticket.eventName || ""}</td>
                    <td>${ticket.holderName}</td>
                    <td>${ticket.holderRut}</td>
                    <td>${ticket.status}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
    <section class="admin-table-section">
      <h2>Usuarios enrolados</h2>
      <div class="table-scroll">
        <table class="admin-table">
          <thead><tr><th>Nombre</th><th>Correo</th><th>RUT</th><th>Telefono</th><th>Correo confirmado</th></tr></thead>
          <tbody>
            ${data.users
              .map(
                (user) => `
                  <tr>
                    <td>${user.name}</td>
                    <td>${user.email}</td>
                    <td>${user.rut}</td>
                    <td>${user.phone || ""}</td>
                    <td>${user.emailVerified ? "Si" : "No"}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;

  HFC.$$("[data-resend]", content).forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await adminApi(`/api/backoffice/orders/${button.dataset.resend}/resend`, {
          method: "POST",
          body: JSON.stringify({})
        });
        HFC.toast("Comprobante reenviado.");
      } catch (error) {
        HFC.toast(error.message);
      } finally {
        button.disabled = false;
      }
    });
  });
}

async function loadBackoffice() {
  HFC.setStatus(HFC.$("#adminStatus"), "Cargando backoffice...");
  const data = await adminApi("/api/backoffice/summary");
  HFC.setStatus(HFC.$("#adminStatus"), "Backoffice cargado.");
  renderBackoffice(data);
}

document.addEventListener("DOMContentLoaded", () => {
  HFC.$("#adminForm").token.value = adminToken;
  HFC.$("#adminForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    adminToken = event.currentTarget.token.value;
    localStorage.setItem("hfc_admin_token", adminToken);
    try {
      await loadBackoffice();
    } catch (error) {
      HFC.setStatus(HFC.$("#adminStatus"), error.message, true);
    }
  });

  if (adminToken || location.hostname === "localhost") {
    loadBackoffice().catch(() => {});
  }
});
