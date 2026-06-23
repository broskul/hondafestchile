function cleanEnv(name) {
  return String(process.env[name] || "").trim();
}

function openFacturaConfigured() {
  return Boolean(
    cleanEnv("OPENFACTURA_ENDPOINT") &&
      (cleanEnv("OPENFACTURA_API_KEY") || cleanEnv("OPENFACTURA_SUBSCRIPTION_KEY"))
  );
}

function buildOpenFacturaPayload({ order, user, event, ticketType, tickets, items = [] }) {
  const detailItems = items.length
    ? items
    : [
        {
          ticketTypeName: ticketType.name,
          eventName: event.name,
          description: ticketType.description,
          quantity: order.quantity,
          unitPrice: ticketType.price,
          total: order.total
        }
      ];

  return {
    documento: {
      tipoDTE: Number(cleanEnv("OPENFACTURA_DTE_TYPE") || 39),
      fechaEmision: new Date().toISOString().slice(0, 10),
      emisor: {
        rut: cleanEnv("OPENFACTURA_COMPANY_RUT"),
        razonSocial: cleanEnv("OPENFACTURA_COMPANY_NAME") || "Honda Fest Chile"
      },
      receptor: {
        rut: user.rut,
        razonSocial: user.name,
        email: user.email
      },
      detalle: detailItems.map((item) => ({
        nombre: `${item.ticketTypeName} - ${item.eventName}`,
        descripcion: `Orden ${order.id}. Tickets: ${tickets
          .filter((ticket) => !item.id || ticket.lineItemId === item.id)
          .map((ticket) => ticket.code)
          .join(", ")}`,
        cantidad: item.quantity,
        precioUnitario: item.unitPrice,
        montoItem: item.total
      })),
      totales: {
        montoTotal: order.total
      }
    },
    referenciaExterna: order.id
  };
}

async function issueBoleta({ order, user, event, ticketType, tickets, items }) {
  const payload = buildOpenFacturaPayload({ order, user, event, ticketType, tickets, items });

  if (!openFacturaConfigured()) {
    return {
      id: `dte_demo_${order.id}`,
      orderId: order.id,
      mode: "demo",
      provider: "openfactura",
      providerId: `OF-DEMO-${order.id}`,
      folio: `DEMO-${Date.now()}`,
      pdfUrl: null,
      payload,
      createdAt: new Date().toISOString()
    };
  }

  const subscriptionKey = cleanEnv("OPENFACTURA_SUBSCRIPTION_KEY") || cleanEnv("OPENFACTURA_API_KEY");
  const bearerToken = cleanEnv("OPENFACTURA_BEARER_TOKEN") || cleanEnv("OPENFACTURA_ACCESS_TOKEN");
  const headers = {
    "Content-Type": "application/json",
    "Idempotency-Key": order.id,
    "Ocp-Apim-Subscription-Key": subscriptionKey
  };
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  } else if (/^bearer$/i.test(cleanEnv("OPENFACTURA_AUTH_SCHEME"))) {
    headers.Authorization = `Bearer ${cleanEnv("OPENFACTURA_API_KEY")}`;
  }

  const response = await fetch(cleanEnv("OPENFACTURA_ENDPOINT"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = result?.message || result?.error || "No se pudo emitir la boleta";
    throw new Error(`OpenFactura: ${detail}`);
  }

  return {
    id: `dte_${order.id}`,
    orderId: order.id,
    mode: "openfactura",
    provider: "openfactura",
    providerId: result.id || result.documentId || result.trackId || order.id,
    folio: result.folio || result.number || null,
    pdfUrl: result.pdfUrl || result.urlPdf || result.representationUrl || null,
    raw: result,
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  buildOpenFacturaPayload,
  issueBoleta,
  openFacturaConfigured
};
