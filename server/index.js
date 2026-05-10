const crypto = require("crypto");
const dotenv = require("dotenv");
dotenv.config();
dotenv.config({ path: ".env.local", override: true });
const express = require("express");
const path = require("path");
const QRCode = require("qrcode");

const { events, ticketTypes, findEvent, findTicketType } = require("./config/catalog");
const { sendTicketEmail, sendVerificationEmail, smtpConfigured } = require("./lib/mailer");
const { createPreference, getPayment, mercadoPagoConfigured } = require("./lib/mercadopago");
const { issueBoleta, openFacturaConfigured } = require("./lib/openfactura");
const { cleanRut, formatRut, validateRut } = require("./lib/rut");
const {
  lastSupabaseWarning,
  readState,
  storageMode,
  supabaseConfigured,
  updateState,
  writeState
} = require("./lib/storage");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(process.cwd(), "public")));

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.pbkdf2Sync(password, salt, 120000, 64, "sha512").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    rut: user.rut,
    phone: user.phone,
    club: user.club,
    vehicle: user.vehicle,
    emailVerified: Boolean(user.emailVerified)
  };
}

function publicOrder(order) {
  if (!order) return null;
  return {
    id: order.id,
    eventId: order.eventId,
    ticketTypeId: order.ticketTypeId,
    items: order.items || [],
    quantity: order.quantity,
    total: order.total,
    status: order.status,
    paymentMode: order.paymentMode,
    checkoutUrl: order.checkoutUrl,
    invoiceStatus: order.invoiceStatus,
    createdAt: order.createdAt
  };
}

function publicTicket(ticket, req) {
  if (!ticket) return null;
  const verifyUrl = `${baseUrl(req)}/validar?code=${encodeURIComponent(ticket.code)}`;
  return {
    id: ticket.id,
    orderId: ticket.orderId,
    eventId: ticket.eventId,
    ticketTypeId: ticket.ticketTypeId,
    eventName: ticket.eventName,
    ticketTypeName: ticket.ticketTypeName,
    code: ticket.code,
    holderName: ticket.holderName,
    holderRut: ticket.holderRut,
    status: ticket.status,
    validatedAt: ticket.validatedAt || null,
    createdAt: ticket.createdAt,
    verifyUrl,
    qrUrl: `/api/tickets/${encodeURIComponent(ticket.code)}/qr.svg`
  };
}

function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  }
  return `${req.protocol}://${req.get("host")}`;
}

function requireString(body, field, label) {
  const value = String(body[field] || "").trim();
  if (!value) {
    const error = new Error(`${label} es obligatorio`);
    error.status = 400;
    throw error;
  }
  return value;
}

function findUserByEmailRut(state, email, rutInput) {
  return state.users.find(
    (candidate) => candidate.email === email && cleanRut(candidate.rut) === cleanRut(rutInput)
  );
}

function buildOrderItems(itemsInput) {
  if (!Array.isArray(itemsInput) || !itemsInput.length) {
    const error = new Error("El carrito esta vacio");
    error.status = 400;
    throw error;
  }

  return itemsInput.map((item, index) => {
    const event = findEvent(item.eventId);
    const ticketType = findTicketType(item.ticketTypeId);
    const quantity = Number(item.quantity || 1);

    if (!event || !ticketType) {
      const error = new Error("Evento o entrada no disponible");
      error.status = 400;
      throw error;
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > ticketType.maxQuantity) {
      const error = new Error(`La cantidad permitida para ${ticketType.name} es 1 a ${ticketType.maxQuantity}`);
      error.status = 400;
      throw error;
    }

    return {
      id: id(`line${index + 1}`),
      eventId: event.id,
      eventName: event.name,
      ticketTypeId: ticketType.id,
      ticketTypeName: ticketType.name,
      description: ticketType.description,
      quantity,
      unitPrice: ticketType.price,
      total: ticketType.price * quantity
    };
  });
}

