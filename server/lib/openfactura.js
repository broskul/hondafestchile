function openFacturaConfigured() {
  return Boolean(process.env.OPENFACTURA_API_KEY && process.env.OPENFACTURA_ENDPOINT);
}

function buildOpenFacturaPayload({ order, user, event, ticketType, tickets }) {
  return {
    documento: {
      tipoDTE: Number(process.env.OPENFACTURA_DTE_TYPE || 39),
      fechaEmision: new Date().toISOString().slice(0, 10),
      emisor: {
        rut: process.env.OPENFACTURA_COMPANY_RUT,
        razonSocial: process.env.OPENFACTURA_COMPANY_NAME || "Honda Fest Chile"
      },
      receptor: {
        rut: user.rut,
        razonSocial: user.name,
        email: user.email
      },
      detalle: [
        {
          nombre: `${ticketType.name} - ${event.name}`,
          descripcion: `Orden ${order.id}. Tickets: ${tickets.map((ticket) => ticket.code).join(", ")}`,
          cantidad: order.quantity,
          precioUnitario: ticketType.price,
          montoItem: order.total
        }
      ],
      totales: {
        montoTotal: order.total
      }
    },
    referenciaExterna: order.id
  };
}

async function issueBoleta({ order, user, event, ticketType, tickets }) {
  const payload = buildOpenFacturaPayload({ order, user, event, ticketType, tickets });

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

  const response = await fetch(process.env.OPENFACTURA_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENFACTURA_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": order.id
    },
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
