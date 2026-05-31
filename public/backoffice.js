let adminToken = localStorage.getItem("hfc_admin_token") || "";
let backofficeData = null;
let activeTab = "bi";

async function adminApi(path, options = {}) {
  return HFC.api(path, {
    ...options,
    headers: {
      "x-admin-token": adminToken,
      ...(options.headers || {})
    }
  });
}

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

function dateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function readNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function makeId(prefix, value = "") {
  const slug = String(value || prefix)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  const uuid = globalThis.crypto?.randomUUID?.();
  const suffix = uuid?.slice(0, 8) || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `${prefix}-${slug || "nuevo"}-${suffix}`;
}

function optionList(items, selected) {
  return items
    .map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name)}</option>`)
    .join("");
}

function phaseBadge(phase) {
  const limit = phase.quota ? `${phase.quota} cupos` : "sin limite";
  return `${escapeHtml(phase.name)} - ${HFC.formatCurrency(phase.price)} - ${limit}`;
}

function defaultPhase(kind, ticket = {}) {
  const labels = {
    preventa: "Preventa",
    general: "Venta general",
    puerta: "Puerta"
  };
  const sortOrder = {
    preventa: 10,
    general: 20,
    puerta: 30
  };
  return {
    id: kind,
    kind,
    name: labels[kind] || kind,
    price: Number(ticket.price || 0),
    quota: kind === "preventa" ? 100 : null,
    startsAt: "",
    endsAt: "",
    perOrderLimit: Number(ticket.maxQuantity || 1),
    enabled: kind !== "puerta",
    sortOrder: sortOrder[kind] || 99
  };
}

function ensureTicketPhases(ticket) {
  const phases = Array.isArray(ticket.phases) ? ticket.phases : [];
  return ["preventa", "general", "puerta"].map((kind) => {
    const existing = phases.find((phase) => (phase.kind || phase.id) === kind);
    return existing ? { ...defaultPhase(kind, ticket), ...existing, id: kind, kind } : defaultPhase(kind, ticket);
  });
}

function newEventDraft() {
  return {
    id: makeId("event", "evento"),
    name: "Nuevo evento",
    eyebrow: "Evento",
    dateLabel: "",
    eventDate: "",
    venue: "",
    city: "Chile",
    summary: "",
    highlights: [],
    accent: "honda",
    active: true
  };
}

function newTicketDraft() {
  const ticket = {
    id: makeId("ticket", "entrada"),
    name: "Nueva entrada",
    description: "",
    price: 0,
    maxQuantity: 6,
    eventIds: [],
    active: true
  };
  ticket.phases = ensureTicketPhases(ticket);
  return ticket;
}

function phaseRule(kind) {
  if (kind === "preventa") return "La venta general espera a que estos cupos lleguen a 0.";
  if (kind === "general") return "Se activa sola cuando no quedan cupos de preventa.";
  if (kind === "puerta") return "Solo se publica el dia indicado como fecha real del evento.";
  return "";
}

function renderKpis(data) {
  return `
    <div class="kpi-grid">
      <div class="kpi"><span>Ventas</span><strong>${data.summary.orders}</strong></div>
      <div class="kpi"><span>Pagadas</span><strong>${data.summary.paidOrders}</strong></div>
      <div class="kpi"><span>Ingresos</span><strong>${HFC.formatCurrency(data.summary.revenue)}</strong></div>
      <div class="kpi"><span>Entradas</span><strong>${data.summary.tickets}</strong></div>
      <div class="kpi"><span>Invitados</span><strong>${data.summary.guestTickets}</strong></div>
      <div class="kpi"><span>Enrolados</span><strong>${data.summary.enrolados}</strong></div>
    </div>
  `;
}

function renderBi(data) {
  const rows = (title, items) => `
    <section class="admin-table-section">
      <h2>${title}</h2>
      <div class="table-scroll">
        <table class="admin-table">
          <thead><tr><th>Nombre</th><th>Vendidas</th><th>Invitados</th><th>Ingresos</th></tr></thead>
          <tbody>
            ${items
              .map(
                (item) => `
                  <tr>
                    <td>${escapeHtml(item.name)}</td>
                    <td>${item.sold}</td>
                    <td>${item.guests}</td>
                    <td>${HFC.formatCurrency(item.revenue)}</td>
                  </tr>
                `
              )
              .join("") || `<tr><td colspan="4">Sin ventas todavia.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;

  return `
    ${renderKpis(data)}
    <div class="admin-grid two">
      ${rows("BI por evento", data.bi.byEvent)}
      ${rows("BI por tipo de entrada", data.bi.byTicket)}
    </div>
    ${rows("BI por etapa de venta", data.bi.byPhase)}
  `;
}

function renderTicketing(data) {
  const events = data.ticketing.events || [];
  const ticketTypes = (data.ticketing.ticketTypes || []).map((ticket) => ({
    ...ticket,
    phases: ensureTicketPhases(ticket)
  }));
  return `
    <form id="ticketingForm" class="admin-editor">
      <section class="admin-table-section">
        <div class="admin-toolbar">
          <h2>Eventos</h2>
          <button class="button secondary" type="button" data-add-event>Crear evento</button>
        </div>
        <div class="admin-card-grid">
          ${
            events
            .map(
              (event) => `
                <article class="admin-card" data-event-card="${escapeHtml(event.id)}">
                  <div class="admin-card-heading">
                    <div>
                      <strong>${escapeHtml(event.name)}</strong>
                      <small>${escapeHtml(event.venue || event.dateLabel || "Evento sin fecha publicada")}</small>
                    </div>
                    <button class="button ghost-light" type="button" data-remove-event="${escapeHtml(event.id)}">Eliminar</button>
                  </div>
                  <label>Nombre <input data-event-field="name" value="${escapeHtml(event.name)}" /></label>
                  <label>Fecha visible <input data-event-field="dateLabel" value="${escapeHtml(event.dateLabel || "")}" /></label>
                  <label>Fecha real <input data-event-field="eventDate" type="datetime-local" value="${dateInputValue(event.eventDate)}" /></label>
                  <label>Recinto <input data-event-field="venue" value="${escapeHtml(event.venue || "")}" /></label>
                  <label class="full">Resumen <input data-event-field="summary" value="${escapeHtml(event.summary || "")}" /></label>
                </article>
              `
            )
            .join("") || `<div class="empty-state">Aun no hay eventos creados.</div>`
          }
        </div>
      </section>

      <section class="admin-table-section">
        <div class="admin-toolbar">
          <h2>Entradas y valores</h2>
          <button class="button secondary" type="button" data-add-ticket>Crear entrada</button>
        </div>
        <div class="admin-card-grid">
          ${
            ticketTypes
            .map(
              (ticket) => `
                <article class="admin-card admin-card--wide" data-ticket-card="${escapeHtml(ticket.id)}">
                  <div class="admin-card-heading">
                    <div>
                      <strong>${escapeHtml(ticket.name)}</strong>
                      <small>${escapeHtml(ticket.description || "")}</small>
                    </div>
                    <button class="button ghost-light" type="button" data-remove-ticket="${escapeHtml(ticket.id)}">Eliminar</button>
                  </div>
                  <div class="form-grid">
                    <label>Nombre <input data-ticket-field="name" value="${escapeHtml(ticket.name)}" /></label>
                    <label>Max. por compra <input data-ticket-field="maxQuantity" type="number" min="1" value="${ticket.maxQuantity}" /></label>
                    <label class="full">Descripcion <input data-ticket-field="description" value="${escapeHtml(ticket.description || "")}" /></label>
                    <fieldset class="full admin-check-list">
                      <legend>Eventos donde se vende</legend>
                      ${
                        events
                          .map((event) => {
                            const checked =
                              !Array.isArray(ticket.eventIds) || !ticket.eventIds.length || ticket.eventIds.includes(event.id);
                            return `<label><input data-ticket-event type="checkbox" value="${escapeHtml(event.id)}" ${checked ? "checked" : ""} /> ${escapeHtml(event.name)}</label>`;
                          })
                          .join("") || `<span class="muted-inline">Crea un evento para asignar esta entrada.</span>`
                      }
                    </fieldset>
                  </div>
                  <div class="phase-grid">
                    ${ticket.phases
                      .map(
                        (phase) => `
                          <fieldset class="phase-card" data-phase-card="${escapeHtml(phase.id)}">
                            <legend>${phaseBadge(phase)}</legend>
                            <label>Activa <input data-phase-field="enabled" type="checkbox" ${phase.enabled ? "checked" : ""} /></label>
                            <label>Nombre <input data-phase-field="name" value="${escapeHtml(phase.name)}" /></label>
                            <label>Valor <input data-phase-field="price" type="number" min="0" step="100" value="${phase.price}" /></label>
                            <label>Cupos fase <input data-phase-field="quota" type="number" min="0" placeholder="Sin limite" value="${phase.quota || ""}" /></label>
                            <label>Max. por compra <input data-phase-field="perOrderLimit" type="number" min="1" value="${phase.perOrderLimit}" /></label>
                            <small>${phaseRule(phase.kind || phase.id)}</small>
                          </fieldset>
                        `
                      )
                      .join("")}
                  </div>
                </article>
              `
            )
            .join("") || `<div class="empty-state">Aun no hay entradas creadas.</div>`
          }
        </div>
      </section>
      <button class="button primary" type="submit">Guardar entradas</button>
      <div class="status-box" id="ticketingStatus" hidden></div>
    </form>
  `;
}

function collectTicketingForm(form) {
  const eventCards = Array.from(form.querySelectorAll("[data-event-card]"));
  const ticketCards = Array.from(form.querySelectorAll("[data-ticket-card]"));
  const eventIds = eventCards.map((card) => card.dataset.eventCard);
  const events = eventCards.map((card) => ({
    id: card.dataset.eventCard,
    name: card.querySelector('[data-event-field="name"]').value.trim() || "Evento",
    eyebrow: "Evento",
    dateLabel: card.querySelector('[data-event-field="dateLabel"]').value.trim(),
    eventDate: card.querySelector('[data-event-field="eventDate"]').value,
    venue: card.querySelector('[data-event-field="venue"]').value.trim(),
    city: "Chile",
    summary: card.querySelector('[data-event-field="summary"]').value.trim(),
    highlights: [],
    accent: "honda",
    active: true
  }));

  const ticketing = {
    events,
    ticketTypes: ticketCards.map((card) => {
      const maxQuantity = readNumber(card.querySelector('[data-ticket-field="maxQuantity"]').value, 1);
      const phases = Array.from(card.querySelectorAll("[data-phase-card]")).map((phaseCard, index) => {
        const phaseId = phaseCard.dataset.phaseCard;
        return {
          id: phaseId,
          kind: phaseId,
          enabled: phaseCard.querySelector('[data-phase-field="enabled"]').checked,
          name: phaseCard.querySelector('[data-phase-field="name"]').value.trim(),
          price: readNumber(phaseCard.querySelector('[data-phase-field="price"]').value, 0),
          quota: phaseCard.querySelector('[data-phase-field="quota"]').value
            ? readNumber(phaseCard.querySelector('[data-phase-field="quota"]').value, null)
            : null,
          perOrderLimit: readNumber(phaseCard.querySelector('[data-phase-field="perOrderLimit"]').value, maxQuantity),
          startsAt: "",
          endsAt: "",
          sortOrder: (index + 1) * 10
        };
      });
      const selectedEvents = Array.from(card.querySelectorAll("[data-ticket-event]:checked")).map((input) => input.value);
      const general = phases.find((phase) => phase.kind === "general") || phases[0];
      return {
        id: card.dataset.ticketCard,
        name: card.querySelector('[data-ticket-field="name"]').value.trim(),
        description: card.querySelector('[data-ticket-field="description"]').value.trim(),
        price: general?.price || 0,
        maxQuantity,
        eventIds: selectedEvents.length === eventIds.length ? [] : selectedEvents,
        active: true,
        phases
      };
    })
  };
  return ticketing;
}

function syncTicketingDraftFromForm() {
  const form = HFC.$("#ticketingForm");
  if (form && backofficeData?.ticketing) {
    backofficeData.ticketing = collectTicketingForm(form);
  }
}

function renderGuests(data) {
  return `
    <form id="guestForm" class="ticket-panel admin-form-panel">
      <div class="form-grid">
        <label>Nombre <input name="name" required /></label>
        <label>Correo <input name="email" type="email" required /></label>
        <label>RUT opcional <input name="rut" placeholder="12.345.678-5" /></label>
        <label>Telefono <input name="phone" /></label>
        <label>Evento <select name="eventId">${optionList(data.ticketing.events)}</select></label>
        <label>Entrada <select name="ticketTypeId">${optionList(data.ticketing.ticketTypes)}</select></label>
        <label>Cantidad <input name="quantity" type="number" min="1" max="20" value="1" /></label>
        <label>Enviar correo <input name="sendEmail" type="checkbox" checked /></label>
        <label class="full">Nota <input name="note" placeholder="Organizador, prensa, sponsor..." /></label>
      </div>
      <button class="button primary" type="submit">Crear invitado gratis</button>
      <div class="status-box" id="guestStatus" hidden></div>
    </form>
  `;
}

function renderUsers(data) {
  return `
    <section class="admin-table-section">
      <div class="admin-toolbar">
        <h2>Enrolados</h2>
        <input id="userSearch" placeholder="Buscar nombre, correo o RUT" />
      </div>
      <div class="table-scroll">
        <table class="admin-table" id="usersTable">
          <thead><tr><th>Nombre</th><th>Correo</th><th>RUT</th><th>Estado</th><th>Correccion</th><th>Acciones</th></tr></thead>
          <tbody>
            ${data.users
              .map(
                (user) => `
                  <tr data-user-row data-search="${escapeHtml(`${user.name} ${user.email} ${user.rut}`.toLowerCase())}">
                    <td>${escapeHtml(user.name || "")}<br /><small>${user.source || "web"} - ${user.orders} ordenes - ${user.tickets} tickets</small></td>
                    <td>${escapeHtml(user.email || "")}<br /><small>${escapeHtml(user.emailSuggestion.reason || "")}</small></td>
                    <td>${escapeHtml(user.rut || "")}</td>
                    <td>${user.emailVerified ? "Confirmado" : "Pendiente"}</td>
                    <td><input data-user-email="${escapeHtml(user.id)}" value="${escapeHtml(user.emailSuggestion.suggestion || user.email || "")}" /></td>
                    <td>
                      <button class="button secondary" type="button" data-update-user-email="${escapeHtml(user.id)}">Corregir y reenviar</button>
                      <button class="button ghost-light" type="button" data-resend-user="${escapeHtml(user.id)}">Reenviar enrolamiento</button>
                    </td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderContacts(data) {
  return `
    <section class="admin-table-section">
      <h2>Contactos CSV</h2>
      <form id="contactImportForm" class="admin-form-panel">
        <div class="form-grid">
          <label>Origen <input name="source" value="csv" /></label>
          <label class="full">Pegar CSV <textarea name="csv" rows="7" placeholder="nombre,correo,telefono,rut"></textarea></label>
        </div>
        <button class="button primary" type="submit">Importar contactos</button>
        <div class="status-box" id="contactStatus" hidden></div>
      </form>
      <div class="table-scroll">
        <table class="admin-table">
          <thead><tr><th>Nombre</th><th>Correo original</th><th>Sugerencia</th><th>Correccion</th><th>Accion</th></tr></thead>
          <tbody>
            ${data.contacts
              .map(
                (contact) => `
                  <tr>
                    <td>${escapeHtml(contact.name || "")}<br /><small>${escapeHtml(contact.source || "")}</small></td>
                    <td>${escapeHtml(contact.email || "")}</td>
                    <td>${escapeHtml(contact.emailSuggestion?.suggestion || contact.correctedEmail || "")}<br /><small>${escapeHtml(contact.emailSuggestion?.reason || "")}</small></td>
                    <td><input data-contact-email="${escapeHtml(contact.id)}" value="${escapeHtml(contact.correctedEmail || contact.emailSuggestion?.suggestion || contact.email || "")}" /></td>
                    <td><button class="button secondary" type="button" data-update-contact-email="${escapeHtml(contact.id)}">Guardar</button></td>
                  </tr>
                `
              )
              .join("") || `<tr><td colspan="5">Aun no hay contactos importados.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderEmailTools(data) {
  return `
    <div class="admin-grid two">
      <form id="emailSendForm" class="admin-form-panel">
        <h2>Envio masivo o unitario</h2>
        <div class="form-grid">
          <label>Plantilla
            <select name="templateId">
              ${data.emailTemplates.map((template) => `<option value="${template.id}">${escapeHtml(template.name)}</option>`).join("")}
            </select>
          </label>
          <label>Destino
            <select name="target">
              <option value="selected">Correos pegados</option>
              <option value="users_unverified">Enrolados pendientes</option>
              <option value="users_all">Todos los enrolados</option>
              <option value="contacts_all">Todos los contactos CSV</option>
            </select>
          </label>
          <label class="full">Correos sueltos <textarea name="emails" rows="4" placeholder="uno@correo.cl, otro@correo.cl"></textarea></label>
          <label class="full">Asunto <input name="subject" /></label>
          <label class="full">Mensaje <textarea name="body" rows="5"></textarea></label>
          <label class="full">Link CTA <input name="ctaUrl" value="${location.origin}/ticketera" /></label>
        </div>
        <button class="button primary" type="submit">Enviar correos</button>
        <div class="status-box" id="emailStatus" hidden></div>
      </form>
      <section class="admin-table-section">
        <h2>Ultimos envios</h2>
        <div class="table-scroll">
          <table class="admin-table compact-table">
            <thead><tr><th>Tipo</th><th>Para</th><th>Estado</th><th>Fecha</th></tr></thead>
            <tbody>
              ${data.emailLogs
                .slice(0, 40)
                .map(
                  (log) => `
                    <tr>
                      <td>${escapeHtml(log.type || "")}</td>
                      <td>${escapeHtml(log.to || "")}</td>
                      <td>${escapeHtml(log.status || log.mode || "")}</td>
                      <td>${log.createdAt ? new Date(log.createdAt).toLocaleString("es-CL") : ""}</td>
                    </tr>
                  `
                )
                .join("") || `<tr><td colspan="4">Sin envios registrados.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderTemplates(data) {
  const first = data.emailTemplates[0];
  return `
    <form id="templateForm" class="admin-form-panel">
      <h2>Plantillas</h2>
      <div class="form-grid">
        <label>Plantilla
          <select name="templateId">
            ${data.emailTemplates.map((template) => `<option value="${template.id}">${escapeHtml(template.name)}</option>`).join("")}
          </select>
        </label>
        <label>Nombre <input name="name" value="${escapeHtml(first?.name || "")}" /></label>
        <label class="full">Asunto <input name="subject" value="${escapeHtml(first?.subject || "")}" /></label>
        <label class="full">Texto <textarea name="text" rows="6">${escapeHtml(first?.text || "")}</textarea></label>
        <label class="full">HTML <textarea name="html" rows="9">${escapeHtml(first?.html || "")}</textarea></label>
      </div>
      <button class="button primary" type="submit">Guardar plantilla</button>
      <div class="status-box" id="templateStatus" hidden></div>
    </form>
  `;
}

function renderOrders(data) {
  return `
    <section class="admin-table-section">
      <h2>Ventas</h2>
      <div class="table-scroll">
        <table class="admin-table">
          <thead>
            <tr><th>Orden</th><th>Cliente</th><th>Total</th><th>Estado</th><th>Tipo</th><th>Tickets</th><th>DTE</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            ${data.orders
              .map(
                (order) => `
                  <tr>
                    <td><code>${escapeHtml(order.id)}</code><br /><small>${order.createdAt ? new Date(order.createdAt).toLocaleString("es-CL") : ""}</small></td>
                    <td>${escapeHtml(order.user?.name || "")}<br /><small>${escapeHtml(order.user?.email || "")}</small></td>
                    <td>${HFC.formatCurrency(order.total)}</td>
                    <td>${escapeHtml(order.status)}</td>
                    <td>${escapeHtml(order.salePhaseName || order.source || "")}</td>
                    <td>${order.tickets.length}</td>
                    <td>${escapeHtml(order.invoice?.folio || order.invoice?.providerId || order.invoiceStatus || "")}</td>
                    <td><button class="button secondary" type="button" data-resend="${escapeHtml(order.id)}">Reenviar</button></td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderTickets(data) {
  return `
    <section class="admin-table-section">
      <h2>Entradas emitidas</h2>
      <div class="table-scroll">
        <table class="admin-table">
          <thead><tr><th>Codigo</th><th>Evento</th><th>Tipo</th><th>Asistente</th><th>RUT</th><th>Estado</th></tr></thead>
          <tbody>
            ${data.tickets
              .map(
                (ticket) => `
                  <tr>
                    <td><code>${escapeHtml(ticket.code)}</code></td>
                    <td>${escapeHtml(ticket.eventName || "")}</td>
                    <td>${escapeHtml(ticket.ticketTypeName || "")}<br /><small>${escapeHtml(ticket.salePhaseName || "")}</small></td>
                    <td>${escapeHtml(ticket.holderName || "")}</td>
                    <td>${escapeHtml(ticket.holderRut || "")}</td>
                    <td>${escapeHtml(ticket.status || "")}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function tabButton(id, label) {
  return `<button class="admin-tab${activeTab === id ? " active" : ""}" type="button" data-admin-tab="${id}">${label}</button>`;
}

function renderBackoffice(data) {
  backofficeData = data;
  const content = HFC.$("#adminContent");
  content.hidden = false;
  const storageLabel = data.storage?.supabase ? "Supabase" : "JSON local";
  content.innerHTML = `
    <div class="admin-provider">Datos: ${escapeHtml(storageLabel)} - Correo: ${escapeHtml(data.integrations.email.provider)} - remitente ${escapeHtml(data.integrations.email.sender || "no configurado")}</div>
    <div class="admin-tabs" role="tablist">
      ${tabButton("bi", "BI")}
      ${tabButton("ticketing", "Entradas")}
      ${tabButton("guests", "Invitados")}
      ${tabButton("users", "Enrolados")}
      ${tabButton("contacts", "Contactos CSV")}
      ${tabButton("email", "Correos")}
      ${tabButton("templates", "Plantillas")}
      ${tabButton("orders", "Ventas")}
      ${tabButton("tickets", "QR")}
    </div>
    <div class="admin-tab-panel">
      ${
        {
          bi: renderBi(data),
          ticketing: renderTicketing(data),
          guests: renderGuests(data),
          users: renderUsers(data),
          contacts: renderContacts(data),
          email: renderEmailTools(data),
          templates: renderTemplates(data),
          orders: renderOrders(data),
          tickets: renderTickets(data)
        }[activeTab] || renderBi(data)
      }
    </div>
  `;

  attachBackofficeEvents();
}

async function loadBackoffice() {
  HFC.setStatus(HFC.$("#adminStatus"), "Cargando backoffice...");
  const data = await adminApi("/api/backoffice/summary");
  HFC.setStatus(HFC.$("#adminStatus"), "Backoffice cargado.");
  renderBackoffice(data);
}

function attachBackofficeEvents() {
  HFC.$$("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.adminTab;
      renderBackoffice(backofficeData);
    });
  });

  HFC.$("[data-add-event]")?.addEventListener("click", () => {
    syncTicketingDraftFromForm();
    backofficeData.ticketing.events.push(newEventDraft());
    renderBackoffice(backofficeData);
  });

  HFC.$$("[data-remove-event]").forEach((button) => {
    button.addEventListener("click", () => {
      syncTicketingDraftFromForm();
      const eventId = button.dataset.removeEvent;
      backofficeData.ticketing.events = backofficeData.ticketing.events.filter((event) => event.id !== eventId);
      backofficeData.ticketing.ticketTypes = backofficeData.ticketing.ticketTypes.map((ticket) => ({
        ...ticket,
        eventIds: Array.isArray(ticket.eventIds) ? ticket.eventIds.filter((id) => id !== eventId) : []
      }));
      renderBackoffice(backofficeData);
    });
  });

  HFC.$("[data-add-ticket]")?.addEventListener("click", () => {
    syncTicketingDraftFromForm();
    backofficeData.ticketing.ticketTypes.push(newTicketDraft());
    renderBackoffice(backofficeData);
  });

  HFC.$$("[data-remove-ticket]").forEach((button) => {
    button.addEventListener("click", () => {
      syncTicketingDraftFromForm();
      const ticketId = button.dataset.removeTicket;
      backofficeData.ticketing.ticketTypes = backofficeData.ticketing.ticketTypes.filter((ticket) => ticket.id !== ticketId);
      renderBackoffice(backofficeData);
    });
  });

  HFC.$("#ticketingForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = HFC.$("#ticketingStatus");
    HFC.setStatus(status, "Guardando configuracion...");
    try {
      await adminApi("/api/backoffice/ticketing", {
        method: "PUT",
        body: JSON.stringify({ ticketing: collectTicketingForm(event.currentTarget) })
      });
      await loadBackoffice();
      HFC.setStatus(HFC.$("#ticketingStatus"), "Entradas, valores y fechas guardadas.");
      HFC.toast("Entradas guardadas.");
    } catch (error) {
      HFC.setStatus(status, error.message, true);
    }
  });

  HFC.$("#guestForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = HFC.$("#guestStatus");
    HFC.setStatus(status, "Creando invitado...");
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.sendEmail = form.sendEmail.checked;
      await adminApi("/api/backoffice/guests", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      HFC.setStatus(status, "Invitado creado con entrada QR.");
      await loadBackoffice();
    } catch (error) {
      HFC.setStatus(status, error.message, true);
    }
  });

  HFC.$("#contactImportForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = HFC.$("#contactStatus");
    HFC.setStatus(status, "Importando contactos...");
    try {
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      const result = await adminApi("/api/backoffice/contacts/import", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      HFC.setStatus(status, `Contactos importados: ${result.imported}`);
      await loadBackoffice();
    } catch (error) {
      HFC.setStatus(status, error.message, true);
    }
  });

  HFC.$$("[data-update-contact-email]").forEach((button) => {
    button.addEventListener("click", async () => {
      const input = HFC.$(`[data-contact-email="${CSS.escape(button.dataset.updateContactEmail)}"]`);
      try {
        await adminApi(`/api/backoffice/contacts/${button.dataset.updateContactEmail}/email`, {
          method: "PATCH",
          body: JSON.stringify({ email: input.value })
        });
        HFC.toast("Correo de contacto actualizado.");
        await loadBackoffice();
      } catch (error) {
        HFC.toast(error.message);
      }
    });
  });

  HFC.$$("[data-update-user-email]").forEach((button) => {
    button.addEventListener("click", async () => {
      const input = HFC.$(`[data-user-email="${CSS.escape(button.dataset.updateUserEmail)}"]`);
      try {
        await adminApi(`/api/backoffice/users/${button.dataset.updateUserEmail}/email`, {
          method: "PATCH",
          body: JSON.stringify({ email: input.value, resend: true })
        });
        HFC.toast("Correo corregido y verificacion reenviada.");
        await loadBackoffice();
      } catch (error) {
        HFC.toast(error.message);
      }
    });
  });

  HFC.$$("[data-resend-user]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await adminApi(`/api/backoffice/users/${button.dataset.resendUser}/resend-verification`, {
          method: "POST",
          body: JSON.stringify({})
        });
        HFC.toast("Invitacion de enrolamiento reenviada.");
      } catch (error) {
        HFC.toast(error.message);
      }
    });
  });

  HFC.$("#userSearch")?.addEventListener("input", (event) => {
    const query = event.currentTarget.value.trim().toLowerCase();
    HFC.$$("[data-user-row]").forEach((row) => {
      row.hidden = query && !row.dataset.search.includes(query);
    });
  });

  HFC.$("#emailSendForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = HFC.$("#emailStatus");
    HFC.setStatus(status, "Enviando correos...");
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      const result = await adminApi("/api/backoffice/email/send", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      HFC.setStatus(status, `Enviados: ${result.sent}. Fallidos: ${result.failed}.`);
      await loadBackoffice();
    } catch (error) {
      HFC.setStatus(status, error.message, true);
    }
  });

  HFC.$("#templateForm")?.templateId?.addEventListener("change", (event) => {
    const template = backofficeData.emailTemplates.find((item) => item.id === event.currentTarget.value);
    const form = HFC.$("#templateForm");
    form.name.value = template?.name || "";
    form.subject.value = template?.subject || "";
    form.text.value = template?.text || "";
    form.html.value = template?.html || "";
  });

  HFC.$("#templateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = HFC.$("#templateStatus");
    HFC.setStatus(status, "Guardando plantilla...");
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      await adminApi(`/api/backoffice/email-templates/${payload.templateId}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      HFC.setStatus(status, "Plantilla guardada.");
      await loadBackoffice();
    } catch (error) {
      HFC.setStatus(status, error.message, true);
    }
  });

  HFC.$$("[data-resend]").forEach((button) => {
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
