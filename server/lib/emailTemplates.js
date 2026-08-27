const SUPPORT_WHATSAPP_URL =
  "https://wa.me/56972934950?text=Hola%20Honda%20Fest%20Chile%2C%20necesito%20ayuda%20con%20mi%20compra%20o%20entrada";

function emailButton(href, label, variant = "primary") {
  const background = variant === "dark" ? "#143b36" : "#d71920";
  return [
    `<a href="${href}" style="background:${background};border-radius:6px;color:#ffffff;display:inline-block;font-size:16px;font-weight:700;line-height:1.2;padding:14px 18px;text-decoration:none;">`,
    label,
    "</a>"
  ].join("");
}

function emailShell({ preheader, eyebrow, title, intro, content, footerNote = "" }) {
  return [
    '<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${title}</title></head>`,
    '<body style="margin:0;padding:0;background:#f3f4f2;font-family:Arial,Helvetica,sans-serif;color:#17191f;">',
    `<div style="display:none;font-size:1px;color:#f3f4f2;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>`,
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f3f4f2;">',
    '<tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;max-width:640px;background:#ffffff;border:1px solid #e4e5df;">',
    '<tr><td style="background:#111111;padding:22px 24px;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;"><tr>',
    '<td style="vertical-align:middle;"><span style="background:#ffffff;color:#111111;display:inline-block;font-size:18px;font-weight:800;letter-spacing:0;padding:11px 13px;">HFC</span></td>',
    '<td align="right" style="color:#ffffff;font-size:14px;font-weight:700;vertical-align:middle;">Honda Fest Chile</td>',
    "</tr></table>",
    "</td></tr>",
    '<tr><td style="padding:30px 28px 10px;">',
    `<p style="color:#d71920;font-size:12px;font-weight:800;letter-spacing:.08em;margin:0 0 10px;text-transform:uppercase;">${eyebrow}</p>`,
    `<h1 style="color:#17191f;font-size:28px;line-height:1.15;margin:0 0 14px;">${title}</h1>`,
    `<p style="color:#4c5563;font-size:16px;line-height:1.55;margin:0;">${intro}</p>`,
    "</td></tr>",
    `<tr><td style="padding:18px 28px 30px;">${content}</td></tr>`,
    '<tr><td style="background:#f7f7f4;border-top:1px solid #e4e5df;padding:18px 28px;">',
    `<p style="color:#5f6673;font-size:13px;line-height:1.5;margin:0;">${footerNote || "Este correo es transaccional y fue enviado por una accion realizada en hondafestchile.cl."}</p>`,
    '<p style="color:#8a9099;font-size:12px;line-height:1.5;margin:10px 0 0;">2026 PyR Eventos - contacto@hondafestchile.cl<br>Sistema desarrollado por Prof3sional.com - contacto@prof3sional.com</p>',
    "</td></tr>",
    "</table>",
    "</td></tr>",
    "</table>",
    "</body></html>"
  ].join("");
}

function orderSummaryBlock(extra = "") {
  return [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#fafafa;border:1px solid #e4e5df;margin:0 0 18px;">',
    '<tr><td style="padding:14px 16px;">',
    '<p style="color:#6b7280;font-size:12px;font-weight:800;letter-spacing:.06em;margin:0 0 4px;text-transform:uppercase;">Orden</p>',
    '<p style="color:#17191f;font-size:15px;font-weight:700;margin:0;">{{order_id}}</p>',
    extra,
    "</td></tr>",
    "</table>"
  ].join("");
}

function orderItemsTable() {
  return [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e4e5df;margin:0 0 18px;">',
    '<tr>',
    '<th align="left" style="background:#17191f;color:#ffffff;font-size:13px;padding:12px;">Producto</th>',
    '<th align="left" style="background:#17191f;color:#ffffff;font-size:13px;padding:12px;">Cant.</th>',
    '<th align="left" style="background:#17191f;color:#ffffff;font-size:13px;padding:12px;">Precio</th>',
    "</tr>",
    "{{order_items_html}}",
    "</table>"
  ].join("");
}

