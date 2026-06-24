const nodemailer = require("nodemailer");
const { renderTemplate, ticketEmailVariables } = require("./emailTemplates");

let graphTokenCache = null;

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function cleanEnv(name) {
  return String(process.env[name] || "").trim();
}

function senderAddress() {
  const explicit = cleanEnv("MS_SENDER_EMAIL") || cleanEnv("SMTP_USER");
  if (explicit) return explicit;

  const from = cleanEnv("SMTP_FROM");
  const match = from.match(/<([^>]+)>/);
  return match ? match[1].trim() : from;
}

function replyToAddress() {
  return cleanEnv("MAIL_REPLY_TO") || cleanEnv("CONTACT_TO") || cleanEnv("OPENFACTURA_COMPANY_EMAIL") || "contacto@hondafestchile.cl";
}

function graphConfigured() {
  return Boolean(
    cleanEnv("MS_TENANT_ID") &&
      cleanEnv("MS_CLIENT_ID") &&
      cleanEnv("MS_CLIENT_SECRET") &&
      senderAddress()
  );
}

function mailProviderStatus() {
  return {
    provider: graphConfigured() ? "ms-graph" : smtpConfigured() ? "smtp" : "demo",
    msGraph: graphConfigured(),
    smtp: smtpConfigured(),
    sender: senderAddress() || null
  };
}

function getTransporter() {
  if (!smtpConfigured()) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function recipientList(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(/[;,]/);
  return values.map((item) => String(item || "").trim()).filter(Boolean);
}

function graphAttachments(attachments = []) {
  return attachments
    .filter((attachment) => attachment?.contentBytes || attachment?.content)
    .map((attachment) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: attachment.filename || attachment.name || "archivo.pdf",
      contentType: attachment.contentType || "application/octet-stream",
      contentBytes: attachment.contentBytes || Buffer.from(attachment.content).toString("base64")
    }));
}

function pdfBase64Value(value) {
  if (!value) return "";
  if (typeof value === "object") {
    return (
      pdfBase64Value(value.base64) ||
      pdfBase64Value(value.PDF) ||
      pdfBase64Value(value.pdf) ||
      pdfBase64Value(value.contentBytes)
    );
  }
  return String(value).replace(/^data:application\/pdf;base64,/i, "").replace(/\s+/g, "");
}

function invoiceAttachments(invoice) {
  const pdfBase64 = pdfBase64Value(
    invoice?.pdfBase64 ||
      invoice?.raw?.PDF ||
      invoice?.raw?.pdf ||
      invoice?.raw?.response?.PDF ||
      invoice?.raw?.response?.pdf ||
      invoice?.raw?.data?.PDF ||
      invoice?.raw?.data?.pdf
  );
  if (!pdfBase64) return [];
  return [
    {
      filename: invoice.pdfFileName || `boleta-${invoice.folio || invoice.orderId || "hondafest"}.pdf`,
      contentType: "application/pdf",
      content: Buffer.from(pdfBase64, "base64"),
      contentBytes: pdfBase64
    }
  ];
}

async function getGraphAccessToken() {
  if (graphTokenCache && graphTokenCache.expiresAt > Date.now() + 60000) {
    return graphTokenCache.accessToken;
  }

  const body = new URLSearchParams({
    client_id: cleanEnv("MS_CLIENT_ID"),
    client_secret: cleanEnv("MS_CLIENT_SECRET"),
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials"
  });

  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(cleanEnv("MS_TENANT_ID"))}/oauth2/v2.0/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error_description || payload.error || "No se pudo obtener token Microsoft Graph";
    throw new Error(`Microsoft Graph auth: ${detail}`);
  }

  graphTokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000
  };
  return graphTokenCache.accessToken;
}

async function sendWithGraph(mail) {
  const accessToken = await getGraphAccessToken();
  const sender = senderAddress();
  const html = mail.html || "";
  const text = mail.text || "";
  const content = html || text;
  const attachments = graphAttachments(mail.attachments);
  const replyTo = recipientList(mail.replyTo);
  const internetMessageHeaders = Object.entries(mail.headers || {}).map(([name, value]) => ({
    name,
    value: String(value)
  }));
  const message = {
    subject: mail.subject,
    body: {
      contentType: html ? "HTML" : "Text",
      content
    },
    toRecipients: recipientList(mail.to).map((address) => ({
      emailAddress: { address }
    })),
    ccRecipients: recipientList(mail.cc).map((address) => ({
      emailAddress: { address }
    })),
    bccRecipients: recipientList(mail.bcc).map((address) => ({
      emailAddress: { address }
    }))
  };
  if (replyTo.length) {
    message.replyTo = replyTo.map((address) => ({ emailAddress: { address } }));
  }
  if (attachments.length) {
    message.attachments = attachments;
  }
  if (internetMessageHeaders.length) {
    message.internetMessageHeaders = internetMessageHeaders;
  }

  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message,
      saveToSentItems: cleanEnv("MS_SAVE_TO_SENT_ITEMS") !== "false"
    })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const detail = payload?.error?.message || payload?.message || "No se pudo enviar correo";
    throw new Error(`Microsoft Graph sendMail: ${detail}`);
  }

  return { delivered: true, mode: "ms-graph", messageId: null };
}

