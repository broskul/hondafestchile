const crypto = require("crypto");
const dotenv = require("dotenv");
dotenv.config();
dotenv.config({ path: ".env.local", override: true });
const express = require("express");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const {
  events: defaultEvents,
  ticketTypes: defaultTicketTypes,
  findEvent: findDefaultEvent,
  findTicketType: findDefaultTicketType
} = require("./config/catalog");
const { findTemplate, mergeTemplates, normalizeTemplate, renderTemplate } = require("./lib/emailTemplates");
const { mailProviderStatus, sendMail, sendTicketEmail, sendVerificationEmail, smtpConfigured } = require("./lib/mailer");
const {
  createCardPayment,
  createPreference,
  getPayment,
  mercadoPagoConfigured,
  mercadoPagoInternalCheckoutEnabled,
  mercadoPagoPublicKey,
  mercadoPagoRuntimeStatus,
  parseWebhookNotification,
  verifyWebhookSignature
} = require("./lib/mercadopago");
const { issueBoleta, openFacturaConfigured } = require("./lib/openfactura");
const { cleanRut, formatRut, validateRut } = require("./lib/rut");
const {
  checkoutStorageReady,
  lastSupabaseWarning,
  readState,
  storageMode,
  supabaseConfigured,
  updateState,
  verifyCheckoutStorage,
  writeState
} = require("./lib/storage");

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "1mb" }));
app.use(
  express.static(path.join(process.cwd(), "public"), {
    setHeaders(res, filePath) {
      if (path.extname(filePath).toLowerCase() === ".avif") {
        res.setHeader("Content-Type", "image/avif");
      }
    }
  })
);

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function normalizeEmail(email = "") {
  return String(email).trim().toLowerCase();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const TICKETING_SETTING_ID = "ticketing_config";
const DEFAULT_EVENT_ID = defaultEvents[0]?.id || "honda-fest-chile-2026";

function defaultTicketPhases(ticket) {
  return [
    {
      id: "preventa",
      name: "Preventa",
      kind: "preventa",
      price: ticket.price,
      quota: null,
      startsAt: "",
      endsAt: "",
      perOrderLimit: ticket.maxQuantity,
      enabled: false,
      sortOrder: 10
    },
    {
      id: "general",
      name: "Venta general",
      kind: "general",
      price: ticket.price,
      quota: null,
      startsAt: "",
      endsAt: "",
      perOrderLimit: ticket.maxQuantity,
      enabled: true,
      sortOrder: 20
    },
    {
      id: "puerta",
      name: "Puerta",
      kind: "puerta",
      price: ticket.price,
      quota: null,
      startsAt: "",
      endsAt: "",
      perOrderLimit: ticket.maxQuantity,
      enabled: false,
      sortOrder: 30
    }
  ];
}

function defaultTicketingConfig() {
  return {
    events: clone(defaultEvents),
    ticketTypes: defaultTicketTypes.map((ticket) => ({
      ...clone(ticket),
      active: true,
      phases: defaultTicketPhases(ticket)
    }))
  };
}

function normalizePhase(phase = {}, ticket = {}, index = 0) {
  const fallbackId = ["preventa", "general", "puerta"][index] || `fase-${index + 1}`;
  const idValue = String(phase.id || phase.kind || fallbackId)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  const kind = String(phase.kind || idValue || fallbackId).trim().toLowerCase();
  const price = Number.isFinite(Number(phase.price)) ? Number(phase.price) : Number(ticket.price || 0);
  const quota = phase.quota === "" || phase.quota === null || phase.quota === undefined ? null : Number(phase.quota);
  const perOrderLimit =
    phase.perOrderLimit === "" || phase.perOrderLimit === null || phase.perOrderLimit === undefined
      ? Number(ticket.maxQuantity || 1)
      : Number(phase.perOrderLimit);

  return {
    id: idValue || fallbackId,
    name: String(phase.name || phase.label || fallbackId).trim(),
    kind,
    price: Math.max(0, Math.round(price || 0)),
    quota: Number.isFinite(quota) && quota > 0 ? Math.floor(quota) : null,
    startsAt: String(phase.startsAt || phase.startAt || "").trim(),
    endsAt: String(phase.endsAt || phase.endAt || "").trim(),
    perOrderLimit: Number.isFinite(perOrderLimit) && perOrderLimit > 0 ? Math.floor(perOrderLimit) : 1,
    enabled: phase.enabled !== false,
    sortOrder: Number(phase.sortOrder || (index + 1) * 10)
  };
}

function normalizeTicket(ticket = {}) {
  const idValue = String(ticket.id || ticket.name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  const base = defaultTicketTypes.find((candidate) => candidate.id === idValue) || {};
  const normalized = {
    ...base,
    ...ticket,
    id: idValue || base.id || id("ticket-type"),
    name: String(ticket.name || base.name || "Entrada").trim(),
    description: String(ticket.description || base.description || "").trim(),
    price: Math.max(0, Math.round(Number(ticket.price ?? base.price ?? 0))),
    maxQuantity: Math.max(1, Math.floor(Number(ticket.maxQuantity ?? base.maxQuantity ?? 1))),
    active: ticket.active !== false,
    eventIds: Array.isArray(ticket.eventIds) ? ticket.eventIds.map(String).filter(Boolean) : []
  };
  const phases = Array.isArray(ticket.phases) && ticket.phases.length ? ticket.phases : defaultTicketPhases(normalized);
  normalized.phases = phases.map((phase, index) => normalizePhase(phase, normalized, index));
  return normalized;
}

function normalizeEvent(event = {}) {
  const idValue = String(event.id || event.name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  const base = defaultEvents.find((candidate) => candidate.id === idValue) || {};
  return {
    ...base,
    ...event,
    id: idValue || base.id || id("event"),
    name: String(event.name || base.name || "Honda Fest Chile").trim(),
    eyebrow: String(event.eyebrow || base.eyebrow || "Evento").trim(),
    dateLabel: String(event.dateLabel || base.dateLabel || "").trim(),
    venue: String(event.venue || base.venue || "").trim(),
    city: String(event.city || base.city || "Chile").trim(),
    summary: String(event.summary || base.summary || "").trim(),
    highlights: Array.isArray(event.highlights) ? event.highlights : base.highlights || [],
    accent: String(event.accent || base.accent || "honda").trim(),
    eventDate: String(event.eventDate || "").trim(),
    active: event.active !== false
  };
}

function normalizeTicketingConfig(config = {}) {
  const defaults = defaultTicketingConfig();
  const hasEvents = Object.prototype.hasOwnProperty.call(config, "events");
  const hasTicketTypes = Object.prototype.hasOwnProperty.call(config, "ticketTypes");
  const events = hasEvents && Array.isArray(config.events) ? config.events : defaults.events;
  const ticketTypes = hasTicketTypes && Array.isArray(config.ticketTypes) ? config.ticketTypes : defaults.ticketTypes;

  return {
    events: events.map(normalizeEvent).filter((event) => event.active !== false),
    ticketTypes: ticketTypes.map(normalizeTicket).filter((ticket) => ticket.active !== false)
  };
}

function ticketingConfig(state) {
  const record = (state.settings || []).find(
    (candidate) => candidate.id === TICKETING_SETTING_ID || candidate.type === "ticketing"
  );
  return normalizeTicketingConfig(record?.payload || record || defaultTicketingConfig());
}

function hasTicketingSetting(state) {
  return (state.settings || []).some((candidate) => candidate.id === TICKETING_SETTING_ID || candidate.type === "ticketing");
}

function upsertSetting(state, setting) {
  const now = new Date().toISOString();
  const record = {
    id: setting.id,
    type: setting.type,
    payload: setting.payload,
    createdAt: setting.createdAt || now,
    updatedAt: now
  };
  const index = (state.settings || []).findIndex((candidate) => candidate.id === record.id);
  if (!state.settings) state.settings = [];
  if (index >= 0) state.settings[index] = { ...state.settings[index], ...record };
  else state.settings.push(record);
  return record;
}

function findEvent(state, eventId) {
  const event = ticketingConfig(state).events.find((candidate) => candidate.id === eventId);
  return event || (hasTicketingSetting(state) ? null : findDefaultEvent(eventId));
}

function findTicketType(state, ticketTypeId) {
  const ticket = ticketingConfig(state).ticketTypes.find((candidate) => candidate.id === ticketTypeId);
  return ticket || (hasTicketingSetting(state) ? null : findDefaultTicketType(ticketTypeId));
}

function phaseDateActive(phase, now = new Date()) {
  const start = phase.startsAt ? new Date(phase.startsAt) : null;
  const end = phase.endsAt ? new Date(phase.endsAt) : null;
  if (start && !Number.isNaN(start.getTime()) && now < start) return false;
  if (end && !Number.isNaN(end.getTime()) && now > end) return false;
  return true;
}

function chileDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function eventDateKey(event) {
  const value = String(event?.eventDate || "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

function isEventDay(event, now = new Date()) {
  const key = eventDateKey(event);
  return Boolean(key && key === chileDateKey(now));
}

function ticketAvailableForEvent(ticket, eventId) {
  return !Array.isArray(ticket.eventIds) || !ticket.eventIds.length || ticket.eventIds.includes(eventId);
}

function orderCountsForPhase(state, eventId, ticketTypeId, phaseId, paidOnly = false) {
  const statuses = paidOnly
    ? new Set(["paid"])
    : new Set(["created", "payment_pending", "payment_review", "paid"]);
  return (state.orders || []).reduce((sum, order) => {
    if (!statuses.has(order.status)) return sum;
    return (
      sum +
      getOrderItems(order, state).reduce((itemSum, item) => {
        if (item.eventId !== eventId || item.ticketTypeId !== ticketTypeId) return itemSum;
        if ((item.salePhaseId || "general") !== phaseId) return itemSum;
        return itemSum + Number(item.quantity || 0);
      }, 0)
    );
  }, 0);
}

function phaseWithAvailability(state, event, ticket, phase, now = new Date()) {
  if (!phase || phase.enabled === false) return null;
  const kind = String(phase.kind || phase.id || "").toLowerCase();
  if (kind === "puerta") {
    if (!isEventDay(event, now)) return null;
  } else if (!phaseDateActive(phase, now)) {
    return null;
  }

  const reserved = orderCountsForPhase(state, event.id, ticket.id, phase.id, false);
  const remaining = phase.quota ? Math.max(0, phase.quota - reserved) : null;
  if (remaining === 0) return null;

  return {
    ...phase,
    reserved,
    sold: orderCountsForPhase(state, event.id, ticket.id, phase.id, true),
    remaining,
    maxQuantity: Math.max(1, Math.min(ticket.maxQuantity, phase.perOrderLimit, remaining || phase.perOrderLimit))
  };
}

function activePhaseForTicket(state, eventOrId, ticket, now = new Date()) {
  const event = typeof eventOrId === "string" ? findEvent(state, eventOrId) : eventOrId;
  if (!event || !ticketAvailableForEvent(ticket, event.id)) return null;

  const phases = (ticket.phases || []).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const phasesByKind = (kind) => phases.filter((phase) => String(phase.kind || phase.id || "").toLowerCase() === kind);
  const firstAvailable = (candidates) => {
    for (const phase of candidates) {
      const available = phaseWithAvailability(state, event, ticket, phase, now);
      if (available) return available;
    }
    return null;
  };

  const doorPhase = isEventDay(event, now) ? firstAvailable(phasesByKind("puerta")) : null;
  if (doorPhase) return doorPhase;

  const presalePhase = firstAvailable(phasesByKind("preventa"));
  if (presalePhase) return presalePhase;

  const generalPhase = firstAvailable(phasesByKind("general"));
  if (generalPhase) return generalPhase;

  for (const phase of phases.filter((candidate) => {
    const kind = String(candidate.kind || candidate.id || "").toLowerCase();
    return !["preventa", "general", "puerta"].includes(kind);
  })) {
    const available = phaseWithAvailability(state, event, ticket, phase, now);
    if (available) return available;
  }

  return null;
}

function catalogForClient(state) {
  const config = ticketingConfig(state);
  const primaryEventId = config.events[0]?.id || DEFAULT_EVENT_ID;
  return {
    events: config.events,
    ticketTypes: config.ticketTypes.map((ticket) => {
      const availabilityByEvent = Object.fromEntries(
        config.events.map((event) => {
          const phase = activePhaseForTicket(state, event, ticket);
          return [
            event.id,
            {
              price: phase?.price ?? ticket.price,
              maxQuantity: phase?.maxQuantity ?? ticket.maxQuantity,
              salePhaseId: phase?.id || null,
              salePhaseName: phase?.name || "No disponible",
              salePhaseKind: phase?.kind || null,
              saleRemaining: phase?.remaining,
              available: Boolean(phase)
            }
          ];
        })
      );
      const primary = availabilityByEvent[primaryEventId] || Object.values(availabilityByEvent)[0] || null;
      return {
        ...ticket,
        price: primary?.price ?? ticket.price,
        maxQuantity: primary?.maxQuantity ?? ticket.maxQuantity,
        salePhaseId: primary?.salePhaseId || null,
        salePhaseName: primary?.salePhaseName || "No disponible",
        salePhaseKind: primary?.salePhaseKind || null,
        saleRemaining: primary?.saleRemaining,
        available: Boolean(primary?.available),
        availabilityByEvent
      };
    })
  };
}

function salesBi(state) {
  const config = ticketingConfig(state);
  const eventsById = new Map(config.events.map((event) => [event.id, event]));
  const ticketsById = new Map(config.ticketTypes.map((ticket) => [ticket.id, ticket]));
  const byEvent = new Map();
  const byTicket = new Map();
  const byPhase = new Map();

  for (const order of state.orders || []) {
    const isPaid = order.status === "paid";
    const items = getOrderItems(order, state);
    for (const item of items) {
      const quantity = Number(item.quantity || 0);
      const total = isPaid ? Number(item.total || 0) : 0;
      const eventKey = item.eventId || "sin-evento";
      const ticketKey = item.ticketTypeId || "sin-entrada";
      const phaseKey = item.salePhaseId || "general";
      const eventRow = byEvent.get(eventKey) || {
        id: eventKey,
        name: eventsById.get(eventKey)?.name || item.eventName || eventKey,
        sold: 0,
        revenue: 0,
        guests: 0
      };
      const ticketRow = byTicket.get(ticketKey) || {
        id: ticketKey,
        name: ticketsById.get(ticketKey)?.name || item.ticketTypeName || ticketKey,
        sold: 0,
        revenue: 0,
        guests: 0
      };
      const phaseRow = byPhase.get(phaseKey) || {
        id: phaseKey,
        name: item.salePhaseName || phaseKey,
        sold: 0,
        revenue: 0,
        guests: 0
      };
      if (isPaid) {
        eventRow.sold += quantity;
        eventRow.revenue += total;
        ticketRow.sold += quantity;
        ticketRow.revenue += total;
        phaseRow.sold += quantity;
        phaseRow.revenue += total;
      }
      if (order.source === "guest" || item.salePhaseKind === "guest") {
        eventRow.guests += quantity;
        ticketRow.guests += quantity;
        phaseRow.guests += quantity;
      }
      byEvent.set(eventKey, eventRow);
      byTicket.set(ticketKey, ticketRow);
      byPhase.set(phaseKey, phaseRow);
    }
  }

  return {
    byEvent: Array.from(byEvent.values()).sort((a, b) => b.sold - a.sold),
    byTicket: Array.from(byTicket.values()).sort((a, b) => b.sold - a.sold),
    byPhase: Array.from(byPhase.values()).sort((a, b) => b.sold - a.sold)
  };
}

const emailDomainFixes = {
  "gmeil.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.cl": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmil.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com",
  "outlook.con": "outlook.com",
  "yaho.com": "yahoo.com"
};

function emailSuggestion(email) {
  const normalized = normalizeEmail(email).replace(/\s+/g, "");
  const [local, domain] = normalized.split("@");
  if (!local || !domain) {
    return { email: normalized, valid: false, suggestion: normalized, reason: "Formato incompleto" };
  }
  const suggestedDomain = emailDomainFixes[domain] || domain;
  const suggestion = `${local.replace(/[^\w.+-]/g, "")}@${suggestedDomain}`;
  return {
    email: normalized,
    valid: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(suggestion),
    suggestion: suggestion !== normalized ? suggestion : "",
    reason: suggestion !== normalized ? `Dominio sugerido: ${suggestedDomain}` : ""
  };
}

function parseCsvRows(csvText = "") {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      row.push(value);
      value = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      value = "";
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = [];
      continue;
    }
    value += char;
  }

  row.push(value);
  if (row.some((cell) => String(cell).trim())) rows.push(row);
  return rows;
}

function contactsFromCsv(csvText = "", source = "csv") {
  const rows = parseCsvRows(csvText);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header || "").trim().toLowerCase());
  const emailIndex = headers.findIndex((header) => ["email", "correo", "mail", "e-mail"].includes(header));
  const nameIndex = headers.findIndex((header) => ["name", "nombre", "cliente", "contacto"].includes(header));
  const phoneIndex = headers.findIndex((header) => ["phone", "telefono", "teléfono", "celular"].includes(header));
  const rutIndex = headers.findIndex((header) => ["rut", "run"].includes(header));
  const startIndex = emailIndex >= 0 || nameIndex >= 0 ? 1 : 0;

  return rows.slice(startIndex).map((row, index) => {
    const fallbackEmail = row.find((cell) => String(cell).includes("@")) || "";
    const rawEmail = emailIndex >= 0 ? row[emailIndex] : fallbackEmail;
    const suggestion = emailSuggestion(rawEmail);
    const now = new Date().toISOString();
    return {
      id: id("contact"),
      name: String(nameIndex >= 0 ? row[nameIndex] : row[0] || "").trim() || `Contacto ${index + 1}`,
      email: suggestion.email,
      correctedEmail: suggestion.suggestion || "",
      emailSuggestion: suggestion,
      phone: String(phoneIndex >= 0 ? row[phoneIndex] : "").trim(),
      rut: String(rutIndex >= 0 ? row[rutIndex] : "").trim(),
      source,
      createdAt: now,
      updatedAt: now
    };
  });
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
    profileComplete: userProfileComplete(user),
    profileStatus: user.profileStatus || (userProfileComplete(user) ? "complete" : "pending"),
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
    source: order.source || "online",
    salePhaseName: order.salePhaseName || null,
    salePhaseKind: order.salePhaseKind || null,
    paymentMode: order.paymentMode,
    paymentStatus: order.payment?.status || null,
    paymentProvider: order.payment?.provider || null,
    paymentId: order.payment?.paymentId || null,
    checkoutUrl: order.checkoutUrl,
    invoiceStatus: order.invoiceStatus,
    fulfillmentStatus: order.fulfillmentStatus || null,
    profileRequired: Boolean(order.profileRequired),
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
    salePhaseName: ticket.salePhaseName || null,
    salePhaseKind: ticket.salePhaseKind || null,
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

function assetBaseUrl() {
  const base =
    process.env.R2_PUBLIC_BASE_URL ||
    process.env.PUBLIC_R2_BASE_URL ||
    process.env.R2_ASSET_BASE_URL ||
    "";
  return String(base).trim().replace(/\/$/, "");
}

function encodeR2Key(key) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function loadAllowedAssetKeys() {
  const keys = new Set();
  const manifestPath = path.join(process.cwd(), "HFC_R2_upload_ready", "_manifest.json");

  try {
    const rows = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    keys.add("_README.txt");
    keys.add("_manifest.csv");
    keys.add("_manifest.json");
    for (const row of rows) {
      if (row.r2_key) keys.add(row.r2_key);
      if (row.metadata_key) keys.add(row.metadata_key);
    }
  } catch {
    // The manifest exists locally during development. In production, the route
    // can still serve known public keys when R2_PUBLIC_BASE_URL is configured.
  }

  return keys;
}

const allowedAssetKeys = loadAllowedAssetKeys();

function r2CredentialsConfigured() {
  return Boolean(
    (process.env.CLOUDFLARE_S3_DEFAULT || process.env.CLOUDFLARE_S3_API) &&
      (process.env.cloudflare_s3_bucket || process.env.CLOUDFLARE_R2_BUCKET || process.env.R2_BUCKET_NAME) &&
      process.env.CLOUDFLARE_S3_ACCESS_KEY_ID &&
      process.env.CLOUDFLARE_S3_SECRET_ACCESS_KEY
  );
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function r2SigningKey(secret, dateStamp) {
  const dateKey = hmac(`AWS4${secret}`, dateStamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function signedR2Headers(method, key, payloadHash) {
  const endpoint = String(process.env.CLOUDFLARE_S3_DEFAULT || process.env.CLOUDFLARE_S3_API || "").replace(/\/$/, "");
  const bucket = process.env.cloudflare_s3_bucket || process.env.CLOUDFLARE_R2_BUCKET || process.env.R2_BUCKET_NAME;
  const url = new URL(`${endpoint}/${encodeURIComponent(bucket)}/${encodeR2Key(key)}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((header) => `${header}:${headers[header]}\n`)
    .join("");
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex")
  ].join("\n");
  const signature = crypto
    .createHmac("sha256", r2SigningKey(process.env.CLOUDFLARE_S3_SECRET_ACCESS_KEY, dateStamp))
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    url: url.toString(),
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${process.env.CLOUDFLARE_S3_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    }
  };
}

async function proxyR2Object(req, res, key) {
  const emptyPayloadHash = crypto.createHash("sha256").update("").digest("hex");
  const signed = signedR2Headers("GET", key, emptyPayloadHash);
  const response = await fetch(signed.url, {
    headers: signed.headers
  });

  if (!response.ok) {
    res.status(response.status).type("text/plain").send("No se pudo leer el recurso");
    return;
  }

  const contentType = response.headers.get("content-type");
  if (contentType) res.type(contentType);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.send(Buffer.from(await response.arrayBuffer()));
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

function findUserByEmail(state, email) {
  return state.users.find((candidate) => candidate.email === email);
}

function userProfileComplete(user) {
  return Boolean(
    user &&
      String(user.name || "").trim() &&
      validateRut(user.rut || "") &&
      String(user.phone || "").trim()
  );
}

function nameFromEmail(email) {
  const local = String(email || "").split("@")[0] || "Asistente";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Asistente";
}

function upsertCheckoutUser(state, email, body = {}) {
  const now = new Date().toISOString();
  const existing = findUserByEmail(state, email);

  if (existing) {
    existing.emailVerified = true;
    existing.emailVerificationMode = existing.emailVerificationMode || "checkout_inline";
    existing.termsAcceptedAt = existing.termsAcceptedAt || now;
    existing.profileStatus = userProfileComplete(existing) ? "complete" : "pending";
    existing.updatedAt = now;
    return existing;
  }

  const user = {
    id: id("user"),
    name: nameFromEmail(email),
    email,
    rut: "",
    phone: "",
    club: "",
    vehicle: "",
    interests: [],
    emailVerified: true,
    emailVerificationMode: "checkout_inline",
    profileStatus: "pending",
    source: "checkout_fast",
    termsAcceptedAt: now,
    createdAt: now,
    updatedAt: now
  };

  state.users.push(user);
  state.audit.push({
    id: id("audit"),
    type: "checkout_user_created",
    userId: user.id,
    email,
    createdAt: now
  });

  return user;
}

function buildOrderItems(state, itemsInput) {
  if (!Array.isArray(itemsInput) || !itemsInput.length) {
    const error = new Error("El carrito esta vacio");
    error.status = 400;
    throw error;
  }

  return itemsInput.map((item, index) => {
    const event = findEvent(state, item.eventId);
    const ticketType = findTicketType(state, item.ticketTypeId);
    const quantity = Number(item.quantity || 1);

    if (!event || !ticketType) {
      const error = new Error("Evento o entrada no disponible");
      error.status = 400;
      throw error;
    }

    if (!ticketAvailableForEvent(ticketType, event.id)) {
      const error = new Error("La entrada no esta disponible para este evento");
      error.status = 400;
      throw error;
    }

    const phase = activePhaseForTicket(state, event.id, ticketType);
    if (!phase) {
      const error = new Error(`${ticketType.name} no tiene una etapa de venta activa`);
      error.status = 409;
      throw error;
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > phase.maxQuantity) {
      const remainingText = phase.remaining === null ? "" : ` Quedan ${phase.remaining} en ${phase.name}.`;
      const error = new Error(
        `La cantidad permitida para ${ticketType.name} en ${phase.name} es 1 a ${phase.maxQuantity}.${remainingText}`
      );
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
      salePhaseId: phase.id,
      salePhaseName: phase.name,
      salePhaseKind: phase.kind,
      quantity,
      unitPrice: phase.price,
      total: phase.price * quantity
    };
  });
}

function getOrderItems(order, state = null) {
  if (order.items?.length) return order.items;

  const event = state ? findEvent(state, order.eventId) : findDefaultEvent(order.eventId);
  const ticketType = state ? findTicketType(state, order.ticketTypeId) : findDefaultTicketType(order.ticketTypeId);
  if (!event || !ticketType) return [];

  return [
    {
      id: id("line"),
      eventId: event.id,
      eventName: event.name,
      ticketTypeId: ticketType.id,
      ticketTypeName: ticketType.name,
      description: ticketType.description,
      salePhaseId: order.salePhaseId || "general",
      salePhaseName: order.salePhaseName || "Venta general",
      salePhaseKind: order.salePhaseKind || "general",
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
        salePhaseId: item.salePhaseId,
        salePhaseName: item.salePhaseName,
        salePhaseKind: item.salePhaseKind,
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

function envFlag(name) {
  return /^(1|true|yes|si|sí)$/i.test(String(process.env[name] || "").trim());
}

function normalizedPaymentData(paymentData = {}) {
  const raw = paymentData.raw || {};
  return {
    provider: paymentData.provider || "mercadopago",
    paymentId: paymentData.paymentId || raw.id || null,
    status: paymentData.status || raw.status || "approved",
    statusDetail: paymentData.statusDetail || raw.status_detail || null,
    paymentType: paymentData.paymentType || raw.payment_type_id || null,
    preferenceId: paymentData.preferenceId || raw.preference_id || null,
    externalReference: paymentData.externalReference || raw.external_reference || null,
    merchantOrderId: paymentData.merchantOrderId || raw.order?.id || raw.merchant_order_id || null,
    transactionAmount: Number(paymentData.transactionAmount || raw.transaction_amount || 0),
    paidAt: paymentData.paidAt || raw.date_approved || null,
    raw: paymentData.raw || null
  };
}

function paymentRecordId(provider, paymentId) {
  if (!paymentId) return id("payment");
  const safePaymentId = String(paymentId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${provider}_payment_${safePaymentId}`;
}

function upsertPaymentRecord(state, order, paymentData) {
  const payment = normalizedPaymentData(paymentData);
  const now = new Date().toISOString();
  const provider = String(payment.provider || order.paymentMode || "mercadopago");
  const paymentId = payment.paymentId ? String(payment.paymentId) : null;
  const existingIndex = state.payments.findIndex(
    (candidate) =>
      paymentId &&
      ((candidate.provider === provider && String(candidate.paymentId || "") === paymentId) ||
        candidate.id === paymentRecordId(provider, paymentId))
  );
  const existing = existingIndex >= 0 ? state.payments[existingIndex] : null;

  const record = {
    id: existing?.id || paymentRecordId(provider, paymentId),
    orderId: order.id,
    provider,
    paymentId,
    status: String(payment.status || "unknown"),
    statusDetail: payment.statusDetail,
    paymentType: payment.paymentType,
    preferenceId: payment.preferenceId || order.preferenceId || null,
    externalReference: payment.externalReference || order.id,
    merchantOrderId: payment.merchantOrderId,
    amount: payment.transactionAmount || order.total,
    currency: "CLP",
    paidAt: payment.paidAt,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  if (envFlag("MERCADOPAGO_STORE_RAW_PAYLOADS") && payment.raw) {
    record.raw = payment.raw;
  }

  if (existingIndex >= 0) {
    state.payments[existingIndex] = {
      ...existing,
      ...record
    };
  } else {
    state.payments.push(record);
  }

  return record;
}

function orderPaymentSummary(paymentRecord, fallback = {}) {
  return {
    status: paymentRecord.status,
    provider: paymentRecord.provider,
    paymentId: paymentRecord.paymentId,
    statusDetail: paymentRecord.statusDetail,
    paymentType: paymentRecord.paymentType,
    preferenceId: paymentRecord.preferenceId,
    paidAt: paymentRecord.paidAt || fallback.paidAt || null,
    updatedAt: paymentRecord.updatedAt
  };
}

function orderStatusForPaymentStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "approved") return "paid";
  if (["pending", "in_process", "authorized"].includes(normalized)) return "payment_pending";
  if (["rejected", "cancelled", "refunded", "charged_back"].includes(normalized)) return "payment_failed";
  return "payment_review";
}

function paymentModeForClient() {
  if (mercadoPagoInternalCheckoutEnabled()) return "mercadopago_api";
  return mercadoPagoConfigured() ? "mercadopago" : "demo";
}

function paymentDataFromMercadoPago(payment) {
  return {
    provider: "mercadopago",
    paymentId: String(payment.id || ""),
    status: payment.status,
    statusDetail: payment.status_detail,
    paymentType: payment.payment_type_id,
    preferenceId: payment.preference_id,
    externalReference: payment.external_reference,
    merchantOrderId: payment.order?.id || payment.merchant_order_id,
    transactionAmount: payment.transaction_amount,
    paidAt: payment.date_approved,
    raw: payment
  };
}

async function requireCheckoutStorage() {
  await verifyCheckoutStorage();
  if (checkoutStorageReady()) return;
  const error = new Error(lastSupabaseWarning() || "Configura Supabase en Vercel antes de activar ventas con Mercado Pago");
  error.status = 503;
  throw error;
}

async function updateOrderPaymentStatus(orderId, paymentData = {}) {
  let result;
  await updateState((state) => {
    const order = state.orders.find((candidate) => candidate.id === orderId);
    if (!order) {
      const error = new Error("Orden no encontrada");
      error.status = 404;
      throw error;
    }

    const paymentRecord = upsertPaymentRecord(state, order, paymentData);
    if (order.status !== "paid") {
      order.status = orderStatusForPaymentStatus(paymentRecord.status);
      order.payment = orderPaymentSummary(paymentRecord, order.payment);
      order.updatedAt = new Date().toISOString();
    }

    state.audit.push({
      id: id("audit"),
      type: "payment_status_updated",
      orderId: order.id,
      paymentId: paymentRecord.paymentId,
      status: paymentRecord.status,
      createdAt: new Date().toISOString()
    });

    result = { order, payment: paymentRecord };
  });

  return result;
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
  const items = getOrderItems(order, state);
  const firstItem = items[0];
  const event = firstItem ? findEvent(state, firstItem.eventId) : null;
  const ticketType = firstItem ? findTicketType(state, firstItem.ticketTypeId) : null;
  if (!user || !items.length) {
    const error = new Error("Orden incompleta");
    error.status = 409;
    throw error;
  }

  let tickets = state.tickets.filter((ticket) => ticket.orderId === order.id);
  let invoice = state.invoices.find((candidate) => candidate.orderId === order.id);
  const paymentRecord = upsertPaymentRecord(state, order, {
    ...paymentData,
    status: paymentData.status || "approved"
  });
  const profileReady = userProfileComplete(user);

  if (!profileReady) {
    order.status = "paid";
    order.payment = orderPaymentSummary(paymentRecord, {
      paidAt: new Date().toISOString()
    });
    order.profileRequired = true;
    order.fulfillmentStatus = "profile_pending";
    order.invoiceStatus = "profile_pending";
    order.updatedAt = new Date().toISOString();
    await writeState(state);
    return { order, user, event, ticketType, tickets: [], invoice: null, profileRequired: true };
  }

  if (order.status !== "paid") {
    order.status = "paid";
    order.payment = orderPaymentSummary(paymentRecord, {
      paidAt: new Date().toISOString()
    });
    order.profileRequired = false;
    order.fulfillmentStatus = "fulfilled";

    if (!tickets.length) {
      tickets = createTickets({ order, user, items });
      state.tickets.push(...tickets);
    }

    order.invoiceStatus = "pending";
    order.updatedAt = new Date().toISOString();
    await writeState(state);
  } else {
    if (!tickets.length) {
      tickets = createTickets({ order, user, items });
      state.tickets.push(...tickets);
    }
    order.payment = orderPaymentSummary(paymentRecord, order.payment);
    order.profileRequired = false;
    order.fulfillmentStatus = "fulfilled";
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

  state = await readState();
  const finalOrder = state.orders.find((candidate) => candidate.id === order.id) || order;
  if (!finalOrder.ticketEmailSentAt) {
    await sendTicketEmail({
      user,
      order: finalOrder,
      event,
      ticketType,
      tickets,
      invoice,
      template: findTemplate(state.emailTemplates, "payment"),
      baseUrl: process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/$/, "") : ""
    });
    finalOrder.ticketEmailSentAt = new Date().toISOString();
    finalOrder.updatedAt = finalOrder.ticketEmailSentAt;
    await writeState(state);
  }
  state = await readState();
  return {
    order: state.orders.find((candidate) => candidate.id === order.id) || finalOrder,
    user,
    event,
    ticketType,
    tickets,
    invoice
  };
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
  const items = getOrderItems(order, state);
  const firstItem = items[0];
  const event = firstItem ? findEvent(state, firstItem.eventId) : null;
  const ticketType = firstItem ? findTicketType(state, firstItem.ticketTypeId) : null;
  const tickets = state.tickets.filter((ticket) => ticket.orderId === order.id);
  const invoice = state.invoices.find((candidate) => candidate.orderId === order.id);

  if (!user || !tickets.length) {
    const error = new Error("La orden aun no tiene tickets emitidos");
    error.status = 409;
    throw error;
  }

  await sendTicketEmail({
    user,
    order,
    event,
    ticketType,
    tickets,
    invoice,
    template: findTemplate(state.emailTemplates, "payment"),
    baseUrl: process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/$/, "") : ""
  });

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

app.get("/api/health", async (req, res) => {
  if (process.env.VERCEL && supabaseConfigured()) {
    await verifyCheckoutStorage().catch(() => {});
  }

  res.json({
    ok: true,
    storage: {
      mode: storageMode(),
      supabase: supabaseConfigured(),
      checkoutReady: checkoutStorageReady(),
      warning: lastSupabaseWarning()
    },
    integrations: {
      smtp: smtpConfigured(),
      email: mailProviderStatus(),
      mercadoPago: mercadoPagoConfigured(),
      mercadoPagoDetails: mercadoPagoRuntimeStatus(req),
      openFactura: openFacturaConfigured()
    }
  });
});

app.get("/api/catalog", async (req, res, next) => {
  try {
    const state = await readState();
    res.json({
      ...catalogForClient(state),
      integrations: {
        paymentMode: paymentModeForClient(),
        mercadoPagoPublicKey: mercadoPagoInternalCheckoutEnabled() ? mercadoPagoPublicKey() : null,
        checkoutStorageReady: checkoutStorageReady()
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get("/media/*", async (req, res, next) => {
  try {
    const key = String(req.params[0] || "").replace(/^\/+/, "");

    if (!key || key.includes("..") || key.includes("\\")) {
      res.status(400).type("text/plain").send("Recurso invalido");
      return;
    }

    if (allowedAssetKeys.size && !allowedAssetKeys.has(key)) {
      res.status(404).type("text/plain").send("Recurso no encontrado");
      return;
    }

    const publicBase = assetBaseUrl();
    if (publicBase) {
      res.redirect(302, `${publicBase}/${encodeR2Key(key)}`);
      return;
    }

    const localRoot = path.resolve(process.cwd(), "HFC_R2_upload_ready");
    const localFile = path.resolve(localRoot, ...key.split("/"));
    if (localFile.startsWith(localRoot) && fs.existsSync(localFile)) {
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.sendFile(localFile);
      return;
    }

    if (r2CredentialsConfigured()) {
      await proxyR2Object(req, res, key);
      return;
    }

    res.status(404).type("text/plain").send("Configura R2_PUBLIC_BASE_URL para servir imagenes publicas");
  } catch (error) {
    next(error);
  }
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

async function createOrderFromItems({ req, user, items, state }) {
  const now = new Date().toISOString();
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const firstItem = items[0];
  const event = findEvent(state, firstItem.eventId);
  const ticketType = findTicketType(state, firstItem.ticketTypeId);

  const order = {
    id: id("order"),
    userId: user.id,
    eventId: firstItem.eventId,
    ticketTypeId: firstItem.ticketTypeId,
    salePhaseId: firstItem.salePhaseId,
    salePhaseName: firstItem.salePhaseName,
    salePhaseKind: firstItem.salePhaseKind,
    items,
    quantity,
    unitPrice: firstItem.unitPrice,
    total,
    status: "created",
    paymentMode: paymentModeForClient(),
    invoiceStatus: "not_started",
    fulfillmentStatus: "not_started",
    profileRequired: !userProfileComplete(user),
    source: user.source === "checkout_fast" ? "checkout_fast" : "registered",
    createdAt: now,
    updatedAt: now
  };

  let preference = {
    mode: order.paymentMode,
    checkoutUrl: null,
    preferenceId: null
  };

  if (order.paymentMode === "mercadopago") {
    preference = await createPreference({ req, order, user, event, ticketType });
    order.checkoutUrl = preference.checkoutUrl;
    order.preferenceId = preference.preferenceId;
    order.paymentMode = preference.mode;
  }

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
    const eventId = requireString(req.body, "eventId", "Evento");
    const ticketTypeId = requireString(req.body, "ticketTypeId", "Entrada");
    const quantity = Number(req.body.quantity || 1);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const error = new Error("El correo no tiene un formato valido");
      error.status = 400;
      throw error;
    }

    if (!req.body.termsAccepted) {
      const error = new Error("Debes aceptar terminos y condiciones para continuar");
      error.status = 400;
      throw error;
    }

    await requireCheckoutStorage();

    await updateState((state) => {
      upsertCheckoutUser(state, email, req.body);
    });

    const state = await readState();
    const items = buildOrderItems(state, [{ eventId, ticketTypeId, quantity }]);
    const user = findUserByEmail(state, email);
    const { order, preference } = await createOrderFromItems({ req, user, items, state });

    res.status(201).json({
      ok: true,
      order: publicOrder(order),
      checkoutUrl: preference.checkoutUrl,
      paymentMode: preference.mode,
      mercadoPagoPublicKey: mercadoPagoInternalCheckoutEnabled() ? mercadoPagoPublicKey() : null
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders/from-cart", async (req, res, next) => {
  try {
    const email = normalizeEmail(requireString(req.body, "email", "Correo"));

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const error = new Error("El correo no tiene un formato valido");
      error.status = 400;
      throw error;
    }

    if (!req.body.termsAccepted) {
      const error = new Error("Debes aceptar terminos y condiciones para continuar");
      error.status = 400;
      throw error;
    }

    await requireCheckoutStorage();

    await updateState((state) => {
      upsertCheckoutUser(state, email, req.body);
    });

    const state = await readState();
    const items = buildOrderItems(state, req.body.items);
    const user = findUserByEmail(state, email);
    const { order, preference } = await createOrderFromItems({ req, user, items, state });

    res.status(201).json({
      ok: true,
      order: publicOrder(order),
      checkoutUrl: preference.checkoutUrl,
      paymentMode: preference.mode,
      mercadoPagoPublicKey: mercadoPagoInternalCheckoutEnabled() ? mercadoPagoPublicKey() : null
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders/:orderId", async (req, res, next) => {
  try {
    const state = await readState();
    const order = state.orders.find((candidate) => candidate.id === req.params.orderId);
    const user = order ? state.users.find((candidate) => candidate.id === order.userId) : null;
    const tickets = state.tickets
      .filter((ticket) => ticket.orderId === req.params.orderId)
      .map((ticket) => publicTicket(ticket, req));
    const invoice = state.invoices.find((candidate) => candidate.orderId === req.params.orderId);

    if (!order) {
      res.status(404).json({ ok: false, message: "Orden no encontrada" });
      return;
    }

    res.json({ ok: true, order: publicOrder(order), user: publicUser(user), tickets, invoice });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders/:orderId/pay", async (req, res, next) => {
  try {
    if (!mercadoPagoInternalCheckoutEnabled()) {
      const error = new Error("Checkout interno de Mercado Pago no esta configurado");
      error.status = 503;
      throw error;
    }

    await requireCheckoutStorage();

    const state = await readState();
    const order = state.orders.find((candidate) => candidate.id === req.params.orderId);
    const user = order ? state.users.find((candidate) => candidate.id === order.userId) : null;

    if (!order || !user) {
      const error = new Error("Orden no encontrada");
      error.status = 404;
      throw error;
    }

    if (order.status === "paid") {
      const tickets = state.tickets
        .filter((ticket) => ticket.orderId === order.id)
        .map((ticket) => publicTicket(ticket, req));
      const invoice = state.invoices.find((candidate) => candidate.orderId === order.id);
      res.json({ ok: true, order: publicOrder(order), user: publicUser(user), tickets, invoice });
      return;
    }

    if (order.status !== "created" && !String(order.status || "").startsWith("payment_")) {
      const error = new Error("La orden no esta disponible para pago");
      error.status = 409;
      throw error;
    }

    const formData = req.body.formData || req.body;
    const payment = await createCardPayment({
      req,
      order,
      user,
      formData,
      idempotencyKey: req.get("x-idempotency-key") || req.body.idempotencyKey
    });
    const paymentData = paymentDataFromMercadoPago(payment);

    if (payment.status === "approved") {
      const result = await completeOrderPayment(order.id, paymentData);
      res.json({
        ok: true,
        order: publicOrder(result.order),
        user: publicUser(result.user),
        tickets: result.tickets.map((ticket) => publicTicket(ticket, req)),
        invoice: result.invoice,
        payment: {
          id: payment.id,
          status: payment.status,
          statusDetail: payment.status_detail
        }
      });
      return;
    }

    const result = await updateOrderPaymentStatus(order.id, paymentData);
    const currentState = await readState();
    const currentUser = currentState.users.find((candidate) => candidate.id === result.order.userId);
    res.json({
      ok: true,
      order: publicOrder(result.order),
      user: publicUser(currentUser),
      tickets: [],
      invoice: null,
      payment: {
        id: payment.id,
        status: payment.status,
        statusDetail: payment.status_detail
      }
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders/:orderId/profile", async (req, res, next) => {
  try {
    const orderId = req.params.orderId;
    const email = normalizeEmail(requireString(req.body, "email", "Correo"));
    const name = requireString(req.body, "name", "Nombre");
    const rutInput = requireString(req.body, "rut", "RUT");
    const phone = requireString(req.body, "phone", "Telefono");

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

    let paymentForFulfillment = null;

    await updateState((state) => {
      const order = state.orders.find((candidate) => candidate.id === orderId);
      if (!order) {
        const error = new Error("Orden no encontrada");
        error.status = 404;
        throw error;
      }

      const user = state.users.find((candidate) => candidate.id === order.userId);
      if (!user || user.email !== email) {
        const error = new Error("El correo no coincide con la orden");
        error.status = 403;
        throw error;
      }

      const normalizedRut = cleanRut(rutInput);
      const rutOwner = state.users.find(
        (candidate) => candidate.id !== user.id && cleanRut(candidate.rut) === normalizedRut
      );
      if (rutOwner) {
        const error = new Error("Ese RUT ya esta asociado a otro registro");
        error.status = 409;
        throw error;
      }

      const now = new Date().toISOString();
      user.name = name;
      user.rut = formatRut(rutInput);
      user.phone = phone;
      user.club = String(req.body.club || user.club || "").trim();
      user.vehicle = String(req.body.vehicle || user.vehicle || "").trim();
      user.emailVerified = true;
      user.profileStatus = "complete";
      user.profileCompletedAt = user.profileCompletedAt || now;
      user.updatedAt = now;

      state.tickets
        .filter((ticket) => ticket.orderId === order.id)
        .forEach((ticket) => {
          ticket.holderName = user.name;
          ticket.holderRut = user.rut;
          ticket.updatedAt = now;
        });

      order.profileRequired = false;
      order.updatedAt = now;
      paymentForFulfillment = order.payment || {
        provider: order.paymentMode || "mercadopago",
        paymentId: null,
        status: "approved"
      };

      state.audit.push({
        id: id("audit"),
        type: "checkout_profile_completed",
        orderId: order.id,
        userId: user.id,
        createdAt: now
      });
    });

    const state = await readState();
    const order = state.orders.find((candidate) => candidate.id === orderId);
    if (!order || order.status !== "paid") {
      res.json({ ok: true, order: publicOrder(order), profileCompleted: true });
      return;
    }

    const result = await completeOrderPayment(orderId, {
      provider: paymentForFulfillment?.provider || order.paymentMode || "mercadopago",
      paymentId: paymentForFulfillment?.paymentId || null,
      status: "approved",
      statusDetail: paymentForFulfillment?.statusDetail || null
    });

    res.json({
      ok: true,
      order: publicOrder(result.order),
      user: publicUser(result.user),
      tickets: result.tickets.map((ticket) => publicTicket(ticket, req)),
      invoice: result.invoice,
      profileCompleted: true
    });
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

function publicContact(contact) {
  const suggestion = emailSuggestion(contact.correctedEmail || contact.email);
  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    correctedEmail: contact.correctedEmail || "",
    effectiveEmail: contact.correctedEmail || contact.email,
    phone: contact.phone || "",
    rut: contact.rut || "",
    source: contact.source || "",
    emailSuggestion: contact.emailSuggestion || suggestion,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt
  };
}

function publicAdminUser(user, state) {
  const orders = (state.orders || []).filter((order) => order.userId === user.id);
  const tickets = (state.tickets || []).filter((ticket) => ticket.userId === user.id);
  return {
    ...publicUser(user),
    source: user.source || "web",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    emailSuggestion: emailSuggestion(user.email),
    orders: orders.length,
    tickets: tickets.length
  };
}

function logEmailResult(state, entry) {
  if (!state.emailLogs) state.emailLogs = [];
  state.emailLogs.push({
    id: id("email"),
    ...entry,
    createdAt: new Date().toISOString()
  });
}

function audienceFromRequest(state, body = {}) {
  const target = String(body.target || "selected").trim();
  const explicitEmails = String(body.emails || "")
    .split(/[\n,;]/)
    .map((email) => normalizeEmail(email))
    .filter(Boolean)
    .map((email) => ({ id: email, name: email.split("@")[0], email, kind: "manual" }));

  if (target === "users_all") {
    return (state.users || []).map((user) => ({ ...user, email: user.email, kind: "user" })).filter((user) => user.email);
  }

  if (target === "users_unverified") {
    return (state.users || [])
      .filter((user) => !user.emailVerified)
      .map((user) => ({ ...user, email: user.email, kind: "user" }))
      .filter((user) => user.email);
  }

  if (target === "contacts_all") {
    return (state.contacts || [])
      .map((contact) => ({
        ...contact,
        email: contact.correctedEmail || contact.email,
        kind: "contact"
      }))
      .filter((contact) => contact.email);
  }

  if (target === "selected_users" && Array.isArray(body.ids)) {
    const ids = new Set(body.ids);
    return (state.users || [])
      .filter((user) => ids.has(user.id))
      .map((user) => ({ ...user, email: user.email, kind: "user" }))
      .filter((user) => user.email);
  }

  return explicitEmails;
}

async function sendCampaignBatch({ req, state, body }) {
  const template = findTemplate(state.emailTemplates, body.templateId || body.templateType || "marketing");
  const recipients = audienceFromRequest(state, body);
  const base = baseUrl(req);
  const unique = new Map();
  for (const recipient of recipients) {
    const email = normalizeEmail(recipient.email);
    if (email) unique.set(email, { ...recipient, email });
  }

  const results = [];
  for (const recipient of unique.values()) {
    const variables = {
      name: recipient.name || recipient.email,
      email: recipient.email,
      event_name: body.eventName || "Honda Fest Chile",
      enroll_url: `${base}/ticketera`,
      cta_url: body.ctaUrl || `${base}/ticketera`,
      campaign_title: body.subject || body.campaignTitle || template.subject || "Honda Fest Chile",
      campaign_body: body.body || body.campaignBody || ""
    };
    const rendered = renderTemplate(
      {
        ...template,
        subject: body.subject || template.subject,
        text: body.text || template.text,
        html: body.html || template.html
      },
      variables
    );

    try {
      const result = await sendMail({
        to: recipient.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html
      });
      logEmailResult(state, {
        type: body.templateId || body.templateType || template.type,
        templateId: template.id,
        to: recipient.email,
        recipientId: recipient.id,
        recipientKind: recipient.kind,
        status: "sent",
        mode: result.mode,
        subject: rendered.subject
      });
      results.push({ email: recipient.email, ok: true, mode: result.mode });
    } catch (error) {
      logEmailResult(state, {
        type: body.templateId || body.templateType || template.type,
        templateId: template.id,
        to: recipient.email,
        recipientId: recipient.id,
        recipientKind: recipient.kind,
        status: "failed",
        error: error.message,
        subject: rendered.subject
      });
      results.push({ email: recipient.email, ok: false, message: error.message });
    }
  }

  return results;
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
        guestTickets: state.tickets.filter((ticket) => ticket.salePhaseKind === "guest").length,
        checkedInTickets: state.tickets.filter((ticket) => ticket.status === "checked_in").length,
        users: state.users.length,
        enrolados: state.users.filter((user) => user.emailVerified).length,
        contacts: (state.contacts || []).length
      },
      bi: salesBi(state),
      ticketing: ticketingConfig(state),
      orders,
      tickets: state.tickets.map((ticket) => publicTicket(ticket, req)),
      users: state.users.map((user) => publicAdminUser(user, state)),
      contacts: (state.contacts || []).map(publicContact),
      emailTemplates: mergeTemplates(state.emailTemplates || []),
      invoices: state.invoices,
      emailLogs: (state.emailLogs || []).slice(-200).reverse(),
      storage: {
        mode: storageMode(),
        supabase: supabaseConfigured(),
        warning: lastSupabaseWarning()
      },
      integrations: {
        email: mailProviderStatus()
      }
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/backoffice/ticketing", async (req, res, next) => {
  try {
    requireAdmin(req);
    let saved;
    await updateState((state) => {
      const payload = normalizeTicketingConfig(req.body.ticketing || req.body);
      saved = upsertSetting(state, {
        id: TICKETING_SETTING_ID,
        type: "ticketing",
        payload
      });
      state.audit.push({
        id: id("audit"),
        type: "ticketing_config_updated",
        settingId: saved.id,
        createdAt: saved.updatedAt
      });
    });
    res.json({ ok: true, ticketing: saved.payload });
  } catch (error) {
    next(error);
  }
});

app.post("/api/backoffice/guests", async (req, res, next) => {
  try {
    requireAdmin(req);
    const name = requireString(req.body, "name", "Nombre");
    const email = normalizeEmail(requireString(req.body, "email", "Correo"));
    const eventId = requireString(req.body, "eventId", "Evento");
    const ticketTypeId = requireString(req.body, "ticketTypeId", "Entrada");
    const quantity = Math.max(1, Math.min(20, Number(req.body.quantity || 1)));
    const rutInput = String(req.body.rut || "").trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const error = new Error("El correo no tiene un formato valido");
      error.status = 400;
      throw error;
    }

    if (rutInput && !validateRut(rutInput)) {
      const error = new Error("El RUT del invitado no es valido");
      error.status = 400;
      throw error;
    }

    let result;
    await updateState((state) => {
      const event = findEvent(state, eventId);
      const ticketType = findTicketType(state, ticketTypeId);
      if (!event || !ticketType) {
        const error = new Error("Evento o entrada no disponible");
        error.status = 400;
        throw error;
      }

      if (!ticketAvailableForEvent(ticketType, event.id)) {
        const error = new Error("La entrada no esta disponible para este evento");
        error.status = 400;
        throw error;
      }

      const now = new Date().toISOString();
      let user = state.users.find((candidate) => candidate.email === email);
      if (!user) {
        user = {
          id: id("user"),
          name,
          email,
          rut: rutInput ? formatRut(rutInput) : null,
          phone: String(req.body.phone || "").trim(),
          club: "Invitado",
          vehicle: "",
          interests: [],
          passwordHash: "",
          source: "guest",
          emailVerified: true,
          verificationToken: null,
          createdAt: now,
          updatedAt: now
        };
        state.users.push(user);
      } else {
        user.name = name || user.name;
        user.rut = rutInput ? formatRut(rutInput) : user.rut;
        user.source = user.source || "guest";
        user.emailVerified = true;
        user.updatedAt = now;
      }

      const items = [
        {
          id: id("line"),
          eventId: event.id,
          eventName: event.name,
          ticketTypeId: ticketType.id,
          ticketTypeName: ticketType.name,
          description: ticketType.description,
          salePhaseId: "guest",
          salePhaseName: "Invitado",
          salePhaseKind: "guest",
          quantity,
          unitPrice: 0,
          total: 0
        }
      ];
      const order = {
        id: id("guest_order"),
        userId: user.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        salePhaseId: "guest",
        salePhaseName: "Invitado",
        salePhaseKind: "guest",
        items,
        quantity,
        unitPrice: 0,
        total: 0,
        status: "paid",
        source: "guest",
        paymentMode: "guest",
        invoiceStatus: "not_required",
        note: String(req.body.note || "").trim(),
        createdAt: now,
        updatedAt: now
      };
      const tickets = createTickets({ order, user, items });
      state.orders.push(order);
      state.tickets.push(...tickets);
      state.audit.push({
        id: id("audit"),
        type: "guest_tickets_created",
        orderId: order.id,
        userId: user.id,
        quantity,
        createdAt: now
      });
      result = { user, order, tickets, event, ticketType };
    });

    if (req.body.sendEmail !== false) {
      const state = await readState();
      await sendTicketEmail({
        user: result.user,
        order: result.order,
        event: result.event,
        ticketType: result.ticketType,
        tickets: result.tickets,
        invoice: null,
        template: findTemplate(state.emailTemplates, "ticket_after_enrollment"),
        baseUrl: baseUrl(req)
      });
      await updateState((state) => {
        logEmailResult(state, {
          type: "ticket_after_enrollment",
          templateId: "ticket_after_enrollment",
          to: result.user.email,
          userId: result.user.id,
          orderId: result.order.id,
          status: "sent"
        });
      });
    }

    res.status(201).json({
      ok: true,
      order: publicOrder(result.order),
      user: publicUser(result.user),
      tickets: result.tickets.map((ticket) => publicTicket(ticket, req))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/backoffice/contacts/import", async (req, res, next) => {
  try {
    requireAdmin(req);
    const contacts = contactsFromCsv(req.body.csv || req.body.text || "", req.body.source || "csv");
    let imported = 0;
    await updateState((state) => {
      if (!state.contacts) state.contacts = [];
      for (const contact of contacts) {
        const existing = state.contacts.find(
          (candidate) =>
            normalizeEmail(candidate.email) === contact.email ||
            normalizeEmail(candidate.correctedEmail) === contact.email
        );
        if (existing) {
          Object.assign(existing, {
            ...contact,
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString()
          });
        } else {
          state.contacts.push(contact);
        }
        imported += 1;
      }
      state.audit.push({
        id: id("audit"),
        type: "contacts_imported",
        count: imported,
        source: req.body.source || "csv",
        createdAt: new Date().toISOString()
      });
    });
    const state = await readState();
    res.json({ ok: true, imported, contacts: (state.contacts || []).map(publicContact) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/backoffice/contacts/:contactId/email", async (req, res, next) => {
  try {
    requireAdmin(req);
    const email = normalizeEmail(requireString(req.body, "email", "Correo"));
    let contact;
    await updateState((state) => {
      contact = (state.contacts || []).find((candidate) => candidate.id === req.params.contactId);
      if (!contact) {
        const error = new Error("Contacto no encontrado");
        error.status = 404;
        throw error;
      }
      contact.correctedEmail = email;
      contact.emailSuggestion = emailSuggestion(email);
      contact.updatedAt = new Date().toISOString();
      state.audit.push({
        id: id("audit"),
        type: "contact_email_corrected",
        contactId: contact.id,
        email,
        createdAt: contact.updatedAt
      });
    });
    res.json({ ok: true, contact: publicContact(contact) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/backoffice/users/:userId/email", async (req, res, next) => {
  try {
    requireAdmin(req);
    const email = normalizeEmail(requireString(req.body, "email", "Correo"));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const error = new Error("El correo no tiene un formato valido");
      error.status = 400;
      throw error;
    }

    let user;
    await updateState((state) => {
      user = state.users.find((candidate) => candidate.id === req.params.userId);
      if (!user) {
        const error = new Error("Usuario no encontrado");
        error.status = 404;
        throw error;
      }
      const duplicate = state.users.find((candidate) => candidate.id !== user.id && candidate.email === email);
      if (duplicate) {
        const error = new Error("Ya existe otro enrolado con ese correo");
        error.status = 409;
        throw error;
      }
      user.previousEmail = user.email;
      user.email = email;
      user.emailVerified = false;
      user.verificationToken = id("verify");
      user.verificationSentAt = new Date().toISOString();
      user.updatedAt = user.verificationSentAt;
      state.audit.push({
        id: id("audit"),
        type: "user_email_corrected",
        userId: user.id,
        previousEmail: user.previousEmail,
        email,
        createdAt: user.updatedAt
      });
    });

    if (req.body.resend !== false) {
      const verificationUrl = `${baseUrl(req)}/api/auth/verify?token=${user.verificationToken}`;
      await sendVerificationEmail({ user, verificationUrl });
      await updateState((state) => {
        logEmailResult(state, {
          type: "verification_after_email_correction",
          to: user.email,
          userId: user.id,
          status: "sent"
        });
      });
    }

    const state = await readState();
    res.json({ ok: true, user: publicAdminUser(user, state) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/backoffice/users/:userId/resend-verification", async (req, res, next) => {
  try {
    requireAdmin(req);
    let user;
    await updateState((state) => {
      user = state.users.find((candidate) => candidate.id === req.params.userId);
      if (!user) {
        const error = new Error("Usuario no encontrado");
        error.status = 404;
        throw error;
      }
      user.verificationToken = id("verify");
      user.verificationSentAt = new Date().toISOString();
      user.updatedAt = user.verificationSentAt;
    });
    const verificationUrl = `${baseUrl(req)}/api/auth/verify?token=${user.verificationToken}`;
    await sendVerificationEmail({ user, verificationUrl });
    await updateState((state) => {
      logEmailResult(state, {
        type: "resend_verification",
        to: user.email,
        userId: user.id,
        status: "sent"
      });
    });
    res.json({ ok: true, user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/backoffice/email/send", async (req, res, next) => {
  try {
    requireAdmin(req);
    let results = [];
    await updateState(async (state) => {
      results = await sendCampaignBatch({ req, state, body: req.body });
    });
    res.json({
      ok: true,
      sent: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/backoffice/email-templates/:templateId", async (req, res, next) => {
  try {
    requireAdmin(req);
    let template;
    await updateState((state) => {
      if (!state.emailTemplates) state.emailTemplates = [];
      template = normalizeTemplate({
        id: req.params.templateId,
        type: req.body.type || req.params.templateId,
        name: req.body.name,
        subject: req.body.subject,
        text: req.body.text,
        html: req.body.html
      });
      const index = state.emailTemplates.findIndex((candidate) => candidate.id === template.id);
      if (index >= 0) state.emailTemplates[index] = { ...state.emailTemplates[index], ...template };
      else state.emailTemplates.push(template);
      state.audit.push({
        id: id("audit"),
        type: "email_template_updated",
        templateId: template.id,
        createdAt: new Date().toISOString()
      });
    });
    res.json({ ok: true, template });
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
    const signature = verifyWebhookSignature(req);
    if (!signature.valid) {
      res.status(401).json({ ok: false, message: signature.reason || "Webhook no autorizado" });
      return;
    }

    const { topic, paymentId } = parseWebhookNotification(req);

    if (!paymentId || !String(topic).includes("payment")) {
      res.json({ ok: true, ignored: true });
      return;
    }

    const payment = await getPayment(paymentId);
    if (!payment.external_reference) {
      res.json({ ok: true, ignored: true, reason: "missing_external_reference" });
      return;
    }

    const paymentData = {
      provider: "mercadopago",
      paymentId: String(payment.id),
      status: payment.status,
      statusDetail: payment.status_detail,
      paymentType: payment.payment_type_id,
      preferenceId: payment.preference_id,
      externalReference: payment.external_reference,
      merchantOrderId: payment.order?.id || payment.merchant_order_id,
      transactionAmount: payment.transaction_amount,
      paidAt: payment.date_approved,
      raw: payment
    };

    if (payment.status === "approved") {
      await completeOrderPayment(payment.external_reference, {
        ...paymentData,
        status: "approved"
      });
    } else {
      await updateOrderPaymentStatus(payment.external_reference, paymentData);
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

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Honda Fest Chile listo en http://localhost:${port}`);
  });
}

module.exports = app;