function getOrderItems(order) {
  if (order.items?.length) return order.items;

  const event = findEvent(order.eventId);
  const ticketType = findTicketType(order.ticketTypeId);
  if (!event || !ticketType) return [];

  return [
    {
      id: id("line"),
      eventId: event.id,
      eventName: event.name,
      ticketTypeId: ticketType.id,
      ticketTypeName: ticketType.name,
      description: ticketType.description,
      quantity: order.quantity,
      unitPrice: ticketType.price,
      total: order.total
    }
  ];
}

function createTickets({ order, user, items }) {
  const tickets = [];

  for (const item of items) {
    for (let index = 0; index < item.quantity; index += 1) {
      tickets.push({
        id: id("ticket"),
        orderId: order.id,
        lineItemId: item.id,
        userId: user.id,
        eventId: item.eventId,
        ticketTypeId: item.ticketTypeId,
        eventName: item.eventName,
        ticketTypeName: item.ticketTypeName,
        code: `HFC-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}-${index + 1}`,
        holderName: user.name,
        holderRut: user.rut,
        status: "valid",
        createdAt: new Date().toISOString()
      });
    }
  }

  return tickets;
}

async function completeOrderPayment(orderId, paymentData = {}) {
  let state = await readState();
  const order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order) {
    const error = new Error("Orden no encontrada");
    error.status = 404;
    throw error;
  }

  const user = state.users.find((candidate) => candidate.id === order.userId);
  const items = getOrderItems(order);
  const firstItem = items[0];
  const event = firstItem ? findEvent(firstItem.eventId) : null;
  const ticketType = firstItem ? findTicketType(firstItem.ticketTypeId) : null;
  if (!user || !items.length) {
    const error = new Error("Orden incompleta");
    error.status = 409;
    throw error;
  }

  let tickets = state.tickets.filter((ticket) => ticket.orderId === order.id);
  let invoice = state.invoices.find((candidate) => candidate.orderId === order.id);

  if (order.status !== "paid") {
    order.status = "paid";
    order.payment = {
      status: "approved",
      provider: paymentData.provider || order.paymentMode || "demo",
      paymentId: paymentData.paymentId || null,
      raw: paymentData.raw || null,
      paidAt: new Date().toISOString()
    };

    if (!tickets.length) {
      tickets = createTickets({ order, user, items });
      state.tickets.push(...tickets);
    }

    order.invoiceStatus = "pending";
    order.updatedAt = new Date().toISOString();
    await writeState(state);
  }

  if (!invoice) {
    try {
      invoice = await issueBoleta({ order, user, event, ticketType, tickets, items });
      state = await readState();
      const freshOrder = state.orders.find((candidate) => candidate.id === order.id);
      state.invoices.push(invoice);
      if (freshOrder) {
        freshOrder.invoiceStatus = "issued";
        freshOrder.updatedAt = new Date().toISOString();
      }
      await writeState(state);
    } catch (error) {
      state = await readState();
      const freshOrder = state.orders.find((candidate) => candidate.id === order.id);
      if (freshOrder) {
        freshOrder.invoiceStatus = "failed";
        freshOrder.invoiceError = error.message;
        freshOrder.updatedAt = new Date().toISOString();
      }
      await writeState(state);
      throw error;
    }
  }

  await sendTicketEmail({ user, order, event, ticketType, tickets, invoice });
  return { order, user, event, ticketType, tickets, invoice };
}

async function resendOrderEmail(orderId) {
  const state = await readState();
  const order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order) {
    const error = new Error("Orden no encontrada");
    error.status = 404;
    throw error;
  }

  const user = state.users.find((candidate) => candidate.id === order.userId);
  const items = getOrderItems(order);
  const firstItem = items[0];
  const event = firstItem ? findEvent(firstItem.eventId) : null;
  const ticketType = firstItem ? findTicketType(firstItem.ticketTypeId) : null;
  const tickets = state.tickets.filter((ticket) => ticket.orderId === order.id);
  const invoice = state.invoices.find((candidate) => candidate.orderId === order.id);

  if (!user || !tickets.length) {
    const error = new Error("La orden aun no tiene tickets emitidos");
    error.status = 409;
    throw error;
  }

  await sendTicketEmail({ user, order, event, ticketType, tickets, invoice });

  await updateState((nextState) => {
    nextState.emailLogs.push({
      id: id("email"),
      type: "resend_order",
      orderId: order.id,
      userId: user.id,
      to: user.email,
      createdAt: new Date().toISOString()
    });
  });

  return { order, user, tickets, invoice };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    storage: {
      mode: storageMode(),
      supabase: supabaseConfigured(),
      warning: lastSupabaseWarning()
    },
    integrations: {
      smtp: smtpConfigured(),
      mercadoPago: mercadoPagoConfigured(),
      openFactura: openFacturaConfigured()
    }
  });
});

