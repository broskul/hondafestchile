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
    name: "Confirmacion de compra y enrolamiento",
    subject: "Confirmacion de compra - {{event_name}}",
    text: [
      "Hola {{name}}.",
      "Gracias por tu compra en Honda Fest Chile. Tu pedido fue procesado exitosamente.",
      "Orden: {{order_id}}",
      "Detalle:",
      "{{order_items_text}}",
      "Si compraste entradas, enrolate con este link para obtener tu entrada personal:",
      "{{enroll_url}}",
      "QR: {{enroll_qr_url}}",
      "El dia del evento podras ingresar mostrando tu Cedula de Identidad o Pasaporte si no tienes RUT."
    ].join("\n"),
    html: [
      '<!doctype html><html lang="es"><head><meta charset="UTF-8"><title>Confirmacion de Compra - Honda Fest Chile</title></head>',
      '<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">',
      '<table style="width:100%;max-width:600px;margin:0 auto;border-spacing:0;background-color:#ffffff;">',
      '<tr><td style="padding:20px;text-align:center;background-color:#000000;">',
      '<img src="https://static.wixstatic.com/media/c04ebe_5948ba64ee9d42de93a3707c7e0ac029~mv2.png/v1/crop/x_571,y_541,w_2049,h_2078/fill/w_315,h_324,al_c,q_85,usm_0.66_1.00_0.01,enc_auto/Group%20945.png" alt="Honda Fest Logo" style="width:100%;max-width:270px;height:auto;">',
      "</td></tr>",
      '<tr><td style="padding:20px;">',
      '<h1 style="color:#333;margin-top:0;margin-bottom:20px;font-size:24px;">Gracias por tu compra</h1>',
      '<p style="color:#666;font-size:16px;line-height:1.5;margin-top:0;margin-bottom:16px;">Hola <strong>{{name}}</strong>,</p>',
      '<p style="color:#666;font-size:16px;line-height:1.5;margin-top:0;margin-bottom:16px;">Gracias por tu compra en el sitio Honda Fest Chile. Tu pedido ha sido procesado exitosamente. A continuacion encontraras los detalles de tu compra:</p>',
      '<p style="color:#333;font-size:14px;line-height:1.5;margin-top:0;margin-bottom:12px;"><strong>Orden:</strong> {{order_id}}</p>',
      '<table style="width:100%;border-collapse:collapse;background-color:#FAFAFA;border-radius:8px;overflow:hidden;font-size:16px;">',
      '<tr><th style="background-color:#da2f47;color:#ffffff;padding:12px;text-align:left;">Producto</th><th style="background-color:#da2f47;color:#ffffff;padding:12px;text-align:left;">Cantidad</th><th style="background-color:#da2f47;color:#ffffff;padding:12px;text-align:left;">Precio</th></tr>',
      "{{order_items_html}}",
      "</table>",
      '<p style="color:#666;font-size:16px;line-height:1.5;margin-top:20px;margin-bottom:16px;">Si compraste entradas, enrolate con el siguiente link para obtener tu entrada personal. El dia del evento podras ingresar solo mostrando tu Cedula de Identidad o Pasaporte si no tienes RUT.</p>',
      '<p style="text-align:center;margin:22px 0 12px;"><a href="{{enroll_url}}" style="background-color:#da2f47;color:#fff;padding:15px 20px;text-align:center;display:inline-block;text-decoration:none;font-size:18px;border-radius:5px;">Ver mi pedido y enrolarme</a></p>',
      '<p style="text-align:center;margin:8px 0 18px;"><img src="{{enroll_qr_url}}" alt="QR para enrolamiento" width="180" style="max-width:180px;height:auto;"></p>',
      '<p style="color:#666;font-size:14px;line-height:1.5;margin-top:0;margin-bottom:16px;">Tambien puedes abrir este enlace: <a href="{{enroll_url}}" style="color:#da2f47;">{{enroll_url}}</a></p>',
      '<p style="color:#666;font-size:16px;line-height:1.5;margin-top:0;margin-bottom:16px;">Si tienes alguna pregunta, no dudes en contactarnos.</p>',
      '<p style="color:#333;font-weight:bold;font-size:16px;line-height:1.5;margin-top:20px;margin-bottom:0;">Que disfrutes tu compra.</p>',
      "</td></tr>",
      '<tr><td style="padding:5px;text-align:center;background-color:#f4f4f4;">',
      '<p style="font-size:16px;color:#999999;margin:4px 0;">2026 PyR Eventos - contacto@hondafestchile.cl</p>',
      '<p style="font-size:14px;color:#999999;margin:4px 0;">Sistema desarrollado por Prof3sional.com - contacto@prof3sional.com</p>',
      "</td></tr>",
      "</table>",
      "</body></html>"
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
    enroll_url: baseUrl ? `${baseUrl}/enrolamiento` : "/enrolamiento",
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
