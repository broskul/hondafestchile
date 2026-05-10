function mercadoPagoConfigured() {
  return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN);
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
      success: `${baseUrl}/?payment=success&order=${order.id}`,
      failure: `${baseUrl}/?payment=failure&order=${order.id}`,
      pending: `${baseUrl}/?payment=pending&order=${order.id}`
    },
    notification_url: `${baseUrl}/api/webhooks/mercadopago`,
    auto_return: "approved",
    metadata: {
      event_id: event?.id || order.items?.[0]?.eventId,
      ticket_type_id: ticketType?.id || order.items?.[0]?.ticketTypeId,
      user_id: user.id
    }
  };

  const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
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
    checkoutUrl: payload.init_point || payload.sandbox_init_point,
    preferenceId: payload.id
  };
}

async function getPayment(paymentId) {
  if (!mercadoPagoConfigured()) {
    throw new Error("Mercado Pago no esta configurado");
  }

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`
    }
  });

  const payload = await response.json();
  if (!response.ok) {
    const detail = payload?.message || payload?.error || "No se pudo consultar el pago";
    throw new Error(`Mercado Pago: ${detail}`);
  }

  return payload;
}

module.exports = {
  createPreference,
  getPayment,
  mercadoPagoConfigured
};
