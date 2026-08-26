(() => {
  let account = { user: null, orders: [] };
  let activeTab = "pending";

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

  function orderTitle(order) {
    const first = order.items?.[0];
    return first ? `${first.ticketTypeName} - ${first.eventName}` : `Orden ${order.id}`;
  }

  function ordersForTab() {
    if (activeTab === "pending") return account.orders.filter((order) => order.profileRequired);
    if (activeTab === "current") return account.orders.filter((order) => !order.profileRequired && ((order.tickets || []).length || (order.specialPasses || []).length));
    return account.orders;
  }

  function renderUser() {
    const node = HFC.$("#pitLaneUser");
    if (!account.user) {
      node.hidden = true;
      return;
    }
    node.hidden = false;
    node.innerHTML = `
      <strong>${escapeHtml(account.user.name || "Asistente Honda Fest")}</strong>
      <span>${escapeHtml(account.user.rut || "")} · ${escapeHtml(account.user.email || "")}</span>
    `;
  }

  function renderOrder(order) {
    const pendingAction = order.profileRequired && order.enrollmentUrl
      ? `<a class="button primary" href="${escapeHtml(order.enrollmentUrl)}">Enrolar pendiente</a>`
      : "";
    const tickets = order.tickets || [];
    const specialPasses = order.specialPasses || [];
    const issuedItems = order.kind === "special_pass" ? specialPasses : tickets;
    return `
      <article class="purchase-card">
        <header>
          <div>
            <p class="section-kicker">${escapeHtml(order.status || "")}</p>
            <h3>${escapeHtml(orderTitle(order))}</h3>
            <small>Orden ${escapeHtml(order.id || "")}</small>
          </div>
          <strong>${HFC.formatCurrency(order.total || 0)}</strong>
        </header>
        <ul class="order-items">
          ${(order.items || [])
            .map((item) => `<li>${escapeHtml(item.quantity)} x ${escapeHtml(item.ticketTypeName)} · ${escapeHtml(item.eventName)}</li>`)
            .join("")}
        </ul>
        ${issuedItems.length
          ? `<div class="ticket-grid">
              ${issuedItems
                .map(
                  (item) => `
                    <div class="ticket-pass">
                      <img src="${escapeHtml(item.qrUrl)}" alt="QR ${escapeHtml(item.code)}" />
                      <strong>${escapeHtml(item.levelName || item.ticketTypeName || "Entrada")}</strong>
                      <span>${escapeHtml(item.eventName || "")}</span>
                      <code>${escapeHtml(item.code)}</code>
                      ${order.kind === "special_pass" ? `<b>${escapeHtml(item.pistonCount)} ${Number(item.pistonCount) === 1 ? "Pistón" : "Pistones"}</b><small>${(item.benefits || []).map(escapeHtml).join(" · ")}</small><small>Retiro: ${escapeHtml(item.pickupStatus)} · Acceso: ${escapeHtml(item.accessStatus)}</small><em>UPGRADE: REQUIERE UNA ENTRADA HFC 2026</em>` : `<b>${escapeHtml(item.pistonCount || 1)} Pistón incluido</b><small>1 Pistón = 1 boleto para el sorteo · ${escapeHtml(item.status || "")}</small>`}
                    </div>
                  `
                )
                .join("")}
            </div>`
          : `<div class="empty-state compact">Compra pagada pendiente de enrolamiento.</div>`}
        <div class="status-actions">
          ${pendingAction}
          ${order.invoice?.pdfUrl ? `<a class="button secondary" href="${escapeHtml(order.invoice.pdfUrl)}">Ver boleta</a>` : ""}
          ${issuedItems[0]?.code ? `<a class="button secondary" href="${order.kind === "special_pass" ? "/validar-pase" : "/validar"}?code=${encodeURIComponent(issuedItems[0].code)}">Probar QR</a>` : ""}
        </div>
      </article>
    `;
  }

  function renderOrders() {
    renderUser();
    const list = HFC.$("#pitLaneList");
    const orders = ordersForTab();
    if (!orders.length) {
      const label = activeTab === "pending" ? "No tienes enrolamientos pendientes." : "No hay compras en esta vista.";
      list.innerHTML = `<div class="empty-state">${label}</div>`;
      return;
    }
    list.innerHTML = orders.map(renderOrder).join("");
  }

  function setAccount(data) {
    account = {
      user: data.user || null,
      orders: data.orders || []
    };
    if (data.token || data.user) HFC.saveAccountSession(data);
    renderOrders();
  }

  async function loadSession() {
    try {
      const data = await HFC.api("/api/account/pit-lane");
      setAccount(data);
    } catch {
      renderOrders();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const stored = HFC.getAccountUser();
    if (stored) {
      account.user = stored;
      renderUser();
    }

    HFC.$$("[data-pit-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        activeTab = button.dataset.pitTab;
        HFC.$$("[data-pit-tab]").forEach((tab) => tab.classList.toggle("active", tab === button));
        renderOrders();
      });
    });

    HFC.$("#pitLaneLoginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const status = HFC.$("#pitLaneStatus");
      const submit = form.querySelector("button[type='submit']");
      submit.disabled = true;
      HFC.setStatus(status, "Buscando tu cuenta...");
      try {
        const data = await HFC.api("/api/account/access", {
          method: "POST",
          body: JSON.stringify({
            rut: form.rut.value,
            contact: form.contact.value
          })
        });
        HFC.setStatus(status, `Listo, ${escapeHtml(data.user.name || "bienvenido")}.`);
        setAccount(data);
      } catch (error) {
        HFC.setStatus(status, error.message, true);
      } finally {
        submit.disabled = false;
      }
    });

    loadSession();
  });
})();
