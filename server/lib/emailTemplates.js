const defaultEmailTemplates = [
  {
    id: "payment",
    type: "payment",
    name: "Pago confirmado",
    subject: "Tus entradas para {{event_name}}",
    text: [
      "Hola {{name}}.",
      "Tu pago fue confirmado para {{event_name}}.",
      "Orden: {{order_id}}",
      "Entradas:",
      "{{ticket_list_text}}",
      "Boleta: {{invoice_label}}"
    ].join("\n"),
    html: [
      '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#121212">',
      "<h1>Entradas confirmadas</h1>",
      "<p>Hola {{name}}, tu pago fue confirmado para <strong>{{event_name}}</strong>.</p>",
      "<p><strong>Orden:</strong> {{order_id}}</p>",
      "<p><strong>Entradas:</strong></p>",
      "{{ticket_list_html}}",
      "<p><strong>Boleta:</strong> {{invoice_label}}</p>",
      "</div>"
    ].join("")
  },
  {
    id: "enrollment_invitation",
    type: "enrollment_invitation",
    name: "Invitacion a enrolarse",
    subject: "Enrolate para {{event_name}}",
    text: [
      "Hola {{name}}.",
      "Te invitamos a enrolarte para {{event_name}}.",
      "Completa tu registro aqui: {{enroll_url}}"
    ].join("\n"),
    html: [
      '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#121212">',
      "<h1>Enrolate para {{event_name}}</h1>",
      "<p>Hola {{name}}, completa tu registro para recibir informacion y comprar entradas.</p>",
      '<p><a href="{{enroll_url}}" style="display:inline-block;background:#d71920;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">Enrolarme</a></p>',
      "</div>"
    ].join("")
  },
  {
    id: "ticket_after_enrollment",
    type: "ticket_after_enrollment",
    name: "Entrada contra enrolamiento",
    subject: "Tu entrada para {{event_name}}",
    text: [
      "Hola {{name}}.",
      "Esta es tu entrada para {{event_name}}.",
      "{{ticket_list_text}}",
      "Presenta el QR o codigo en puerta."
    ].join("\n"),
    html: [
      '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#121212">',
      "<h1>Tu entrada</h1>",
      "<p>Hola {{name}}, presenta este QR o codigo en puerta para ingresar a <strong>{{event_name}}</strong>.</p>",
      "{{ticket_list_html}}",
      "</div>"
    ].join("")
  },
  {
    id: "marketing",
    type: "marketing",
    name: "Correo libre / campana",
    subject: "{{campaign_title}}",
    text: ["Hola {{name}}.", "{{campaign_body}}", "{{cta_url}}"].join("\n"),
    html: [
      '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#121212">',
      "<h1>{{campaign_title}}</h1>",
      "<p>Hola {{name}},</p>",
      "<p>{{campaign_body}}</p>",
      '<p><a href="{{cta_url}}" style="display:inline-block;background:#d71920;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">Ver mas</a></p>',
      "</div>"
    ].join("")
  }
];

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

function normalizeTemplate(template = {}) {
  const fallback = defaultEmailTemplates.find((candidate) => candidate.id === template.id) || {};
  return {
    ...fallback,
    ...template,
    id: String(template.id || fallback.id || "").trim(),
    type: String(template.type || fallback.type || template.id || "").trim(),
    name: String(template.name || fallback.name || template.id || "").trim(),
    subject: String(template.subject || fallback.subject || "").trim(),
    text: String(template.text || fallback.text || "").trim(),
    html: String(template.html || fallback.html || "").trim()
  };
}

function mergeTemplates(customTemplates = []) {
  const byId = new Map(defaultEmailTemplates.map((template) => [template.id, normalizeTemplate(template)]));
  for (const template of customTemplates || []) {
    if (!template?.id) continue;
    byId.set(template.id, normalizeTemplate(template));
  }
  return Array.from(byId.values());
}

function findTemplate(customTemplates, idOrType) {
  const templates = mergeTemplates(customTemplates);
  return (
    templates.find((template) => template.id === idOrType) ||
    templates.find((template) => template.type === idOrType) ||
    null
  );
}

function renderTemplateString(template, variables = {}) {
  return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key) => {
    const value = variables[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function renderTemplate(template, variables = {}) {
  const normalized = normalizeTemplate(template);
  return {
    subject: renderTemplateString(normalized.subject, variables),
    text: renderTemplateString(normalized.text, variables),
    html: renderTemplateString(normalized.html, variables)
  };
}

function ticketEmailVariables({ user, order, event, tickets = [], invoice, baseUrl = "" }) {
  const eventName = event?.name || order?.items?.[0]?.eventName || "Honda Fest Chile";
  const ticketRows = tickets.map((ticket) => {
    const verifyUrl =
      ticket.verifyUrl ||
      (baseUrl ? `${baseUrl}/validar?code=${encodeURIComponent(ticket.code)}` : `/validar?code=${ticket.code}`);
    const qrUrl =
      ticket.qrUrl ||
      (baseUrl ? `${baseUrl}/api/tickets/${encodeURIComponent(ticket.code)}/qr.svg` : `/api/tickets/${ticket.code}/qr.svg`);
    return {
      code: ticket.code,
      holderName: ticket.holderName || user?.name || "",
      verifyUrl,
      qrUrl
    };
  });
  const ticketListText = ticketRows
    .map((ticket) => `- ${ticket.code} / validar: ${ticket.verifyUrl}`)
    .join("\n");
  const ticketListHtml = `<ul>${ticketRows
    .map(
      (ticket) =>
        `<li><strong>${escapeHtml(ticket.code)}</strong><br /><a href="${escapeHtml(ticket.verifyUrl)}">${escapeHtml(ticket.verifyUrl)}</a><br /><img src="${escapeHtml(ticket.qrUrl)}" alt="QR ${escapeHtml(ticket.code)}" width="160" /></li>`
    )
    .join("")}</ul>`;
  const invoiceLabel = invoice?.pdfUrl || invoice?.folio || invoice?.providerId || "en proceso";

  return {
    name: user?.name || "Honda Fest",
    email: user?.email || "",
    event_name: eventName,
    order_id: order?.id || "",
    ticket_codes: ticketRows.map((ticket) => ticket.code).join(", "),
    ticket_list_text: ticketListText,
    ticket_list_html: ticketListHtml,
    invoice_label: invoiceLabel,
    cta_url: baseUrl || "",
    enroll_url: baseUrl ? `${baseUrl}/ticketera` : "/ticketera",
    campaign_title: "Honda Fest Chile",
    campaign_body: ""
  };
}

module.exports = {
  defaultEmailTemplates,
  findTemplate,
  mergeTemplates,
  normalizeTemplate,
  renderTemplate,
  renderTemplateString,
  ticketEmailVariables
};