function helpLine() {
  return `<p style="color:#4c5563;font-size:14px;line-height:1.5;margin:18px 0 0;">Si tienes problemas con tu compra, entrada, QR o boleta, responde este correo o escribenos por WhatsApp: <a href="${SUPPORT_WHATSAPP_URL}" style="color:#143b36;font-weight:700;text-decoration:none;">+56 9 7293 4950</a>.</p>`;
}

const defaultEmailTemplates = [
  {
    id: "payment",
    type: "payment",
    name: "Pago confirmado",
    subject: "Pago confirmado - {{event_name}}",
    text: [
      "Hola {{name}}.",
      "Tu pago fue confirmado para {{event_name}}.",
      "Orden: {{order_id}}",
      "Entradas:",
      "{{ticket_list_text}}",
      "Boleta: {{invoice_label_text}}",
      `Ayuda: ${SUPPORT_WHATSAPP_URL}`
    ].join("\n"),
    html: emailShell({
      preheader: "Tu pago fue confirmado. Revisa el detalle de tu compra y la boleta.",
      eyebrow: "Pago confirmado",
      title: "Tu compra esta confirmada",
      intro: "Hola {{name}}, recibimos correctamente tu pago para {{event_name}}. Conserva este correo como respaldo de tu compra.",
      content: [
        orderSummaryBlock('<p style="color:#4c5563;font-size:14px;margin:8px 0 0;"><strong>Evento:</strong> {{event_name}}</p>'),
        '<h2 style="color:#17191f;font-size:18px;margin:0 0 10px;">Entradas</h2>',
        "{{ticket_list_compact_html}}",
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f7faf8;border:1px solid #cfe5d5;margin:18px 0 0;"><tr><td style="padding:14px 16px;">',
        '<p style="color:#2f6b3f;font-size:12px;font-weight:800;letter-spacing:.06em;margin:0 0 4px;text-transform:uppercase;">Boleta</p>',
        '<p style="color:#17191f;font-size:15px;line-height:1.5;margin:0;">{{invoice_label_html}}</p>',
        "</td></tr></table>",
        helpLine()
      ].join("")
    })
  },
  {
    id: "enrollment_invitation",
    type: "enrollment_invitation",
    name: "Confirmacion de compra y enrolamiento",
    subject: "Completa tus datos - {{event_name}}",
    text: [
      "Hola {{name}}.",
      "Gracias por tu compra en Honda Fest Chile.",
      "Orden: {{order_id}}",
      "Detalle:",
      "{{order_items_text}}",
      "Completa tus datos para obtener tu entrada personal:",
      "{{enroll_url}}",
      "QR: {{enroll_qr_url}}",
      "El dia del evento podras ingresar mostrando tu Cedula de Identidad o Pasaporte si no tienes RUT."
    ].join("\n"),
    html: emailShell({
      preheader: "Tu compra fue recibida. Completa tus datos para obtener tu entrada personal.",
      eyebrow: "Compra recibida",
      title: "Completa tu enrolamiento",
      intro: "Hola {{name}}, tu pedido fue procesado. Para generar tu entrada personal necesitamos que completes tus datos desde este enlace seguro.",
      content: [
        orderSummaryBlock(),
        orderItemsTable(),
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#fff5f6;border:1px solid #f3c4cc;margin:0 0 18px;"><tr><td style="padding:16px;">',
        '<p style="color:#17191f;font-size:15px;line-height:1.55;margin:0;">El dia del evento podras ingresar mostrando tu Cedula de Identidad o Pasaporte si no tienes RUT.</p>',
        "</td></tr></table>",
        `<p style="margin:0 0 16px;text-align:center;">${emailButton("{{enroll_url}}", "Ver mi pedido y enrolarme")}</p>`,
        '<p style="margin:0 0 14px;text-align:center;"><img src="{{enroll_qr_url}}" alt="QR para enrolamiento" width="170" style="height:auto;max-width:170px;"></p>',
        '<p style="color:#6b7280;font-size:13px;line-height:1.5;margin:0;text-align:center;">Tambien puedes abrir este enlace:<br><a href="{{enroll_url}}" style="color:#d71920;word-break:break-all;">{{enroll_url}}</a></p>',
        helpLine()
      ].join("")
    })
  },
  {
    id: "ticket_after_enrollment",
    type: "ticket_after_enrollment",
    name: "Entrada contra enrolamiento",
    subject: "Tu entrada - {{event_name}}",
    text: [
      "Hola {{name}}.",
      "Esta es tu entrada para {{event_name}}.",
      "{{ticket_list_text}}",
      "Presenta el QR o codigo en puerta."
    ].join("\n"),
    html: emailShell({
      preheader: "Tu entrada esta lista. Presenta el QR o codigo en puerta.",
      eyebrow: "Entrada lista",
      title: "Tu entrada esta lista",
      intro: "Hola {{name}}, presenta el QR o codigo de este correo en puerta para ingresar a {{event_name}}.",
      content: [
        "{{ticket_list_html}}",
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f7faf8;border:1px solid #cfe5d5;margin:18px 0 0;"><tr><td style="padding:14px 16px;">',
        '<p style="color:#17191f;font-size:14px;line-height:1.5;margin:0;">Recomendacion: lleva tu cedula de identidad o pasaporte. El codigo QR tambien puede validarse manualmente con el codigo impreso.</p>',
        "</td></tr></table>",
        helpLine()
      ].join("")
    })
  },
  {
    id: "special_pass_enrollment",
    type: "special_pass_enrollment",
    name: "Pase pendiente de enrolamiento",
    subject: "Completa los datos de tu {{pass_name}} - Honda Fest Chile",
    text: [
      "Hola {{name}}.",
      "Tu pago del {{pass_name}} fue confirmado.",
      "Nivel: {{piston_count}} {{piston_label}}.",
      "Tu Upgrade incluye un refresco extra y tus Pistones registrados para el sorteo, sujeto a bases.",
      "IMPORTANTE: NO ES VÁLIDO COMO ENTRADA.",
      "Para ingresar al evento debes contar además con una entrada válida.",
      "Completa los datos del titular para emitir la credencial impresa:",
      "{{enroll_url}}",
      "Retiro: {{pickup_event_day}}",
      "{{pickup_pre_event}}"
    ].join("\n"),
    html: emailShell({
      preheader: "Tu Pase fue pagado. Completa el enrolamiento del titular.",
      eyebrow: "Pase HFC 2026",
      title: "Completa el enrolamiento de tu pase",
      intro: "Hola {{name}}, recibimos el pago de tu {{pass_name}} con {{piston_count}} {{piston_label}}. Completa los datos del titular para emitir la credencial impresa.",
      content: [
        orderSummaryBlock('<p style="color:#4c5563;font-size:14px;margin:8px 0 0;"><strong>Nivel:</strong> {{piston_count}} {{piston_label}}</p>'),
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#17191f;border-left:5px solid #d71920;margin:0 0 18px;"><tr><td style="padding:16px 18px;">',
        '<p style="color:#ffffff;font-size:18px;font-weight:900;letter-spacing:.04em;margin:0 0 6px;">NO ES VÁLIDO COMO ENTRADA</p>',
        '<p style="color:#d8dbe0;font-size:14px;line-height:1.5;margin:0;">Para ingresar debes contar además con una entrada válida para Honda Fest Chile. La compra del pase no verifica ni reemplaza esa entrada.</p>',
        "</td></tr></table>",
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#fff7f0;border:1px solid #f1c99e;margin:0 0 18px;"><tr><td style="padding:16px 18px;"><p style="color:#7a3e00;font-size:15px;font-weight:900;margin:0 0 5px;">UPGRADE DE EXPERIENCIA</p><p style="color:#5b4633;font-size:14px;line-height:1.5;margin:0;">Tu Pase incluye un refresco extra. Mientras más Pistones elegiste, más posibilidades registradas tienes en el sorteo, sujeto a bases.</p></td></tr></table>',
        `<p style="margin:0 0 16px;text-align:center;">${emailButton("{{enroll_url}}", "Enrolar mi Pase")}</p>`,
        '<p style="margin:0 0 14px;text-align:center;"><img src="{{enroll_qr_url}}" alt="QR de enrolamiento" width="170" style="height:auto;max-width:170px;"></p>',
        '<p style="color:#4c5563;font-size:14px;line-height:1.55;margin:16px 0 0;"><strong>Retiro:</strong> {{pickup_event_day}}<br>{{pickup_pre_event}}</p>',
        helpLine()
      ].join("")
    })
  },
  {
    id: "special_pass_issued",
    type: "special_pass_issued",
    name: "Pase emitido",
    subject: "Tu {{pass_name}} está listo - {{piston_count}} {{piston_label}}",
    text: [
      "Hola {{name}}.",
      "Tu Pase HFC 2026 está listo.",
      "Código: {{pass_code}}",
      "Nivel: {{piston_count}} {{piston_label}}.",
      "Tu Upgrade incluye un refresco extra y tus Pistones registrados para el sorteo, sujeto a bases.",
      "IMPORTANTE: NO ES VÁLIDO COMO ENTRADA.",
      "Presenta este QR para retirar tu lanyard y credencial impresa.",
      "{{pass_verify_url}}",
      "Retiro: {{pickup_event_day}}",
      "{{pickup_pre_event}}"
    ].join("\n"),
    html: emailShell({
      preheader: "Tu Pase está listo para ser retirado con su QR.",
      eyebrow: "Credencial emitida",
      title: "Tu Pase está listo",
      intro: "Hola {{name}}, emitimos tu {{pass_name}} con {{piston_count}} {{piston_label}}. Conserva este QR para retirar el lanyard y la credencial impresa.",
      content: [
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#111111;border:1px solid #292929;margin:0 0 18px;"><tr><td align="center" style="padding:24px;">',
        '<p style="color:#d71920;font-size:12px;font-weight:900;letter-spacing:.08em;margin:0 0 8px;text-transform:uppercase;">{{piston_count}} {{piston_label}}</p>',
        '<p style="color:#ffffff;font-size:20px;font-weight:800;margin:0 0 14px;">{{pass_code}}</p>',
        '<img src="{{pass_qr_url}}" alt="QR {{pass_code}}" width="190" style="background:#fff;height:auto;max-width:190px;padding:8px;">',
        "</td></tr></table>",
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#fff2f3;border:1px solid #efb4bc;margin:0 0 18px;"><tr><td style="padding:16px;">',
        '<p style="color:#a20f18;font-size:17px;font-weight:900;margin:0 0 6px;">NO ES VÁLIDO COMO ENTRADA</p>',
        '<p style="color:#4c3034;font-size:14px;line-height:1.5;margin:0;">El Pase no reemplaza la entrada a Honda Fest Chile. El comprador debe contar con una entrada válida para ingresar.</p>',
        "</td></tr></table>",
        '<p style="color:#4c5563;font-size:14px;line-height:1.55;margin:0 0 14px;"><strong>Tu Upgrade:</strong> incluye un refresco extra y {{piston_count}} {{piston_label}} registrados para el sorteo, sujeto a bases.</p>',
        '<p style="color:#4c5563;font-size:14px;line-height:1.55;margin:0;"><strong>Retiro:</strong> {{pickup_event_day}}<br>{{pickup_pre_event}}</p>',
        helpLine()
      ].join("")
    })
  },
  {
    id: "payment_failed_retry",
    type: "payment_failed_retry",
    name: "Pago no finalizado",
    subject: "Tu compra no se finalizo - {{event_name}}",
    text: [
      "Hola {{name}}.",
      "Vimos que tu compra para {{event_name}} no se finalizo.",
      "Orden: {{order_id}}",
      "Detalle:",
      "{{order_items_text}}",
      "Puedes intentarlo nuevamente aqui:",
      "{{retry_url}}",
      "Si tienes problemas con el pago, orden, QR o entrada, escribe a soporte de ticketera por WhatsApp:",
      "{{whatsapp_url}}"
    ].join("\n"),
    html: emailShell({
      preheader: "Tu pago no se completo. Puedes intentarlo nuevamente o pedir ayuda por WhatsApp.",
      eyebrow: "Pago no finalizado",
      title: "Tu compra quedo pendiente",
      intro: "Hola {{name}}, vimos que tu compra para {{event_name}} no se finalizo. Si fue un error, puedes retomarla desde el boton.",
      content: [
        orderSummaryBlock(),
        orderItemsTable(),
        `<p style="margin:0 0 12px;text-align:center;">${emailButton("{{retry_url}}", "Intentar nuevamente")}</p>`,
        `<p style="margin:0;text-align:center;">${emailButton("{{whatsapp_url}}", "Ayuda compra/entrada", "dark")}</p>`
      ].join("")
    })
  },
  {
    id: "marketing",
    type: "marketing",
    name: "Correo libre / campana",
    subject: "{{campaign_title}}",
    text: ["Hola {{name}}.", "{{campaign_body}}", "{{cta_url}}"].join("\n"),
    html: emailShell({
      preheader: "{{campaign_title}}",
      eyebrow: "Honda Fest Chile",
      title: "{{campaign_title}}",
      intro: "Hola {{name}},",
      content: [
        '<div style="color:#4c5563;font-size:16px;line-height:1.6;margin:0 0 22px;">{{campaign_body}}</div>',
        `<p style="margin:0;">${emailButton("{{cta_url}}", "Ver mas")}</p>`,
        helpLine()
      ].join(""),
      footerNote: "Recibes este correo porque te registraste o interactuaste con Honda Fest Chile."
    })
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
  const ticketListCompactHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e4e5df;">${ticketRows
    .map(
      (ticket) =>
        `<tr><td style="border-bottom:1px solid #eceee8;padding:13px 15px;"><p style="color:#17191f;font-size:15px;font-weight:700;margin:0 0 4px;">${escapeHtml(ticket.code)}</p><p style="color:#6b7280;font-size:13px;line-height:1.45;margin:0;">${escapeHtml(ticket.holderName || "Asistente")}</p></td></tr>`
    )
    .join("")}</table>`;
  const ticketListHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e4e5df;">${ticketRows
    .map(
      (ticket) =>
        `<tr><td style="border-bottom:1px solid #eceee8;padding:16px;"><p style="color:#17191f;font-size:16px;font-weight:800;margin:0 0 6px;">${escapeHtml(ticket.code)}</p><p style="color:#6b7280;font-size:13px;line-height:1.45;margin:0 0 12px;">${escapeHtml(ticket.holderName || "Asistente")}</p><p style="margin:0 0 12px;"><img src="${escapeHtml(ticket.qrUrl)}" alt="QR ${escapeHtml(ticket.code)}" width="150" style="height:auto;max-width:150px;"></p><p style="color:#6b7280;font-size:12px;line-height:1.45;margin:0;">Validar: <a href="${escapeHtml(ticket.verifyUrl)}" style="color:#143b36;word-break:break-all;">${escapeHtml(ticket.verifyUrl)}</a></p></td></tr>`
    )
    .join("")}</table>`;
  const invoiceLabelText = invoice?.pdfBase64
    ? `PDF adjunto${invoice?.folio ? ` - folio ${invoice.folio}` : ""}`
    : invoice?.pdfUrl || invoice?.folio || invoice?.providerId || "en proceso";
  const invoiceLabelHtml = invoice?.pdfUrl
    ? `<a href="${escapeHtml(invoice.pdfUrl)}" style="color:#143b36;font-weight:700;word-break:break-all;">Ver boleta</a>`
    : escapeHtml(invoiceLabelText);

  return {
    name: user?.name || "Honda Fest",
    email: user?.email || "",
    event_name: eventName,
    order_id: order?.id || "",
    ticket_codes: ticketRows.map((ticket) => ticket.code).join(", "),
    ticket_list_text: ticketListText,
    ticket_list_html: ticketListHtml,
    ticket_list_compact_html: ticketListCompactHtml,
    invoice_label: invoiceLabelText,
    invoice_label_text: invoiceLabelText,
    invoice_label_html: invoiceLabelHtml,
    cta_url: baseUrl || "",
    enroll_url: baseUrl ? `${baseUrl}/enrolamiento` : "/enrolamiento",
    campaign_title: "Honda Fest Chile",
    campaign_body: "",
    support_whatsapp_url: SUPPORT_WHATSAPP_URL
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