async function sendMail(message) {
  const mail = {
    from: process.env.SMTP_FROM || "Honda Fest Chile <ticketera@hondafestchile.cl>",
    replyTo: replyToAddress(),
    ...message,
    headers: {
      "X-Auto-Response-Suppress": "OOF, AutoReply",
      "X-Entity-Ref-ID": `hfc-${Date.now()}`,
      ...(message.headers || {})
    }
  };

  if (graphConfigured()) {
    return sendWithGraph(mail);
  }

  const transporter = getTransporter();
  if (!transporter) {
    console.info("[email-demo]", {
      to: mail.to,
      subject: mail.subject,
      text: mail.text
    });
    return { delivered: false, mode: "demo" };
  }

  const result = await transporter.sendMail(mail);
  return { delivered: true, mode: "smtp", messageId: result.messageId };
}

async function sendVerificationEmail({ user, verificationUrl, template }) {
  if (template) {
    const rendered = renderTemplate(template, {
      name: user.name,
      email: user.email,
      event_name: "Honda Fest Chile",
      verification_url: verificationUrl,
      enroll_url: verificationUrl,
      cta_url: verificationUrl
    });
    return sendMail({
      to: user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html
    });
  }

  return sendMail({
    to: user.email,
    subject: "Confirma tu correo para Honda Fest Chile",
    text: `Hola ${user.name}. Confirma tu correo entrando a: ${verificationUrl}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#121212">
        <h1>Confirma tu correo</h1>
        <p>Hola ${user.name}, confirma tu correo para completar tu enrolamiento en Honda Fest Chile.</p>
        <p><a href="${verificationUrl}" style="display:inline-block;background:#d71920;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">Confirmar correo</a></p>
        <p>Si no solicitaste este registro, puedes ignorar este mensaje.</p>
      </div>
    `
  });
}

async function sendTicketEmail({ user, order, event, ticketType, tickets, invoice, template, baseUrl, to }) {
  const recipient = to || user.email;
  const attachments = invoiceAttachments(invoice);
  if (template) {
    const rendered = renderTemplate(template, ticketEmailVariables({ user, order, event, tickets, invoice, baseUrl }));
    return sendMail({
      to: recipient,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      attachments
    });
  }

  const items = order.items?.length
    ? order.items
    : [
        {
          eventName: event.name,
          ticketTypeName: ticketType.name,
          quantity: order.quantity,
          total: order.total
        }
      ];
  const eventName = items.length === 1 ? items[0].eventName : "Honda Fest Chile";
  const ticketName = items.length === 1 ? items[0].ticketTypeName : "Compra multiproducto";
  const itemLines = items
    .map((item) => `${item.quantity} x ${item.ticketTypeName} - ${item.eventName}`)
    .join("\n");
  const itemHtml = items
    .map((item) => `<li>${item.quantity} x <strong>${item.ticketTypeName}</strong> - ${item.eventName}</li>`)
    .join("");
  const ticketLines = tickets.map((ticket) => `Ticket ${ticket.code}`).join("\n");
  const invoiceLine = invoice?.pdfUrl
    ? `Boleta: ${invoice.pdfUrl}`
    : `Boleta: ${invoice?.folio || invoice?.providerId || "en proceso"}`;

  return sendMail({
    to: recipient,
    subject: `Tus entradas para ${eventName}`,
    text: [
      `Hola ${user.name}.`,
      `Tu compra fue confirmada.`,
      `Entrada: ${ticketName}`,
      `Orden: ${order.id}`,
      itemLines,
      ticketLines,
      invoiceLine
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#121212">
        <h1>Entradas confirmadas</h1>
        <p>Hola ${user.name}, tu compra fue confirmada.</p>
        <p><strong>Orden:</strong> ${order.id}</p>
        <p><strong>Entradas:</strong></p>
        <ul>${itemHtml}</ul>
        <ul>
          ${tickets.map((ticket) => `<li><strong>${ticket.code}</strong></li>`).join("")}
        </ul>
        <p><strong>Boleta:</strong> ${
          invoice?.pdfUrl
            ? `<a href="${invoice.pdfUrl}">${invoice.pdfUrl}</a>`
            : invoice?.folio || invoice?.providerId || "en proceso"
        }</p>
      </div>
    `,
    attachments
  });
}

module.exports = {
  graphConfigured,
  mailProviderStatus,
  sendMail,
  sendTicketEmail,
  sendVerificationEmail,
  smtpConfigured
};
