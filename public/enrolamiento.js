(() => {
  const params = new URLSearchParams(window.location.search);
  const directToken = String(params.get("token") || "").trim();
  let portalToken = sessionStorage.getItem("hfc_enrollment_portal_token") || "";
  let portalOrders = [];

  const content = () => HFC.$("#enrollmentContent");
  const status = () => HFC.$("#enrollmentStatus");
  const portalStatus = () => HFC.$("#portalStatus");
  const portalPanel = () => HFC.$("#portalPanel");
  const portalOrdersNode = () => HFC.$("#portalOrders");

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

  function authHeaders() {
    return portalToken ? { Authorization: `Bearer ${portalToken}` } : {};
  }

  function orderTitle(item) {
    const order = item.order || {};
    const first = order.items?.[0];
    return first ? `${first.ticketTypeName} - ${first.eventName}` : "Compra Honda Fest Chile";
  }

  function renderStart() {
    content().innerHTML = `
      <p class="section-kicker">Pendientes</p>
      <h2>Portal de enrolamiento</h2>
      <p class="form-note">Ingresa con usuario y password para revisar compras pagadas que aun necesitan datos.</p>
    `;
  }

  function profileForm(item, mode) {
    const order = item.order || {};
    const user = item.user || {};
    return `
      <p class="section-kicker">${mode === "portal" ? "Edicion interna" : "Compra pagada"}</p>
      <h2>${escapeHtml(orderTitle(item))}</h2>
      <p class="form-note">Orden ${escapeHtml(order.id || "")} · ${HFC.formatCurrency(order.total || 0)}</p>
      <form class="profile-completion-form enrollment-form" data-enrollment-form data-order-id="${escapeHtml(order.id || "")}">
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

  function renderCompleted(data) {
    const tickets = data.tickets || [];
    content().innerHTML = `
      <p class="section-kicker">Listo</p>
      <h2>Entradas emitidas</h2>
      <p class="form-note">Tambien enviamos la confirmacion al correo registrado.</p>
      <div class="ticket-grid">
        ${tickets
          .map(
            (ticket) => `
              <article class="ticket-pass">
                <img src="${escapeHtml(ticket.qrUrl)}" alt="QR ${escapeHtml(ticket.code)}" />
                <code>${escapeHtml(ticket.code)}</code>
                <span>${escapeHtml(ticket.ticketTypeName || "")}</span>
              </article>
            `
          )
          .join("")}
      </div>
      <div class="status-actions">
        <a class="button secondary" href="/mi-pit-lane">Ver mis entradas</a>
        <a class="button ghost-light" href="/ticketera">Volver a ticketera</a>
      </div>
    `;
    status().hidden = true;
  }

  function mountEnrollmentForm(item, mode) {
    const form = HFC.$("[data-enrollment-form]", content());
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector("button[type='submit']");
      submit.disabled = true;
      HFC.setStatus(status(), "Guardando datos y emitiendo entradas...");

      try {
        const payload = Object.fromEntries(new FormData(form).entries());
        if (mode === "token") payload.enrollmentToken = directToken;
        const data = await HFC.api(`/api/enrollment/orders/${encodeURIComponent(form.dataset.orderId)}/profile`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify(payload)
        });
        renderCompleted(data);
        await loadPortalOrders({ silent: true });
      } catch (error) {
        HFC.setStatus(status(), error.message, true);
      } finally {
        submit.disabled = false;
      }
    });
  }

  function renderEnrollment(item, mode) {
    if (!item.order?.profileRequired && item.tickets?.length) {
      renderCompleted(item);
      return;
    }

    content().innerHTML = profileForm(item, mode);
    status().hidden = true;
    mountEnrollmentForm(item, mode);
  }

  function renderPortalOrders(data) {
    portalOrders = data.orders || [];
    const node = portalOrdersNode();
    node.hidden = false;

    if (!portalOrders.length) {
      node.innerHTML = `<div class="empty-state">No hay compras pagadas pendientes de datos.</div>`;
      return;
    }

    node.innerHTML = `
      <div class="portal-order-list">
        ${portalOrders
          .map((item) => {
            const order = item.order || {};
            const user = item.user || {};
            return `
              <article class="portal-order-card">
                <div>
                  <strong>${escapeHtml(orderTitle(item))}</strong>
                  <span>${escapeHtml(user.email || "")}</span>
                  <small>${escapeHtml(order.id || "")} · ${HFC.formatCurrency(order.total || 0)}</small>
                </div>
                <img src="${escapeHtml(item.enrollmentQrUrl || "")}" alt="QR enrolamiento" />
                <div class="status-actions">
                  <button class="button primary" type="button" data-open-order="${escapeHtml(order.id || "")}">Completar</button>
                  <button class="button ghost-light" type="button" data-send-link="${escapeHtml(order.id || "")}">Reenviar enlace</button>
                  <a class="button secondary" href="${escapeHtml(item.enrollmentUrl || "#")}" target="_blank" rel="noreferrer">Abrir</a>
                </div>
              </article>
            `;
          })
          .join("")}
      </div>
    `;

    HFC.$$("[data-open-order]", node).forEach((button) => {
      button.addEventListener("click", () => {
        const item = portalOrders.find((candidate) => candidate.order?.id === button.dataset.openOrder);
        if (item) renderEnrollment(item, "portal");
      });
    });

    HFC.$$("[data-send-link]", node).forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        HFC.setStatus(portalStatus(), "Enviando enlace...");
        try {
          await HFC.api(`/api/enrollment/portal/orders/${encodeURIComponent(button.dataset.sendLink)}/send-link`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({})
          });
          HFC.setStatus(portalStatus(), "Enlace enviado al correo del comprador.");
        } catch (error) {
          HFC.setStatus(portalStatus(), error.message, true);
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  async function loadPortalOrders(options = {}) {
    if (!portalToken) return;
    if (!options.silent) HFC.setStatus(portalStatus(), "Cargando pendientes...");
    try {
      const data = await HFC.api("/api/enrollment/portal/orders", {
        headers: authHeaders()
      });
      renderPortalOrders(data);
      if (!options.silent) portalStatus().hidden = true;
    } catch (error) {
      if (!options.silent) HFC.setStatus(portalStatus(), error.message, true);
    }
  }

  async function loadDirectToken() {
    portalPanel().hidden = true;
    HFC.$(".enrollment-section").classList.add("token-only");
    HFC.setStatus(status(), "Abriendo enlace seguro...");
    try {
      const item = await HFC.api(`/api/enrollment/${encodeURIComponent(directToken)}`);
      renderEnrollment(item, "token");
    } catch (error) {
      content().innerHTML = `
        <p class="section-kicker">Enlace no disponible</p>
        <h2>No pudimos abrir este acceso.</h2>
        <p class="form-note">Revisa el correo mas reciente o solicita que reenviemos el enlace desde el portal privado.</p>
      `;
      HFC.setStatus(status(), error.message, true);
    }
  }

  function mountPortalLogin() {
    const form = HFC.$("#portalLoginForm");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector("button[type='submit']");
      submit.disabled = true;
      HFC.setStatus(portalStatus(), "Validando acceso...");
      try {
        const payload = Object.fromEntries(new FormData(form).entries());
        const data = await HFC.api("/api/enrollment/login", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        portalToken = data.token;
        sessionStorage.setItem("hfc_enrollment_portal_token", portalToken);
        await loadPortalOrders();
      } catch (error) {
        HFC.setStatus(portalStatus(), error.message, true);
      } finally {
        submit.disabled = false;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    mountPortalLogin();
    if (directToken) {
      loadDirectToken();
      return;
    }
    renderStart();
    loadPortalOrders();
  });
})();