app.get("/api/catalog", (req, res) => {
  res.json({
    events,
    ticketTypes,
    integrations: {
      paymentMode: mercadoPagoConfigured() ? "mercadopago" : "demo"
    }
  });
});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const name = requireString(req.body, "name", "Nombre");
    const email = normalizeEmail(requireString(req.body, "email", "Correo"));
    const rutInput = requireString(req.body, "rut", "RUT");
    const phone = requireString(req.body, "phone", "Telefono");
    const password = requireString(req.body, "password", "Password");

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const error = new Error("El correo no tiene un formato valido");
      error.status = 400;
      throw error;
    }

    if (!validateRut(rutInput)) {
      const error = new Error("El RUT no es valido");
      error.status = 400;
      throw error;
    }

    if (password.length < 8) {
      const error = new Error("El password debe tener al menos 8 caracteres");
      error.status = 400;
      throw error;
    }

    const formattedRut = formatRut(rutInput);
    const normalizedRut = cleanRut(rutInput);
    const verificationToken = id("verify");
    const now = new Date().toISOString();
    let createdUser;

    await updateState((state) => {
      const existing = state.users.find(
        (user) => user.email === email || cleanRut(user.rut) === normalizedRut
      );

      if (existing) {
        const error = new Error("Ya existe un registro con ese correo o RUT");
        error.status = 409;
        throw error;
      }

      createdUser = {
        id: id("user"),
        name,
        email,
        rut: formattedRut,
        phone,
        club: String(req.body.club || "").trim(),
        vehicle: String(req.body.vehicle || "").trim(),
        interests: Array.isArray(req.body.interests) ? req.body.interests : [],
        passwordHash: hashPassword(password),
        emailVerified: false,
        verificationToken,
        verificationSentAt: now,
        createdAt: now,
        updatedAt: now
      };

      state.users.push(createdUser);
      state.audit.push({ type: "user_registered", userId: createdUser.id, createdAt: now });
    });

    const verificationUrl = `${baseUrl(req)}/api/auth/verify?token=${verificationToken}`;
    const mailResult = await sendVerificationEmail({ user: createdUser, verificationUrl });

    res.status(201).json({
      ok: true,
      user: publicUser(createdUser),
      verificationRequired: true,
      devVerificationUrl: mailResult.mode === "demo" ? verificationUrl : undefined
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = normalizeEmail(requireString(req.body, "email", "Correo"));
    const password = requireString(req.body, "password", "Password");
    const state = await readState();
    const user = state.users.find((candidate) => candidate.email === email);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      const error = new Error("Correo o password incorrecto");
      error.status = 401;
      throw error;
    }

    const session = {
      id: id("session"),
      token: id("token"),
      userId: user.id,
      createdAt: new Date().toISOString()
    };

    await updateState((nextState) => {
      nextState.sessions.push(session);
    });

    res.json({ ok: true, user: publicUser(user), token: session.token });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", async (req, res, next) => {
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) {
      res.status(401).json({ ok: false, message: "Sesion requerida" });
      return;
    }

    const state = await readState();
    const session = state.sessions.find((candidate) => candidate.token === token);
    const user = session ? state.users.find((candidate) => candidate.id === session.userId) : null;

    if (!user) {
      res.status(401).json({ ok: false, message: "Sesion invalida" });
      return;
    }

    res.json({ ok: true, user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/verify", async (req, res, next) => {
  try {
    const token = String(req.query.token || "");
    let verifiedUser;

    await updateState((state) => {
      verifiedUser = state.users.find((user) => user.verificationToken === token);
      if (!verifiedUser) {
        const error = new Error("Token de verificacion invalido");
        error.status = 404;
        throw error;
      }

      verifiedUser.emailVerified = true;
      verifiedUser.verificationToken = null;
      verifiedUser.verifiedAt = new Date().toISOString();
      verifiedUser.updatedAt = verifiedUser.verifiedAt;
      state.audit.push({
        type: "email_verified",
        userId: verifiedUser.id,
        createdAt: verifiedUser.verifiedAt
      });
    });

    res.redirect(`/?verified=1&email=${encodeURIComponent(verifiedUser.email)}`);
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/resend-verification", async (req, res, next) => {
  try {
    const email = normalizeEmail(requireString(req.body, "email", "Correo"));
    const state = await readState();
    const user = state.users.find((candidate) => candidate.email === email);

    if (!user) {
      const error = new Error("No encontramos ese registro");
      error.status = 404;
      throw error;
    }

    if (user.emailVerified) {
      res.json({ ok: true, user: publicUser(user), alreadyVerified: true });
      return;
    }

    user.verificationToken = id("verify");
    user.verificationSentAt = new Date().toISOString();
    await writeState(state);

    const verificationUrl = `${baseUrl(req)}/api/auth/verify?token=${user.verificationToken}`;
    const mailResult = await sendVerificationEmail({ user, verificationUrl });

    res.json({
      ok: true,
      user: publicUser(user),
      devVerificationUrl: mailResult.mode === "demo" ? verificationUrl : undefined
    });
  } catch (error) {
    next(error);
  }
});

async function createOrderFromItems({ req, user, items }) {
  const now = new Date().toISOString();
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const firstItem = items[0];
  const event = findEvent(firstItem.eventId);
  const ticketType = findTicketType(firstItem.ticketTypeId);

  const order = {
    id: id("order"),
    userId: user.id,
    eventId: firstItem.eventId,
    ticketTypeId: firstItem.ticketTypeId,
    items,
    quantity,
    unitPrice: firstItem.unitPrice,
    total,
    status: "created",
    paymentMode: mercadoPagoConfigured() ? "mercadopago" : "demo",
    invoiceStatus: "not_started",
    createdAt: now,
    updatedAt: now
  };

  const preference = await createPreference({ req, order, user, event, ticketType });
  order.checkoutUrl = preference.checkoutUrl;
  order.preferenceId = preference.preferenceId;
  order.paymentMode = preference.mode;

  await updateState((nextState) => {
    nextState.orders.push(order);
    nextState.audit.push({
      id: id("audit"),
      type: "order_created",
      orderId: order.id,
      createdAt: order.createdAt
    });
  });

  return { order, preference };
}

app.post("/api/orders", async (req, res, next) => {
  try {
    const email = normalizeEmail(requireString(req.body, "email", "Correo"));
    const rutInput = requireString(req.body, "rut", "RUT");
    const eventId = requireString(req.body, "eventId", "Evento");
    const ticketTypeId = requireString(req.body, "ticketTypeId", "Entrada");
    const quantity = Number(req.body.quantity || 1);

    if (!validateRut(rutInput)) {
      const error = new Error("El RUT no es valido");
      error.status = 400;
      throw error;
    }

    const items = buildOrderItems([{ eventId, ticketTypeId, quantity }]);

    const state = await readState();
    const user = findUserByEmailRut(state, email, rutInput);

    if (!user) {
      const error = new Error("Debes registrarte con ese correo y RUT antes de comprar");
      error.status = 403;
      throw error;
    }

    if (!user.emailVerified) {
      const error = new Error("Debes confirmar tu correo antes de comprar entradas");
      error.status = 403;
      throw error;
    }

    const { order, preference } = await createOrderFromItems({ req, user, items });

    res.status(201).json({
      ok: true,
      order: publicOrder(order),
      checkoutUrl: preference.checkoutUrl,
      paymentMode: preference.mode
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders/from-cart", async (req, res, next) => {
  try {
    const email = normalizeEmail(requireString(req.body, "email", "Correo"));
    const rutInput = requireString(req.body, "rut", "RUT");

    if (!validateRut(rutInput)) {
      const error = new Error("El RUT no es valido");
      error.status = 400;
      throw error;
    }

    const items = buildOrderItems(req.body.items);
    const state = await readState();
    const user = findUserByEmailRut(state, email, rutInput);

    if (!user) {
      const error = new Error("Debes registrarte con ese correo y RUT antes de comprar");
      error.status = 403;
      throw error;
    }

    if (!user.emailVerified) {
      const error = new Error("Debes confirmar tu correo antes de comprar entradas");
      error.status = 403;
      throw error;
    }

    const { order, preference } = await createOrderFromItems({ req, user, items });

    res.status(201).json({
      ok: true,
      order: publicOrder(order),
      checkoutUrl: preference.checkoutUrl,
      paymentMode: preference.mode
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders/:orderId", async (req, res, next) => {
  try {
    const state = await readState();
    const order = state.orders.find((candidate) => candidate.id === req.params.orderId);
    const tickets = state.tickets
      .filter((ticket) => ticket.orderId === req.params.orderId)
      .map((ticket) => publicTicket(ticket, req));
    const invoice = state.invoices.find((candidate) => candidate.orderId === req.params.orderId);

    if (!order) {
      res.status(404).json({ ok: false, message: "Orden no encontrada" });
      return;
    }

    res.json({ ok: true, order: publicOrder(order), tickets, invoice });
  } catch (error) {
    next(error);
  }
});

app.get("/api/users/purchases", async (req, res, next) => {
  try {
    const email = normalizeEmail(requireString(req.query, "email", "Correo"));
    const rutInput = requireString(req.query, "rut", "RUT");

    if (!validateRut(rutInput)) {
      const error = new Error("El RUT no es valido");
      error.status = 400;
      throw error;
    }

    const state = await readState();
    const user = findUserByEmailRut(state, email, rutInput);
    if (!user) {
      const error = new Error("No encontramos compras para ese correo y RUT");
      error.status = 404;
      throw error;
    }

    const orders = state.orders
      .filter((order) => order.userId === user.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((order) => ({
        ...publicOrder(order),
        tickets: state.tickets
          .filter((ticket) => ticket.orderId === order.id)
          .map((ticket) => publicTicket(ticket, req)),
        invoice: state.invoices.find((invoice) => invoice.orderId === order.id) || null
      }));

    res.json({ ok: true, user: publicUser(user), orders });
  } catch (error) {
    next(error);
  }
});

app.get("/api/tickets/:code/qr.svg", async (req, res, next) => {
  try {
    const state = await readState();
    const ticket = state.tickets.find((candidate) => candidate.code === req.params.code);
    if (!ticket) {
      res.status(404).type("text/plain").send("Ticket no encontrado");
      return;
    }

    const svg = await QRCode.toString(`${baseUrl(req)}/validar?code=${encodeURIComponent(ticket.code)}`, {
      type: "svg",
      margin: 1,
      width: 220
    });

    res.type("image/svg+xml").send(svg);
  } catch (error) {
    next(error);
  }
});

app.post("/api/tickets/validate", async (req, res, next) => {
  try {
    const code = String(req.body.code || req.query.code || "").trim();
    const action = String(req.body.action || "lookup");
    if (!code) {
      const error = new Error("Codigo de ticket requerido");
      error.status = 400;
      throw error;
    }

    let result;
    await updateState((state) => {
      const ticket = state.tickets.find((candidate) => candidate.code === code);
      if (!ticket) {
        const error = new Error("Ticket no encontrado");
        error.status = 404;
        throw error;
      }

      const order = state.orders.find((candidate) => candidate.id === ticket.orderId);
      const user = state.users.find((candidate) => candidate.id === ticket.userId);

      if (action === "checkin" && ticket.status === "valid") {
        ticket.status = "checked_in";
        ticket.validatedAt = new Date().toISOString();
        ticket.updatedAt = ticket.validatedAt;
        state.audit.push({
          id: id("audit"),
          type: "ticket_checked_in",
          ticketId: ticket.id,
          orderId: ticket.orderId,
          createdAt: ticket.validatedAt
        });
      }

      result = {
        ticket,
        order,
        user
      };
    });

    res.json({
      ok: true,
      ticket: publicTicket(result.ticket, req),
      order: publicOrder(result.order),
      user: publicUser(result.user)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders/:orderId/simulate-payment", async (req, res, next) => {
  try {
    const result = await completeOrderPayment(req.params.orderId, {
      provider: "demo",
      paymentId: id("payment_demo")
    });

    res.json({
      ok: true,
      order: publicOrder(result.order),
      tickets: result.tickets.map((ticket) => publicTicket(ticket, req)),
      invoice: result.invoice
    });
  } catch (error) {
    next(error);
  }
});

function adminAuthorized(req) {
  if (!process.env.BACKOFFICE_TOKEN) {
    return process.env.NODE_ENV !== "production";
  }

  return req.headers["x-admin-token"] === process.env.BACKOFFICE_TOKEN;
}

function requireAdmin(req) {
  if (!adminAuthorized(req)) {
    const error = new Error("Backoffice no autorizado");
    error.status = 401;
    throw error;
  }
}

app.get("/api/backoffice/summary", async (req, res, next) => {
  try {
    requireAdmin(req);
    const state = await readState();
    const paidOrders = state.orders.filter((order) => order.status === "paid");
    const revenue = paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);

    const orders = state.orders
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((order) => {
        const user = state.users.find((candidate) => candidate.id === order.userId);
        return {
          ...publicOrder(order),
          user: publicUser(user),
          tickets: state.tickets
            .filter((ticket) => ticket.orderId === order.id)
            .map((ticket) => publicTicket(ticket, req)),
          invoice: state.invoices.find((invoice) => invoice.orderId === order.id) || null
        };
      });

    res.json({
      ok: true,
      summary: {
        orders: state.orders.length,
        paidOrders: paidOrders.length,
        revenue,
        tickets: state.tickets.length,
        checkedInTickets: state.tickets.filter((ticket) => ticket.status === "checked_in").length,
        users: state.users.length,
        enrolados: state.users.filter((user) => user.emailVerified).length
      },
      orders,
      tickets: state.tickets.map((ticket) => publicTicket(ticket, req)),
      users: state.users.map(publicUser),
      invoices: state.invoices,
      emailLogs: state.emailLogs || []
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/backoffice/orders/:orderId/resend", async (req, res, next) => {
  try {
    requireAdmin(req);
    const result = await resendOrderEmail(req.params.orderId);
    res.json({
      ok: true,
      order: publicOrder(result.order),
      user: publicUser(result.user),
      tickets: result.tickets.map((ticket) => publicTicket(ticket, req))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/webhooks/mercadopago", async (req, res, next) => {
  try {
    const topic = req.query.type || req.query.topic || req.body.type || req.body.topic;
    const paymentId = req.query["data.id"] || req.body?.data?.id || req.body?.id;

    if (!paymentId || !String(topic).includes("payment")) {
      res.json({ ok: true, ignored: true });
      return;
    }

    const payment = await getPayment(paymentId);
    if (payment.status === "approved" && payment.external_reference) {
      await completeOrderPayment(payment.external_reference, {
        provider: "mercadopago",
        paymentId: String(payment.id),
        raw: payment
      });
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

const pageRoutes = {
  "/ticketera": "ticketera.html",
  "/carrito": "carrito.html",
  "/mis-compras": "mis-compras.html",
  "/validar": "validar.html",
  "/backoffice-hfc": "backoffice.html"
};

for (const [route, file] of Object.entries(pageRoutes)) {
  app.get(route, (req, res) => {
    res.sendFile(path.join(process.cwd(), "public", file));
  });
}

app.get("*", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.status || 500).json({
    ok: false,
    message: error.message || "Error interno"
  });
});

app.listen(port, () => {
  console.log(`Honda Fest Chile listo en http://localhost:${port}`);
});
