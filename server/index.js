const crypto = require("crypto");
require("dotenv").config();
const express = require("express");
const path = require("path");

const { events, ticketTypes, findEvent, findTicketType } = require("./config/catalog");
const { sendTicketEmail, sendVerificationEmail, smtpConfigured } = require("./lib/mailer");
const { createPreference, getPayment, mercadoPagoConfigured } = require("./lib/mercadopago");
const { issueBoleta, openFacturaConfigured } = require("./lib/openfactura");
const { cleanRut, formatRut, validateRut } = require("./lib/rut");
const { readState, updateState, writeState } = require("./lib/storage");

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
    quantity: order.quantity,
    total: order.total,
    status: order.status,
    paymentMode: order.paymentMode,
    checkoutUrl: order.checkoutUrl,
    invoiceStatus: order.invoiceStatus,
    createdAt: order.createdAt
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

function createTickets({ order, user, event, ticketType }) {
  return Array.from({ length: order.quantity }, (_, index) => ({
    id: id("ticket"),
    orderId: order.id,
    userId: user.id,
    eventId: event.id,
    ticketTypeId: ticketType.id,
    code: `HFC-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}-${index + 1}`,
    holderName: user.name,
    holderRut: user.rut,
    status: "valid",
    createdAt: new Date().toISOString()
  }));
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
  const event = findEvent(order.eventId);
  const ticketType = findTicketType(order.ticketTypeId);
  if (!user || !event || !ticketType) {
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
      tickets = createTickets({ order, user, event, ticketType });
      state.tickets.push(...tickets);
    }

    order.invoiceStatus = "pending";
    order.updatedAt = new Date().toISOString();
    await writeState(state);
  }

  if (!invoice) {
    try {
      invoice = await issueBoleta({ order, user, event, ticketType, tickets });
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

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
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

    const event = findEvent(eventId);
    const ticketType = findTicketType(ticketTypeId);
    if (!event || !ticketType) {
      const error = new Error("Evento o entrada no disponible");
      error.status = 400;
      throw error;
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > ticketType.maxQuantity) {
      const error = new Error(`La cantidad permitida para esta entrada es 1 a ${ticketType.maxQuantity}`);
      error.status = 400;
      throw error;
    }

    const state = await readState();
    const user = state.users.find(
      (candidate) => candidate.email === email && cleanRut(candidate.rut) === cleanRut(rutInput)
    );

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

    const order = {
      id: id("order"),
      userId: user.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      quantity,
      unitPrice: ticketType.price,
      total: ticketType.price * quantity,
      status: "created",
      paymentMode: mercadoPagoConfigured() ? "mercadopago" : "demo",
      invoiceStatus: "not_started",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const preference = await createPreference({ req, order, user, event, ticketType });
    order.checkoutUrl = preference.checkoutUrl;
    order.preferenceId = preference.preferenceId;
    order.paymentMode = preference.mode;

    await updateState((nextState) => {
      nextState.orders.push(order);
      nextState.audit.push({ type: "order_created", orderId: order.id, createdAt: order.createdAt });
    });

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
    const tickets = state.tickets.filter((ticket) => ticket.orderId === req.params.orderId);
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

app.post("/api/orders/:orderId/simulate-payment", async (req, res, next) => {
  try {
    const result = await completeOrderPayment(req.params.orderId, {
      provider: "demo",
      paymentId: id("payment_demo")
    });

    res.json({
      ok: true,
      order: publicOrder(result.order),
      tickets: result.tickets,
      invoice: result.invoice
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
