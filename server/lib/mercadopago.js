const crypto = require("crypto");

const MERCADOPAGO_API_BASE = "https://api.mercadopago.com";

function cleanEnv(name) {
  const value = String(process.env[name] || "").trim();
  return value === "\"\"" || value === "''" ? "" : value;
}

function envFlag(name) {
  return /^(1|true|yes|si|sí)$/i.test(cleanEnv(name));
}

function mercadoPagoConfigured() {
  return Boolean(cleanEnv("MERCADOPAGO_ACCESS_TOKEN"));
}

function mercadoPagoPublicKey() {
  return cleanEnv("MERCADOPAGO_PUBLIC_KEY");
}

function mercadoPagoInternalCheckoutEnabled() {
  if (!mercadoPagoConfigured() || !mercadoPagoPublicKey()) return false;
  if (/^(0|false|no)$/i.test(cleanEnv("MERCADOPAGO_INTERNAL_CHECKOUT"))) return false;
  return true;
}

function mercadoPagoWebhookSignatureConfigured() {
  return Boolean(cleanEnv("MERCADOPAGO_WEBHOOK_SECRET"));
}

function getBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  }

  return `${req.protocol}://${req.get("host")}`;
}

async function createPreference({ req, order, user, event, ticketType }) {
  if (!mercadoPagoConfigured()) {
    return {
      mode: "demo",
      checkoutUrl: `/?checkout=demo&order=${order.id}`,
      preferenceId: null
    };
  }

  const baseUrl = getBaseUrl(req);
  const notificationUrl =
    cleanEnv("MERCADOPAGO_NOTIFICATION_URL") || `${baseUrl}/api/webhooks/mercadopago`;
  const items = order.items?.length
    ? order.items.map((item) => ({
        id: item.ticketTypeId,
        title: `${item.ticketTypeName} - ${item.eventName}`,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        currency_id: "CLP"
      }))
    : [
        {
          id: ticketType.id,
          title: `${ticketType.name} - ${event.name}`,
          description: ticketType.description,
          quantity: order.quantity,
          unit_price: ticketType.price,
          currency_id: "CLP"
        }
      ];

  const body = {
    items,
    payer: {
      name: user.name,
      email: user.email
    },
    external_reference: order.id,
    back_urls: {
      success: `${baseUrl}/carrito?payment=success&order=${order.id}`,
      failure: `${baseUrl}/carrito?payment=failure&order=${order.id}`,
      pending: `${baseUrl}/carrito?payment=pending&order=${order.id}`
    },
    notification_url: notificationUrl,
    auto_return: "approved",
    metadata: {
      event_id: event?.id || order.items?.[0]?.eventId,
      ticket_type_id: ticketType?.id || order.items?.[0]?.ticketTypeId,
      user_id: user.id
    }
  };

  if (cleanEnv("MERCADOPAGO_STATEMENT_DESCRIPTOR")) {
    body.statement_descriptor = cleanEnv("MERCADOPAGO_STATEMENT_DESCRIPTOR");
  }

  if (cleanEnv("MERCADOPAGO_BINARY_MODE")) {
    body.binary_mode = envFlag("MERCADOPAGO_BINARY_MODE");
  }

  const response = await fetch(`${MERCADOPAGO_API_BASE}/checkout/preferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cleanEnv("MERCADOPAGO_ACCESS_TOKEN")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!response.ok) {
    const detail = payload?.message || payload?.error || "No se pudo crear la preferencia";
    throw new Error(`Mercado Pago: ${detail}`);
  }

  return {
    mode: "mercadopago",
    checkoutUrl: envFlag("MERCADOPAGO_USE_SANDBOX")
      ? payload.sandbox_init_point || payload.init_point
      : payload.init_point || payload.sandbox_init_point,
    preferenceId: payload.id
  };
}

async function getPayment(paymentId) {
  if (!mercadoPagoConfigured()) {
    throw new Error("Mercado Pago no esta configurado");
  }

  const response = await fetch(`${MERCADOPAGO_API_BASE}/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${cleanEnv("MERCADOPAGO_ACCESS_TOKEN")}`
    }
  });

  const payload = await response.json();
  if (!response.ok) {
    const detail = payload?.message || payload?.error || "No se pudo consultar el pago";
    throw new Error(`Mercado Pago: ${detail}`);
  }

  return payload;
}

function definedObject(value) {
  if (Array.isArray(value)) {
    return value.map(definedObject).filter((item) => item !== undefined);
  }

  if (!value || typeof value !== "object") {
    return value === undefined || value === "" ? undefined : value;
  }

  const entries = Object.entries(value)
    .map(([key, item]) => [key, definedObject(item)])
    .filter(([, item]) => item !== undefined);

  return entries.length ? Object.fromEntries(entries) : undefined;
}

function paymentNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function createCardPayment({ req, order, user, formData = {}, idempotencyKey }) {
  if (!mercadoPagoConfigured()) {
    throw new Error("Mercado Pago no esta configurado");
  }

  const token = cleanValue(formData.token);
  const paymentMethodId = cleanValue(formData.payment_method_id || formData.paymentMethodId);
  const installments = paymentNumber(formData.installments, 1);
  const payer = formData.payer || {};
  const identification = payer.identification || {};

  if (!token || !paymentMethodId) {
    const error = new Error("Faltan datos seguros de Mercado Pago para procesar el pago");
    error.status = 400;
    throw error;
  }

  const baseUrl = getBaseUrl(req);
  const notificationUrl =
    cleanEnv("MERCADOPAGO_NOTIFICATION_URL") || `${baseUrl}/api/webhooks/mercadopago`;
  const externalReference = order.id;
  const body = definedObject({
    token,
    transaction_amount: paymentNumber(order.total),
    installments,
    payment_method_id: paymentMethodId,
    issuer_id: cleanValue(formData.issuer_id || formData.issuerId),
    description: `Honda Fest Chile - orden ${order.id}`,
    external_reference: externalReference,
    notification_url: notificationUrl,
    binary_mode: cleanEnv("MERCADOPAGO_BINARY_MODE") ? envFlag("MERCADOPAGO_BINARY_MODE") : undefined,
    statement_descriptor: cleanEnv("MERCADOPAGO_STATEMENT_DESCRIPTOR"),
    payer: {
      email: cleanValue(payer.email || formData.cardholderEmail || user.email),
      identification: {
        type: cleanValue(identification.type || formData.identificationType),
        number: cleanValue(identification.number || formData.identificationNumber)
      }
    },
    metadata: {
      order_id: order.id,
      user_id: user.id,
      source: "hfc_internal_checkout"
    },
    additional_info: {
      items: (order.items || []).map((item) => ({
        id: item.ticketTypeId,
        title: `${item.ticketTypeName} - ${item.eventName}`,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice
      }))
    }
  });

  const response = await fetch(`${MERCADOPAGO_API_BASE}/v1/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cleanEnv("MERCADOPAGO_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key":
        cleanValue(idempotencyKey) ||
        crypto.createHash("sha256").update(`${order.id}:${token}`).digest("hex")
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      payload?.message ||
      payload?.error ||
      payload?.cause?.[0]?.description ||
      "No se pudo crear el pago";
    const error = new Error(`Mercado Pago: ${detail}`);
    error.status = response.status >= 400 && response.status < 500 ? 400 : 502;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function cleanValue(value) {
  return String(value || "").trim();
}

function parseSignatureHeader(value = "") {
  return String(value)
    .split(",")
    .map((part) => part.trim().split("="))
    .reduce((parts, [key, ...valueParts]) => {
      if (key && valueParts.length) {
        parts[key.trim()] = valueParts.join("=").trim();
      }
      return parts;
    }, {});
}

function safeHexCompare(a, b) {
  const first = Buffer.from(String(a || "").toLowerCase(), "hex");
  const second = Buffer.from(String(b || "").toLowerCase(), "hex");
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

function extractPaymentId(req) {
  const directId =
    req.query?.["data.id"] ||
    req.query?.id ||
    req.body?.data?.id ||
    req.body?.id ||
    "";

  if (directId) return String(directId);

  const resource = String(req.body?.resource || req.query?.resource || "");
  const match = resource.match(/\/payments\/([^/?#]+)/i);
  return match ? match[1] : "";
}

function parseWebhookNotification(req) {
  const topic =
    req.query?.type ||
    req.query?.topic ||
    req.body?.type ||
    req.body?.topic ||
    "";

  return {
    topic: String(topic),
    paymentId: extractPaymentId(req)
  };
}

function verifyWebhookSignature(req) {
  const secret = cleanEnv("MERCADOPAGO_WEBHOOK_SECRET");
  if (!secret) {
    return { checked: false, valid: true };
  }

  const signature = parseSignatureHeader(req.get("x-signature"));
  const requestId = String(req.get("x-request-id") || "");
  const dataId = extractPaymentId(req);

  if (!signature.ts || !signature.v1 || !requestId || !dataId) {
    return {
      checked: true,
      valid: false,
      reason: "Firma Mercado Pago incompleta"
    };
  }

  const manifest = `id:${dataId};request-id:${requestId};ts:${signature.ts};`;
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  return {
    checked: true,
    valid: safeHexCompare(expected, signature.v1),
    reason: "Firma Mercado Pago invalida"
  };
}

function mercadoPagoRuntimeStatus(req) {
  const configured = mercadoPagoConfigured();
  const baseUrl = req ? getBaseUrl(req) : cleanEnv("PUBLIC_BASE_URL");
  const notificationUrl =
    cleanEnv("MERCADOPAGO_NOTIFICATION_URL") ||
    (baseUrl ? `${String(baseUrl).replace(/\/$/, "")}/api/webhooks/mercadopago` : "");

  return {
    configured,
    mode: configured ? (mercadoPagoInternalCheckoutEnabled() ? "mercadopago_api" : "mercadopago") : "demo",
    publicKeyConfigured: Boolean(mercadoPagoPublicKey()),
    internalCheckoutConfigured: mercadoPagoInternalCheckoutEnabled(),
    webhookSignatureConfigured: mercadoPagoWebhookSignatureConfigured(),
    notificationUrlConfigured: Boolean(notificationUrl),
    notificationUrlLooksPublic:
      Boolean(notificationUrl) && /^https:\/\//i.test(notificationUrl) && !/localhost|127\.0\.0\.1/i.test(notificationUrl),
    sandbox: envFlag("MERCADOPAGO_USE_SANDBOX")
  };
}

module.exports = {
  createCardPayment,
  createPreference,
  getPayment,
  mercadoPagoConfigured,
  mercadoPagoInternalCheckoutEnabled,
  mercadoPagoPublicKey,
  mercadoPagoRuntimeStatus,
  mercadoPagoWebhookSignatureConfigured,
  parseWebhookNotification,
  verifyWebhookSignature
};
