const nodemailer = require("nodemailer");

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
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

async function sendMail(message) {
  const transporter = getTransporter();
  const mail = {
    from: process.env.SMTP_FROM || "Honda Fest Chile <tickets@hondafestchile.cl>",
    ...message
  };

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

async function sendVerificationEmail({ user, verificationUrl }) {
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

async function sendTicketEmail({ user, order, event, ticketType, tickets, invoice }) {
  const ticketLines = tickets.map((ticket) => `Ticket ${ticket.code}`).join("\n");
  const invoiceLine = invoice?.pdfUrl
    ? `Boleta: ${invoice.pdfUrl}`
    : `Boleta: ${invoice?.folio || invoice?.providerId || "en proceso"}`;

  return sendMail({
    to: user.email,
    subject: `Tus entradas para ${event.name}`,
    text: [
      `Hola ${user.name}.`,
      `Tu compra para ${event.name} fue confirmada.`,
      `Entrada: ${ticketType.name}`,
      `Orden: ${order.id}`,
      ticketLines,
      invoiceLine
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#121212">
        <h1>Entradas confirmadas</h1>
        <p>Hola ${user.name}, tu compra para <strong>${event.name}</strong> fue confirmada.</p>
        <p><strong>Orden:</strong> ${order.id}</p>
        <p><strong>Entrada:</strong> ${ticketType.name}</p>
        <ul>
          ${tickets.map((ticket) => `<li><strong>${ticket.code}</strong></li>`).join("")}
        </ul>
        <p><strong>Boleta:</strong> ${
          invoice?.pdfUrl
            ? `<a href="${invoice.pdfUrl}">${invoice.pdfUrl}</a>`
            : invoice?.folio || invoice?.providerId || "en proceso"
        }</p>
      </div>
    `
  });
}

module.exports = {
  sendMail,
  sendTicketEmail,
  sendVerificationEmail,
  smtpConfigured
};
