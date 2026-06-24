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
const { issueBoleta, openFacturaConfigured, openFacturaRuntimeStatus } = require("./lib/openfactura");
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

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function normalizePhone(phone = "") {
  return String(phone || "").replace(/[^\d+]/g, "");
}

function normalizeLicensePlate(value = "") {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const TICKETING_SETTING_ID = "ticketing_config";
const DEFAULT_EVENT_ID = defaultEvents[0]?.id || "honda-fest-chile-2026";
const TICKET_VAT_RATE = 0.19;
const TICKET_SERVICE_CHARGE_RATE = 0.12;
const TICKET_TOTAL_FACTOR = (1 + TICKET_VAT_RATE) * (1 + TICKET_SERVICE_CHARGE_RATE);
const TICKET_ENTRY_TYPES = new Set(["attendee", "pilot", "guest"]);
const TICKET_ENTRY_TYPE_LABELS = {
  attendee: "Asistente",
  pilot: "Piloto",
  guest: "Invitado"
};
const DATA_TERMS_VERSION = "datos-personales-cl-2026-12";

function roundCurrency(value) {
  return Math.max(0, Math.round(Number(value || 0)));
}

function ticketPricingFromNet(netPrice) {
  const net = roundCurrency(netPrice);
  const netWithVat = roundCurrency(net * (1 + TICKET_VAT_RATE));
  const netWithServiceCharge = roundCurrency(net * (1 + TICKET_SERVICE_CHARGE_RATE));
  const serviceCharge = roundCurrency(netWithVat * TICKET_SERVICE_CHARGE_RATE);
  const total = roundCurrency(netWithVat + serviceCharge);
  return {
    netPrice: net,
    netWithVat,
    netWithServiceCharge,
    serviceCharge,
    total,
    vatRate: TICKET_VAT_RATE,
    serviceChargeRate: TICKET_SERVICE_CHARGE_RATE
  };
}

function inferNetPriceFromGross(grossPrice) {
  return roundCurrency(Number(grossPrice || 0) / TICKET_TOTAL_FACTOR);
}

function explicitNetPrice(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeTicketEntryType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const aliases = {
    assistant: "attendee",
    asistencia: "attendee",
    asistente: "attendee",
    attendee: "attendee",
    general: "attendee",
    pilot: "pilot",
    piloto: "pilot",
    driver: "pilot",
    guest: "guest",
    invitado: "guest",
    invitada: "guest",
    cortesia: "guest"
  };
  const entryType = aliases[normalized] || normalized;
  return TICKET_ENTRY_TYPES.has(entryType) ? entryType : "attendee";
}

function defaultTicketPhases(ticket) {
  const pricing = ticketPricingFromNet(explicitNetPrice(ticket.netPrice) ?? inferNetPriceFromGross(ticket.price));
  return [
    {
      id: "preventa",
      name: "Preventa",
      kind: "preventa",
      price: pricing.total,
      netPrice: pricing.netPrice,
      pricing,
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
      price: pricing.total,
      netPrice: pricing.netPrice,
      pricing,
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
      price: pricing.total,
      netPrice: pricing.netPrice,
      pricing,
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
  const rawPrice = Number.isFinite(Number(phase.price)) ? Number(phase.price) : Number(ticket.price || 0);
  const netPrice =
    explicitNetPrice(phase.netPrice ?? phase.basePrice ?? phase.priceNet) ??
    inferNetPriceFromGross(rawPrice);
  const pricing = ticketPricingFromNet(netPrice);
  const quota = phase.quota === "" || phase.quota === null || phase.quota === undefined ? null : Number(phase.quota);
  const perOrderLimit =
    phase.perOrderLimit === "" || phase.perOrderLimit === null || phase.perOrderLimit === undefined
      ? Number(ticket.maxQuantity || 1)
      : Number(phase.perOrderLimit);

  return {
    id: idValue || fallbackId,
    name: String(phase.name || phase.label || fallbackId).trim(),
    kind,
    price: pricing.total,
    netPrice: pricing.netPrice,
    pricing,
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
  const rawPrice = Math.max(0, Math.round(Number(ticket.price ?? base.price ?? 0)));
  const pricing = ticketPricingFromNet(explicitNetPrice(ticket.netPrice) ?? inferNetPriceFromGross(rawPrice));
  const normalized = {
    ...base,
    ...ticket,
    id: idValue || base.id || id("ticket-type"),
    name: String(ticket.name || base.name || "Entrada").trim(),
    description: String(ticket.description || base.description || "").trim(),
    price: pricing.total,
    netPrice: pricing.netPrice,
    pricing,
    entryType: normalizeTicketEntryType(ticket.entryType || ticket.ticketType || ticket.kind || base.entryType),
    entryTypeLabel:
      TICKET_ENTRY_TYPE_LABELS[
        normalizeTicketEntryType(ticket.entryType || ticket.ticketType || ticket.kind || base.entryType)
      ],
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

const SPANISH_MONTH_INDEX = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11
};

function dateFromEventLabel(value = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const match = normalized.match(/\b(\d{1,2})(?:\s*(?:y|al|-)\s*\d{1,2})?\s+de\s+([a-z]+)\s+de\s+(\d{4})\b/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = SPANISH_MONTH_INDEX[match[2]];
  const year = Number(match[3]);
  if (!Number.isInteger(day) || month === undefined || !Number.isInteger(year)) return null;
  return Date.UTC(year, month, day);
}

function eventSortValue(event) {
  const explicitDate = Date.parse(event.eventDate || "");
  if (Number.isFinite(explicitDate)) return explicitDate;
  const labelDate = dateFromEventLabel(event.dateLabel);
  return Number.isFinite(labelDate) ? labelDate : Number.MAX_SAFE_INTEGER;
}

function sortEventsByDate(events) {
  return events
    .map((event, index) => ({ event, index, sortValue: eventSortValue(event) }))
    .sort((left, right) => left.sortValue - right.sortValue || left.index - right.index)
    .map(({ event }) => event);
}

function normalizeTicketingConfig(config = {}) {
  const defaults = defaultTicketingConfig();
  const hasEvents = Object.prototype.hasOwnProperty.call(config, "events");
  const hasTicketTypes = Object.prototype.hasOwnProperty.call(config, "ticketTypes");
  const events = hasEvents && Array.isArray(config.events) ? config.events : defaults.events;
  const ticketTypes = hasTicketTypes && Array.isArray(config.ticketTypes) ? config.ticketTypes : defaults.ticketTypes;

  return {
    events: sortEventsByDate(events.map(normalizeEvent).filter((event) => event.active !== false)),
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
  if (normalizeTicketEntryType(ticket.entryType) === "guest") return null;

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
          const pricing = phase?.pricing || ticket.pricing || ticketPricingFromNet(phase?.netPrice ?? ticket.netPrice ?? 0);
          return [
            event.id,
            {
              price: pricing.total,
              netPrice: pricing.netPrice,
              pricing,
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
      const ticketPrimaryEventId = Array.isArray(ticket.eventIds) && ticket.eventIds.length ? ticket.eventIds[0] : primaryEventId;
      const primary = availabilityByEvent[ticketPrimaryEventId] || availabilityByEvent[primaryEventId] || Object.values(availabilityByEvent)[0] || null;
      return {
        ...ticket,
        price: primary?.price ?? ticket.price,
        netPrice: primary?.netPrice ?? ticket.netPrice,
        pricing: primary?.pricing ?? ticket.pricing,
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
    licensePlate: user.licensePlate || "",
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
    invoiceError: order.invoiceError || null,
    fulfillmentStatus: order.fulfillmentStatus || null,
    profileRequired: Boolean(order.profileRequired),
    requiresPilotInfo: Boolean(order.requiresPilotInfo),
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
    entryType: normalizeTicketEntryType(ticket.entryType),
    entryTypeLabel: TICKET_ENTRY_TYPE_LABELS[normalizeTicketEntryType(ticket.entryType)],
    salePhaseName: ticket.salePhaseName || null,
    salePhaseKind: ticket.salePhaseKind || null,
    code: ticket.code,
    holderName: ticket.holderName,
    holderRut: ticket.holderRut,
    holderLicensePlate: ticket.holderLicensePlate || "",
    holderVehicle: ticket.holderVehicle || "",
    holderClub: ticket.holderClub || "",
    status: ticket.status,
    validatedAt: ticket.validatedAt || null,
    createdAt: ticket.createdAt,
    verifyUrl,
    qrUrl: `/api/tickets/${encodeURIComponent(ticket.code)}/qr.svg`
  };
}

function invoiceLooksDemo(invoice) {
  if (!invoice) return false;
  return (
    invoice.mode === "demo" ||
    String(invoice.id || "").startsWith("dte_demo_") ||
    String(invoice.folio || "").startsWith("DEMO-") ||
    String(invoice.providerId || "").startsWith("OF-DEMO-")
  );
}

function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  }
  return `${req.protocol}://${req.get("host")}`;
}

function configuredBaseUrl(req = null) {
  if (req) return baseUrl(req);
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  }
  return `http://localhost:${port}`;
}

function enrollmentUrlForToken(reqOrBase, token) {
  const base = typeof reqOrBase === "string" ? reqOrBase : configuredBaseUrl(reqOrBase);
  return `${base.replace(/\/$/, "")}/enrolamiento?token=${encodeURIComponent(token)}`;
}

function enrollmentQrUrlForToken(reqOrBase, token) {
  const base = typeof reqOrBase === "string" ? reqOrBase : configuredBaseUrl(reqOrBase);
  return `${base.replace(/\/$/, "")}/api/enrollment/${encodeURIComponent(token)}/qr.svg`;
}

function enrollmentLinks(order, reqOrBase) {
  if (!order?.enrollmentToken) return {};
  return {
    enrollmentUrl: enrollmentUrlForToken(reqOrBase, order.enrollmentToken),
    enrollmentQrUrl: enrollmentQrUrlForToken(reqOrBase, order.enrollmentToken)
  };
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

async function proxyPublicAssetObject(res, key) {
  const publicBase = assetBaseUrl();
  if (!publicBase) return false;

  const response = await fetch(`${publicBase}/${encodeR2Key(key)}`);
  if (!response.ok) {
    res.status(response.status).type("text/plain").send("No se pudo leer el recurso");
    return true;
  }

  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.set("Content-Type", response.headers.get("content-type") || "application/octet-stream");
  res.send(Buffer.from(await response.arrayBuffer()));
  return true;
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

function bearerToken(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

function currentSessionFromRequest(req, state, type = null) {
  const token = bearerToken(req);
  if (!token) return null;
  const now = Date.now();
  return (
    (state.sessions || []).find((session) => {
      if (!safeEqualString(session.token, token)) return false;
      if (type && session.type !== type) return false;
      if (session.expiresAt && Date.parse(session.expiresAt) <= now) return false;
      return true;
    }) || null
  );
}

function accountUserFromRequest(req, state) {
  const session = currentSessionFromRequest(req, state, "account");
  return session ? state.users.find((candidate) => candidate.id === session.userId) || null : null;
}

function findUserByEmailRut(state, email, rutInput) {
  return state.users.find(
    (candidate) => candidate.email === email && cleanRut(candidate.rut) === cleanRut(rutInput)
  );
}

function findUserByRutContact(state, rutInput, contactInput) {
  const normalizedRut = cleanRut(rutInput);
  if (!normalizedRut) return null;
  const email = normalizeEmail(contactInput);
  const phone = normalizePhone(contactInput);
  return state.users.find((candidate) => {
    if (cleanRut(candidate.rut) !== normalizedRut) return false;
    const emails = [candidate.email, ...(candidate.emailAliases || [])].map(normalizeEmail).filter(Boolean);
    if (validEmail(email) && emails.includes(email)) return true;
    return phone && normalizePhone(candidate.phone) === phone;
  });
}

function findUserByEmail(state, email) {
  return state.users.find((candidate) => candidate.email === email);
}

function findUserByRut(state, rutInput) {
  const normalizedRut = cleanRut(rutInput);
  if (!normalizedRut) return null;
  return state.users.find((candidate) => cleanRut(candidate.rut) === normalizedRut);
}

function userProfileComplete(user) {
  if (user?.profileStatus === "pending" || user?.namePending) return false;
  return Boolean(
    user &&
      String(user.name || "").trim() &&
      validateRut(user.rut || "") &&
      String(user.phone || "").trim()
  );
}

function pilotProfileComplete(user) {
  return Boolean(
    userProfileComplete(user) &&
      normalizeLicensePlate(user.licensePlate || user.patent || user.plate).trim() &&
      String(user.vehicle || "").trim() &&
      String(user.club || "").trim()
  );
}

function orderItemsRequirePilotInfo(items = [], state = null) {
  return items.some((item) => {
    const ticketType = state && item.ticketTypeId ? findTicketType(state, item.ticketTypeId) : null;
    return normalizeTicketEntryType(item.entryType || item.ticketEntryType || ticketType?.entryType) === "pilot";
  });
}

function orderRequiresPilotInfo(order, state = null) {
  if (!order) return false;
  return orderItemsRequirePilotInfo(getOrderItems(order, state), state);
}

function userProfileCompleteForItems(user, items = [], state = null) {
  if (orderItemsRequirePilotInfo(items, state)) return pilotProfileComplete(user);
  return userProfileComplete(user);
}

function userProfileCompleteForOrder(user, order, state = null) {
  if (orderRequiresPilotInfo(order, state)) return pilotProfileComplete(user);
  return userProfileComplete(user);
}

function nameFromEmail(email) {
  const local = String(email || "").split("@")[0] || "Asistente";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Asistente";
}

function secureToken(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString("hex")}`;
}

function safeEqualString(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function ensureEnrollmentToken(order) {
  if (!order.enrollmentToken || order.enrollmentTokenConsumedAt) {
    order.enrollmentToken = secureToken("enroll");
    order.enrollmentTokenCreatedAt = new Date().toISOString();
    order.enrollmentTokenConsumedAt = null;
    order.enrollmentTokenStatus = "active";
  }
  return order.enrollmentToken;
}

function enrollmentTokenIsActive(order) {
  return Boolean(
    order?.enrollmentToken &&
      !order.enrollmentTokenConsumedAt &&
      order.status === "paid" &&
      order.profileRequired
  );
}

function findOrderByEnrollmentToken(state, token) {
  const normalized = String(token || "").trim();
  if (!normalized) return null;
  return (
    state.orders.find(
      (order) => enrollmentTokenIsActive(order) && safeEqualString(order.enrollmentToken, normalized)
    ) || null
  );
}

function publicEnrollmentOrder({ state, order, req, includeLinks = true }) {
  const user = order ? state.users.find((candidate) => candidate.id === order.userId) : null;
  const requiresPilotInfo = orderRequiresPilotInfo(order, state);
  const tickets = order
    ? state.tickets.filter((ticket) => ticket.orderId === order.id).map((ticket) => publicTicket(ticket, req))
    : [];

  return {
    order: publicOrder(order ? { ...order, requiresPilotInfo } : order),
    user: publicUser(user),
    tickets,
    requiresPilotInfo,
    invoice: order ? state.invoices.find((invoice) => invoice.orderId === order.id) || null : null,
    ...(includeLinks ? enrollmentLinks(order, req) : {})
  };
}

function checkoutIdentityFromBody(body = {}, fallbackUser = null, options = {}) {
  const email = normalizeEmail(body.email || fallbackUser?.email || "");
  const rutInput = String(body.rut || fallbackUser?.rut || "").trim();
  const phone = String(body.phone || fallbackUser?.phone || "").trim();

  if (!validEmail(email)) {
    const error = new Error("El correo no tiene un formato valido");
    error.status = 400;
    throw error;
  }

  if (rutInput && !validateRut(rutInput)) {
    const error = new Error("El RUT no es valido");
    error.status = 400;
    throw error;
  }

  if (!rutInput && !options.rutOptional) {
    const error = new Error("El RUT es obligatorio");
    error.status = 400;
    throw error;
  }

  if (normalizePhone(phone).length < 8) {
    const error = new Error("Ingresa un telefono valido para recuperar tu cuenta si el correo falla");
    error.status = 400;
    throw error;
  }

  if (!body.termsAccepted && !fallbackUser?.termsAcceptedAt) {
    const error = new Error("Debes aceptar los terminos de uso de datos personales para continuar");
    error.status = 400;
    throw error;
  }

  return {
    email,
    rut: rutInput ? formatRut(rutInput) : "",
    normalizedRut: cleanRut(rutInput),
    phone,
    emailSuggestion: emailSuggestion(email)
  };
}

function rememberPreviousEmail(user, email) {
  if (!user.email || user.email === email) return;
  user.emailAliases = Array.from(new Set([...(user.emailAliases || []), user.email].filter(Boolean)));
}

function upsertCheckoutUser(state, identity, body = {}, sessionUser = null) {
  const now = new Date().toISOString();
  const rutOwner = findUserByRut(state, identity.rut);
  const emailOwner = findUserByEmail(state, identity.email);
  const contactOwner = findUserByRutContact(state, identity.rut, identity.phone);
  const existing = sessionUser || rutOwner || emailOwner || contactOwner;

  if (existing) {
    if (emailOwner && emailOwner.id !== existing.id) {
      const error = new Error("Ese correo ya esta asociado a otra cuenta. Ingresa con tu RUT y telefono o revisa el correo.");
      error.status = 409;
      throw error;
    }
    if (
      !sessionUser &&
      emailOwner &&
      identity.normalizedRut &&
      cleanRut(emailOwner.rut) &&
      cleanRut(emailOwner.rut) !== identity.normalizedRut
    ) {
      const error = new Error("Ese correo existe con otro RUT. Usa el RUT correcto o recupera con telefono.");
      error.status = 409;
      throw error;
    }
    rememberPreviousEmail(existing, identity.email);
    existing.email = identity.email;
    if (identity.rut) existing.rut = identity.rut;
    existing.phone = identity.phone;
    existing.emailVerified = true;
    existing.emailVerificationMode = existing.emailVerificationMode || "checkout_inline";
    existing.termsAcceptedAt = existing.termsAcceptedAt || now;
    existing.termsAcceptedVersion = existing.termsAcceptedVersion || DATA_TERMS_VERSION;
    existing.termsAcceptedSource = existing.termsAcceptedSource || "checkout";
    existing.profileStatus = userProfileComplete(existing) ? "complete" : "pending";
    existing.updatedAt = now;
    return existing;
  }

  const user = {
    id: id("user"),
    name: String(body.name || "").trim() || nameFromEmail(identity.email),
    namePending: !String(body.name || "").trim(),
    email: identity.email,
    emailAliases: [],
    rut: identity.rut,
    phone: identity.phone,
    club: "",
    vehicle: "",
    licensePlate: "",
    interests: [],
    emailVerified: true,
    emailVerificationMode: "checkout_inline",
    profileStatus: "pending",
    source: "checkout_fast",
    termsAcceptedAt: now,
    termsAcceptedVersion: DATA_TERMS_VERSION,
    termsAcceptedSource: "checkout",
    createdAt: now,
    updatedAt: now
  };

  state.users.push(user);
  state.audit.push({
    id: id("audit"),
    type: "checkout_user_created",
    userId: user.id,
    email: identity.email,
    rut: identity.rut,
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

    const entryType = normalizeTicketEntryType(ticketType.entryType);
    if (entryType === "guest") {
      const error = new Error("Las entradas de invitado se emiten desde el backoffice");
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
      entryType,
      entryTypeLabel: TICKET_ENTRY_TYPE_LABELS[entryType],
      description: ticketType.description,
      salePhaseId: phase.id,
      salePhaseName: phase.name,
      salePhaseKind: phase.kind,
      quantity,
      netPrice: phase.netPrice,
      pricing: phase.pricing,
      unitPrice: phase.price,
      total: phase.price * quantity
    };
  });
}

function getOrderItems(order, state = null) {
  if (order.items?.length) {
    return order.items.map((item) => {
      const ticketType = state && item.ticketTypeId ? findTicketType(state, item.ticketTypeId) : null;
      const entryType = normalizeTicketEntryType(item.entryType || item.ticketEntryType || ticketType?.entryType);
      return {
        ...item,
        entryType,
        entryTypeLabel: TICKET_ENTRY_TYPE_LABELS[entryType]
      };
    });
  }

  const event = state ? findEvent(state, order.eventId) : findDefaultEvent(order.eventId);
  const ticketType = state ? findTicketType(state, order.ticketTypeId) : findDefaultTicketType(order.ticketTypeId);
  if (!event || !ticketType) return [];
  const entryType = normalizeTicketEntryType(order.entryType || ticketType.entryType);

  return [
    {
      id: id("line"),
      eventId: event.id,
      eventName: event.name,
      ticketTypeId: ticketType.id,
      ticketTypeName: ticketType.name,
      entryType,
      entryTypeLabel: TICKET_ENTRY_TYPE_LABELS[entryType],
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
    const entryType = normalizeTicketEntryType(item.entryType);
    const isPilot = entryType === "pilot";
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
        entryType,
        entryTypeLabel: TICKET_ENTRY_TYPE_LABELS[entryType],
        salePhaseId: item.salePhaseId,
        salePhaseName: item.salePhaseName,
        salePhaseKind: item.salePhaseKind,
        code: `HFC-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}-${index + 1}`,
        holderName: user.name,
        holderRut: user.rut,
        holderLicensePlate: isPilot ? normalizeLicensePlate(user.licensePlate || user.patent || user.plate) : "",
        holderVehicle: isPilot ? String(user.vehicle || "").trim() : "",
        holderClub: isPilot ? String(user.club || "").trim() : "",
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

function checkoutReturnStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z_ -]/g, "")
    .replace(/\s+/g, "_");
}

function checkoutReturnIsFailed(status) {
  return [
    "failure",
    "failed",
    "rejected",
    "cancelled",
    "canceled",
    "cancelled_by_user",
    "canceled_by_user",
    "refunded",
    "charged_back"
  ].includes(checkoutReturnStatus(status));
}

function checkoutReturnIsPending(status) {
  return ["success", "approved", "pending", "in_process", "authorized", "null"].includes(checkoutReturnStatus(status));
}

function retryCheckoutUrl(order, req = null) {
  return order?.checkoutUrl || `${configuredBaseUrl(req).replace(/\/$/, "")}/carrito`;
}

function supportWhatsappUrl(order = null) {
  const eventName = orderEventName(order);
  const message = order?.id
    ? `Hola, necesito ayuda con mi compra ${eventName}. Orden ${order.id}.`
    : `Hola, necesito ayuda con mi compra ${eventName}.`;
  return `https://wa.me/56972934950?text=${encodeURIComponent(message)}`;
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

function paymentRutFromFormData(formData = {}) {
  const payer = formData.payer || {};
  const identification = payer.identification || {};
  const number = String(identification.number || formData.identificationNumber || "").trim();
  return validateRut(number) ? formatRut(number) : "";
}

async function attachPaymentRutToOrderUser(orderId, formData = {}) {
  const paymentRut = paymentRutFromFormData(formData);
  if (!paymentRut) return null;

  await updateState((state) => {
    const order = state.orders.find((candidate) => candidate.id === orderId);
    const user = order ? state.users.find((candidate) => candidate.id === order.userId) : null;
    if (!order || !user) return;

    order.paymentRut = paymentRut;
    if (!user.rut) {
      user.rut = paymentRut;
      user.updatedAt = new Date().toISOString();
      return;
    }

    if (cleanRut(user.rut) !== cleanRut(paymentRut)) {
      order.paymentRutMismatch = true;
      order.accountRut = user.rut;
    }
  });

  return paymentRut;
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
  const requiresPilotInfo = orderItemsRequirePilotInfo(items, state);
  const profileReady = userProfileCompleteForItems(user, items, state);

  if (!profileReady) {
    ensureEnrollmentToken(order);
    order.status = "paid";
    order.payment = orderPaymentSummary(paymentRecord, {
      paidAt: new Date().toISOString()
    });
    order.profileRequired = true;
    order.requiresPilotInfo = requiresPilotInfo;
    order.fulfillmentStatus = "profile_pending";
    order.invoiceStatus = "profile_pending";
    order.enrollmentEmailStatus = order.enrollmentEmailSentAt ? "sent" : "pending";
    order.updatedAt = new Date().toISOString();
    await writeState(state);
    const emailResult = order.enrollmentEmailSentAt
      ? { ok: true, skipped: true, ...enrollmentLinks(order, configuredBaseUrl()) }
      : await sendEnrollmentInvitationEmail({ orderId: order.id });
    state = await readState();
    const freshOrder = state.orders.find((candidate) => candidate.id === order.id) || order;
    return {
      order: freshOrder,
      user,
      event,
      ticketType,
      tickets: [],
      invoice: null,
      profileRequired: true,
      enrollmentEmail: emailResult,
      ...enrollmentLinks(freshOrder, configuredBaseUrl())
    };
  }

  if (order.status !== "paid") {
    order.status = "paid";
    order.payment = orderPaymentSummary(paymentRecord, {
      paidAt: new Date().toISOString()
    });
    order.profileRequired = false;
    order.requiresPilotInfo = requiresPilotInfo;
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
    order.requiresPilotInfo = requiresPilotInfo;
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

async function resendOrderEmail(orderId, { emailTo = "" } = {}) {
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

  const recipientEmail = normalizeEmail(emailTo);
  if (recipientEmail && !validEmail(recipientEmail)) {
    const error = new Error("El correo tecnico para prueba no tiene un formato valido");
    error.status = 400;
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
    baseUrl: process.env.PUBLIC_BASE_URL ? process.env.PUBLIC_BASE_URL.replace(/\/$/, "") : "",
    to: recipientEmail || undefined
  });

  await updateState((nextState) => {
    nextState.emailLogs.push({
      id: id("email"),
      type: "resend_order",
      orderId: order.id,
      userId: user.id,
      to: recipientEmail || user.email,
      originalTo: recipientEmail ? user.email : undefined,
      createdAt: new Date().toISOString()
    });
  });

  return { order, user, tickets, invoice };
}

async function reissueOrderDte({
  orderId,
  req = null,
  resendEmail = true,
  force = false,
  emailTo = "",
  issueMissingDte = false
}) {
  if (!openFacturaConfigured()) {
    const error = new Error("OpenFactura no esta configurado; no se emitira otro DTE demo");
    error.status = 503;
    throw error;
  }

  let state = await readState();
  let order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order) {
    const error = new Error("Orden no encontrada");
    error.status = 404;
    throw error;
  }

  if (order.status !== "paid") {
    const error = new Error("Solo se puede emitir DTE para ordenes pagadas");
    error.status = 409;
    throw error;
  }

  const user = state.users.find((candidate) => candidate.id === order.userId);
  const items = getOrderItems(order, state);
  const firstItem = items[0];
  const event = firstItem ? findEvent(state, firstItem.eventId) : null;
  const ticketType = firstItem ? findTicketType(state, firstItem.ticketTypeId) : null;
  const tickets = state.tickets.filter((ticket) => ticket.orderId === order.id);
  const currentInvoice = state.invoices.find((candidate) => candidate.orderId === order.id) || null;

  if (!user || !items.length || !event || !ticketType) {
    const error = new Error("La orden no tiene datos suficientes para emitir DTE");
    error.status = 409;
    throw error;
  }

  if (!tickets.length) {
    const error = new Error("La orden aun no tiene tickets emitidos; completa el enrolamiento antes de emitir DTE");
    error.status = 409;
    throw error;
  }

  const recipientEmail = normalizeEmail(emailTo);
  if (recipientEmail && !validEmail(recipientEmail)) {
    const error = new Error("El correo tecnico para prueba no tiene un formato valido");
    error.status = 400;
    throw error;
  }

  const sendDteEmail = async ({ invoice: invoiceForEmail, tickets: ticketsForEmail, type }) => {
    const emailState = await readState();
    const template = findTemplate(emailState.emailTemplates, "payment");
    try {
      const emailResult = await sendTicketEmail({
        user,
        order,
        event,
        ticketType,
        tickets: ticketsForEmail,
        invoice: invoiceForEmail,
        template,
        baseUrl: configuredBaseUrl(req),
        to: recipientEmail || undefined
      });
      await updateState((nextState) => {
        const freshOrder = nextState.orders.find((candidate) => candidate.id === order.id);
        if (freshOrder && !recipientEmail) {
          freshOrder.ticketEmailSentAt = new Date().toISOString();
          freshOrder.updatedAt = freshOrder.ticketEmailSentAt;
        }
        logEmailResult(nextState, {
          type,
          templateId: template?.id || "payment",
          to: recipientEmail || user.email,
          originalTo: recipientEmail ? user.email : undefined,
          userId: user.id,
          orderId: order.id,
          status: "sent",
          mode: emailResult.mode,
          subject: `Tus entradas para ${orderEventName(order, event)}`
        });
      });
      return emailResult;
    } catch (error) {
      await updateState((nextState) => {
        logEmailResult(nextState, {
          type,
          templateId: template?.id || "payment",
          to: recipientEmail || user.email,
          originalTo: recipientEmail ? user.email : undefined,
          userId: user.id,
          orderId: order.id,
          status: "failed",
          error: error.message
        });
      });
      return { ok: false, message: error.message };
    }
  };

  if (currentInvoice && !invoiceLooksDemo(currentInvoice)) {
    const emailResult = resendEmail
      ? await sendDteEmail({ invoice: currentInvoice, tickets, type: "dte_existing_resent" })
      : null;
    return {
      skipped: true,
      reason: "already_real_invoice",
      order,
      user,
      tickets,
      invoice: currentInvoice,
      email: emailResult
    };
  }

  if (!issueMissingDte) {
    return {
      skipped: true,
      reason: currentInvoice ? "demo_invoice_requires_manual_confirmation" : "missing_invoice_requires_manual_confirmation",
      order,
      user,
      tickets,
      invoice: currentInvoice,
      email: null
    };
  }

  const invoice = await issueBoleta({ order, user, event, ticketType, tickets, items });
  if (invoiceLooksDemo(invoice)) {
    const error = new Error("OpenFactura respondio en modo demo; revisa las credenciales antes de reemitir");
    error.status = 503;
    throw error;
  }

  await updateState((nextState) => {
    const freshOrder = nextState.orders.find((candidate) => candidate.id === order.id);
    if (freshOrder) {
      freshOrder.invoiceStatus = "issued";
      freshOrder.invoiceError = null;
      freshOrder.updatedAt = new Date().toISOString();
    }

    const invoiceIndex = nextState.invoices.findIndex((candidate) => candidate.orderId === order.id);
    const replacedInvoice = currentInvoice
      ? {
          id: currentInvoice.id,
          providerId: currentInvoice.providerId,
          folio: currentInvoice.folio,
          mode: currentInvoice.mode,
          createdAt: currentInvoice.createdAt
        }
      : null;
    if (invoiceIndex >= 0) {
      nextState.invoices[invoiceIndex] = {
        ...invoice,
        replacedInvoice,
        updatedAt: new Date().toISOString()
      };
    } else {
      nextState.invoices.push(invoice);
    }

    nextState.audit.push({
      id: id("audit"),
      type: "dte_reissued",
      orderId: order.id,
      invoiceId: invoice.id,
      previousInvoiceId: currentInvoice?.id || null,
      createdAt: new Date().toISOString()
    });
  });

  state = await readState();
  order = state.orders.find((candidate) => candidate.id === orderId) || order;
  const savedInvoice = state.invoices.find((candidate) => candidate.orderId === order.id) || invoice;
  const savedTickets = state.tickets.filter((ticket) => ticket.orderId === order.id);
  let emailResult = null;

  if (resendEmail) {
    emailResult = await sendDteEmail({ invoice: savedInvoice, tickets: savedTickets, type: "dte_reissued" });
  }

  return {
    skipped: false,
    order,
    user,
    tickets: savedTickets,
    invoice: savedInvoice,
    email: emailResult
  };
}

function orderEventName(order, event) {
  if (order?.items?.length === 1) return order.items[0].eventName || event?.name || "Honda Fest Chile";
  const eventNames = Array.from(
    new Set((order?.items || []).map((item) => String(item.eventName || "").trim()).filter(Boolean))
  );
  if (eventNames.length === 1) return eventNames[0];
  if (eventNames.length > 1) return eventNames.join(" y ");
  return event?.name || "Honda Fest Chile";
}

function htmlEscape(value) {
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

function formatCurrencyLabel(value) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function orderItemsTemplateRows(items = []) {
  const normalizedItems = items.length ? items : [];
  const text = normalizedItems
    .map((item) => `- ${item.ticketTypeName || item.description || "Producto"} x ${item.quantity || 1}: ${formatCurrencyLabel(item.total || 0)}`)
    .join("\n");
  const html = normalizedItems
    .map(
      (item) =>
        `<tr><td style="padding:12px;border-bottom:1px solid #eeeeee;color:#333;">${htmlEscape(item.ticketTypeName || item.description || "Producto")}<br><span style="font-size:13px;color:#777;">${htmlEscape(item.eventName || "")}</span></td><td style="padding:12px;border-bottom:1px solid #eeeeee;color:#333;">${htmlEscape(item.quantity || 1)}</td><td style="padding:12px;border-bottom:1px solid #eeeeee;color:#333;">${htmlEscape(formatCurrencyLabel(item.total || 0))}</td></tr>`
    )
    .join("");
  return {
    text,
    html
  };
}

function replaceLegacyEnrollmentPlaceholders(value = "") {
  return String(value)
    .replace(/\[Nombre del Cliente\]/g, "{{name}}")
    .replace(/\[Tabla\]/g, "{{order_items_html}}")
    .replace(/https:\/\/www\.hondafestchile\.cl\/mipedido\?token=\[token\]/g, "{{enroll_url}}")
    .replace(/\[token\]/g, "{{enroll_url}}");
}

function enrollmentTemplateForEmail(template) {
  const normalized = normalizeTemplate(template || { id: "enrollment_invitation" });
  const sourceHtml = replaceLegacyEnrollmentPlaceholders(normalized.html);
  const hasOrderTable = /order_items_html|<th[^>]*>\s*Producto\s*<\/th>|Producto<\/th>/i.test(sourceHtml);
  const base = hasOrderTable ? normalized : normalizeTemplate({ id: "enrollment_invitation" });

  return {
    ...base,
    subject: replaceLegacyEnrollmentPlaceholders(base.subject),
    text: replaceLegacyEnrollmentPlaceholders(base.text),
    html: replaceLegacyEnrollmentPlaceholders(base.html)
  };
}

async function sendEnrollmentInvitationEmail({ orderId, req = null, force = false }) {
  let state = await readState();
  let order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order) {
    const error = new Error("Orden no encontrada");
    error.status = 404;
    throw error;
  }

  const user = state.users.find((candidate) => candidate.id === order.userId);
  const items = getOrderItems(order, state);
  const firstItem = items[0];
  const event = firstItem ? findEvent(state, firstItem.eventId) : null;

  if (!user) {
    const error = new Error("Usuario no encontrado para enviar enrolamiento");
    error.status = 409;
    throw error;
  }

  ensureEnrollmentToken(order);
  if (!force && order.enrollmentEmailSentAt) {
    return { ok: true, skipped: true, ...enrollmentLinks(order, configuredBaseUrl(req)) };
  }

  await writeState(state);
  state = await readState();
  order = state.orders.find((candidate) => candidate.id === orderId) || order;

  const base = configuredBaseUrl(req);
  const links = enrollmentLinks(order, base);
  const itemRows = orderItemsTemplateRows(items);
  const variables = {
    name: user.name || nameFromEmail(user.email),
    email: user.email,
    event_name: orderEventName(order, event),
    order_id: order.id,
    order_total: order.total,
    order_total_label: formatCurrencyLabel(order.total || 0),
    order_items_text: itemRows.text,
    order_items_html: itemRows.html,
    enroll_url: links.enrollmentUrl,
    enrollment_url: links.enrollmentUrl,
    cta_url: links.enrollmentUrl,
    button_url: links.enrollmentUrl,
    enroll_qr_url: links.enrollmentQrUrl,
    enrollment_qr_url: links.enrollmentQrUrl,
    qr_url: links.enrollmentQrUrl
  };
  const template = enrollmentTemplateForEmail(findTemplate(state.emailTemplates, "enrollment_invitation"));
  const rendered = renderTemplate(template, variables);
  if (!rendered.text.includes(links.enrollmentUrl)) {
    rendered.text = `${rendered.text}\nAbrir formulario: ${links.enrollmentUrl}`.trim();
  }
  if (!rendered.text.includes(links.enrollmentQrUrl)) {
    rendered.text = `${rendered.text}\nQR: ${links.enrollmentQrUrl}`.trim();
  }
  if (!rendered.html.includes(links.enrollmentUrl) || !rendered.html.includes(links.enrollmentQrUrl)) {
    rendered.html = `${rendered.html}
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#121212;margin-top:18px">
        <p><a href="${links.enrollmentUrl}" style="display:inline-block;background:#d71920;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">Completar datos</a></p>
        <p><img src="${links.enrollmentQrUrl}" alt="QR para completar datos" width="180" /></p>
      </div>`;
  }

  try {
    const result = await sendMail({
      to: user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html
    });

    await updateState((nextState) => {
      const freshOrder = nextState.orders.find((candidate) => candidate.id === order.id);
      if (freshOrder) {
        freshOrder.enrollmentEmailSentAt = new Date().toISOString();
        freshOrder.enrollmentEmailStatus = "sent";
        freshOrder.enrollmentEmailError = null;
        freshOrder.updatedAt = freshOrder.enrollmentEmailSentAt;
      }
      logEmailResult(nextState, {
        type: "enrollment_invitation",
        templateId: template.id,
        to: user.email,
        userId: user.id,
        orderId: order.id,
        status: "sent",
        mode: result.mode,
        subject: rendered.subject
      });
    });

    return { ok: true, mode: result.mode, ...links };
  } catch (error) {
    await updateState((nextState) => {
      const freshOrder = nextState.orders.find((candidate) => candidate.id === order.id);
      if (freshOrder) {
        freshOrder.enrollmentEmailStatus = "failed";
        freshOrder.enrollmentEmailError = error.message;
        freshOrder.updatedAt = new Date().toISOString();
      }
      logEmailResult(nextState, {
        type: "enrollment_invitation",
        templateId: template.id,
        to: user.email,
        userId: user.id,
        orderId: order.id,
        status: "failed",
        error: error.message,
        subject: rendered.subject
      });
    });

    return { ok: false, message: error.message, ...links };
  }
}

async function sendPaymentRetryEmail({ orderId, req = null, reason = "", force = false }) {
  let state = await readState();
  let order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order) {
    const error = new Error("Orden no encontrada");
    error.status = 404;
    throw error;
  }

  const user = state.users.find((candidate) => candidate.id === order.userId);
  const items = getOrderItems(order, state);
  const firstItem = items[0];
  const event = firstItem ? findEvent(state, firstItem.eventId) : null;

  if (!user) {
    const error = new Error("Usuario no encontrado para enviar recuperacion de pago");
    error.status = 409;
    throw error;
  }

  if (!force && order.paymentRetryEmailSentAt) {
    return {
      ok: true,
      skipped: true,
      retryUrl: retryCheckoutUrl(order, req),
      whatsappUrl: supportWhatsappUrl(order)
    };
  }

  const retryUrl = retryCheckoutUrl(order, req);
  const whatsappUrl = supportWhatsappUrl(order);
  const itemRows = orderItemsTemplateRows(items);
  const template = findTemplate(state.emailTemplates, "payment_failed_retry");
  const rendered = renderTemplate(template, {
    name: user.name || nameFromEmail(user.email),
    email: user.email,
    event_name: orderEventName(order, event),
    order_id: order.id,
    order_total: order.total,
    order_total_label: formatCurrencyLabel(order.total || 0),
    order_items_text: itemRows.text,
    order_items_html: itemRows.html,
    retry_url: retryUrl,
    checkout_url: retryUrl,
    whatsapp_url: whatsappUrl,
    payment_status: reason
  });

  if (!rendered.text.includes(retryUrl)) {
    rendered.text = `${rendered.text}\nIntentar nuevamente: ${retryUrl}`.trim();
  }
  if (!rendered.text.includes(whatsappUrl)) {
    rendered.text = `${rendered.text}\nWhatsApp: ${whatsappUrl}`.trim();
  }
  if (!rendered.html.includes(retryUrl) || !rendered.html.includes(whatsappUrl)) {
    rendered.html = `${rendered.html}
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#121212;margin-top:18px">
        <p><a href="${htmlEscape(retryUrl)}" style="display:inline-block;background:#d71920;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">Intentar nuevamente</a></p>
        <p><a href="${htmlEscape(whatsappUrl)}" style="color:#1b5e20;font-weight:bold;text-decoration:none">Necesito ayuda por WhatsApp</a></p>
      </div>`;
  }

  try {
    const result = await sendMail({
      to: user.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html
    });

    await updateState((nextState) => {
      const freshOrder = nextState.orders.find((candidate) => candidate.id === order.id);
      if (freshOrder) {
        freshOrder.paymentRetryEmailSentAt = new Date().toISOString();
        freshOrder.paymentRetryEmailStatus = "sent";
        freshOrder.paymentRetryEmailError = null;
        freshOrder.updatedAt = freshOrder.paymentRetryEmailSentAt;
      }
      logEmailResult(nextState, {
        type: "payment_failed_retry",
        templateId: template?.id || "payment_failed_retry",
        to: user.email,
        userId: user.id,
        orderId: order.id,
        status: "sent",
        mode: result.mode,
        subject: rendered.subject
      });
    });

    return { ok: true, mode: result.mode, retryUrl, whatsappUrl };
  } catch (error) {
    await updateState((nextState) => {
      const freshOrder = nextState.orders.find((candidate) => candidate.id === order.id);
      if (freshOrder) {
        freshOrder.paymentRetryEmailStatus = "failed";
        freshOrder.paymentRetryEmailError = error.message;
        freshOrder.updatedAt = new Date().toISOString();
      }
      logEmailResult(nextState, {
        type: "payment_failed_retry",
        templateId: template?.id || "payment_failed_retry",
        to: user.email,
        userId: user.id,
        orderId: order.id,
        status: "failed",
        error: error.message,
        subject: rendered.subject
      });
    });

    return { ok: false, message: error.message, retryUrl, whatsappUrl };
  }
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
      openFactura: openFacturaConfigured(),
      openFacturaDetails: openFacturaRuntimeStatus()
    }
  });
});

app.get("/api/catalog", async (req, res, next) => {
  try {
    const state = await readState();
    const mercadoPagoDetails = mercadoPagoRuntimeStatus(req);
    const testMode = Boolean(mercadoPagoDetails.sandbox);
    res.json({
      ...catalogForClient(state),
      integrations: {
        paymentMode: paymentModeForClient(),
        mercadoPagoPublicKey: mercadoPagoInternalCheckoutEnabled() ? mercadoPagoPublicKey() : null,
        checkoutStorageReady: checkoutStorageReady(),
        testMode,
        testModeMessage: testMode
          ? "Sitio en modo prueba: no estas comprando entradas reales. Usa solo tarjetas de prueba."
          : ""
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

app.get("/media-source/*", async (req, res, next) => {
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

    const localRoot = path.resolve(process.cwd(), "HFC_R2_upload_ready");
    const localFile = path.resolve(localRoot, ...key.split("/"));
    if (localFile.startsWith(localRoot) && fs.existsSync(localFile)) {
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.sendFile(localFile);
      return;
    }

    if (await proxyPublicAssetObject(res, key)) return;

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

    if (!req.body.termsAccepted) {
      const error = new Error("Debes aceptar los terminos de uso de datos personales para crear tu cuenta");
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
        namePending: false,
        email,
        rut: formattedRut,
        phone,
        club: String(req.body.club || "").trim(),
        vehicle: String(req.body.vehicle || "").trim(),
        licensePlate: normalizeLicensePlate(req.body.licensePlate),
        interests: Array.isArray(req.body.interests) ? req.body.interests : [],
        passwordHash: hashPassword(password),
        emailVerified: false,
        profileStatus: "complete",
        verificationToken,
        verificationSentAt: now,
        termsAcceptedAt: now,
        termsAcceptedVersion: DATA_TERMS_VERSION,
        termsAcceptedSource: "register",
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
  const requiresPilotInfo = orderItemsRequirePilotInfo(items, state);

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
    profileRequired: !userProfileCompleteForItems(user, items, state),
    requiresPilotInfo,
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
    const eventId = requireString(req.body, "eventId", "Evento");
    const ticketTypeId = requireString(req.body, "ticketTypeId", "Entrada");
    const quantity = Number(req.body.quantity || 1);

    await requireCheckoutStorage();

    const initialState = await readState();
    const sessionUser = accountUserFromRequest(req, initialState);
    const identity = checkoutIdentityFromBody(req.body, sessionUser, {
      rutOptional: mercadoPagoInternalCheckoutEnabled()
    });

    const user = await updateState((state) => {
      const freshSessionUser = sessionUser ? state.users.find((candidate) => candidate.id === sessionUser.id) || null : null;
      return upsertCheckoutUser(state, identity, req.body, freshSessionUser);
    });

    const state = await readState();
    const items = buildOrderItems(state, [{ eventId, ticketTypeId, quantity }]);
    const freshUser = state.users.find((candidate) => candidate.id === user.id);
    const { order, preference } = await createOrderFromItems({ req, user: freshUser, items, state });
    const accountSession = createAccountSessionRecord(freshUser);
    await updateState((nextState) => {
      nextState.sessions.push(accountSession);
    });

    res.status(201).json({
      ok: true,
      order: publicOrder(order),
      user: publicUser(freshUser),
      accountToken: accountSession.token,
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
    await requireCheckoutStorage();

    const initialState = await readState();
    const sessionUser = accountUserFromRequest(req, initialState);
    const identity = checkoutIdentityFromBody(req.body, sessionUser, {
      rutOptional: mercadoPagoInternalCheckoutEnabled()
    });

    const user = await updateState((state) => {
      const freshSessionUser = sessionUser ? state.users.find((candidate) => candidate.id === sessionUser.id) || null : null;
      return upsertCheckoutUser(state, identity, req.body, freshSessionUser);
    });

    const state = await readState();
    const items = buildOrderItems(state, req.body.items);
    const freshUser = state.users.find((candidate) => candidate.id === user.id);
    const { order, preference } = await createOrderFromItems({ req, user: freshUser, items, state });
    const accountSession = createAccountSessionRecord(freshUser);
    await updateState((nextState) => {
      nextState.sessions.push(accountSession);
    });

    res.status(201).json({
      ok: true,
      order: publicOrder(order),
      user: publicUser(freshUser),
      accountToken: accountSession.token,
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

app.post("/api/orders/:orderId/checkout-return", async (req, res, next) => {
  try {
    await requireCheckoutStorage();

    const rawStatus =
      req.body.payment ||
      req.body.status ||
      req.body.collectionStatus ||
      req.body.collection_status ||
      req.query.payment ||
      req.query.status ||
      req.query.collection_status ||
      "";
    const normalizedStatus = checkoutReturnStatus(rawStatus);
    let state = await readState();
    let order = state.orders.find((candidate) => candidate.id === req.params.orderId);

    if (!order) {
      res.status(404).json({ ok: false, message: "Orden no encontrada" });
      return;
    }

    if (order.status !== "paid" && checkoutReturnIsFailed(normalizedStatus)) {
      await updateOrderPaymentStatus(order.id, {
        provider: "mercadopago",
        paymentId: `checkout_return_${order.id}`,
        status: normalizedStatus === "failure" || normalizedStatus === "failed" ? "cancelled" : normalizedStatus,
        statusDetail: "checkout_return_without_payment_id",
        preferenceId: order.preferenceId,
        externalReference: order.id,
        transactionAmount: order.total
      });
      await sendPaymentRetryEmail({ orderId: order.id, req, reason: normalizedStatus });
    } else if (
      order.status === "created" &&
      checkoutReturnIsPending(normalizedStatus) &&
      normalizedStatus !== "approved"
    ) {
      await updateOrderPaymentStatus(order.id, {
        provider: "mercadopago",
        paymentId: `checkout_return_${order.id}`,
        status: "pending",
        statusDetail: "checkout_return_waiting_confirmation",
        preferenceId: order.preferenceId,
        externalReference: order.id,
        transactionAmount: order.total
      });
    }

    state = await readState();
    order = state.orders.find((candidate) => candidate.id === req.params.orderId) || order;
    const user = order ? state.users.find((candidate) => candidate.id === order.userId) : null;
    const tickets = state.tickets
      .filter((ticket) => ticket.orderId === req.params.orderId)
      .map((ticket) => publicTicket(ticket, req));
    const invoice = state.invoices.find((candidate) => candidate.orderId === req.params.orderId) || null;

    res.json({
      ok: true,
      order: publicOrder(order),
      user: publicUser(user),
      tickets,
      invoice,
      retryUrl: retryCheckoutUrl(order, req),
      whatsappUrl: supportWhatsappUrl(order),
      paymentReturnStatus: normalizedStatus,
      ...(order?.status === "paid" && order?.profileRequired ? enrollmentLinks(order, req) : {})
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/orders/:orderId/sync-payment", async (req, res, next) => {
  try {
    await requireCheckoutStorage();
    const paymentId =
      String(req.body.paymentId || req.body.payment_id || req.body.collection_id || req.query.payment_id || "").trim();
    if (!paymentId || paymentId === "null") {
      const error = new Error("Mercado Pago no entrego identificador de pago");
      error.status = 400;
      throw error;
    }

    const payment = await getPayment(paymentId);
    if (String(payment.external_reference || "") !== String(req.params.orderId)) {
      const error = new Error("El pago no corresponde a esta orden");
      error.status = 409;
      throw error;
    }

    const paymentData = paymentDataFromMercadoPago(payment);
    const result =
      payment.status === "approved"
        ? await completeOrderPayment(req.params.orderId, { ...paymentData, status: "approved" })
        : await updateOrderPaymentStatus(req.params.orderId, paymentData);
    if (payment.status !== "approved" && result.order?.status === "payment_failed") {
      await sendPaymentRetryEmail({ orderId: req.params.orderId, req, reason: payment.status });
    }
    const state = await readState();
    const order = state.orders.find((candidate) => candidate.id === req.params.orderId) || result.order;
    const user = order ? state.users.find((candidate) => candidate.id === order.userId) : null;
    const tickets = state.tickets
      .filter((ticket) => ticket.orderId === req.params.orderId)
      .map((ticket) => publicTicket(ticket, req));
    const invoice = state.invoices.find((candidate) => candidate.orderId === req.params.orderId) || null;

    res.json({
      ok: true,
      order: publicOrder(order),
      user: publicUser(user),
      tickets,
      invoice,
      payment: {
        id: payment.id,
        status: payment.status,
        statusDetail: payment.status_detail
      },
      ...(order?.profileRequired ? enrollmentLinks(order, req) : {})
    });
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
      res.json({
        ok: true,
        order: publicOrder(order),
        user: publicUser(user),
        tickets,
        invoice,
        ...(order.profileRequired ? enrollmentLinks(order, req) : {})
      });
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
    await attachPaymentRutToOrderUser(order.id, formData);

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
        },
        ...(result.order.profileRequired ? enrollmentLinks(result.order, req) : {})
      });
      return;
    }

    const result = await updateOrderPaymentStatus(order.id, paymentData);
    if (result.order?.status === "payment_failed") {
      await sendPaymentRetryEmail({ orderId: order.id, req, reason: payment.status });
    }
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

function enrollmentPortalCredentials() {
  return {
    username: String(process.env.ENROLLMENT_PORTAL_USER || "admin").trim(),
    password: String(
      process.env.ENROLLMENT_PORTAL_PASSWORD ||
        process.env.BACKOFFICE_PASSWORD ||
        process.env.BACKOFFICE_TOKEN ||
        ""
    ).trim()
  };
}

function currentEnrollmentPortalSession(req, state) {
  return currentSessionFromRequest(req, state, "enrollment_portal");
}

function requireEnrollmentPortalSession(req, state) {
  const session = currentEnrollmentPortalSession(req, state);
  if (!session) {
    const error = new Error("Sesion privada requerida");
    error.status = 401;
    throw error;
  }
  return session;
}

function authorizeEnrollmentAccess(req, state, order) {
  const token = String(req.body.enrollmentToken || req.query.enrollmentToken || req.headers["x-enrollment-token"] || "").trim();
  if (token && enrollmentTokenIsActive(order) && safeEqualString(token, order.enrollmentToken)) {
    return { type: "token" };
  }

  const session = currentEnrollmentPortalSession(req, state);
  if (session) return { type: "portal", session };

  const error = new Error("Token de enrolamiento o sesion privada requerida");
  error.status = 401;
  throw error;
}

async function completeEnrollmentProfile(req, orderId) {
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

    if (order.status !== "paid") {
      const error = new Error("La orden aun no tiene pago confirmado");
      error.status = 409;
      throw error;
    }

    const access = authorizeEnrollmentAccess(req, state, order);
    const user = state.users.find((candidate) => candidate.id === order.userId);
    if (!user || user.email !== email) {
      const error = new Error("El correo no coincide con la orden");
      error.status = 403;
      throw error;
    }

    const items = getOrderItems(order, state);
    const requiresPilotInfo = orderItemsRequirePilotInfo(items, state);
    const licensePlate = requiresPilotInfo ? normalizeLicensePlate(requireString(req.body, "licensePlate", "Patente")) : "";
    const vehicle = requiresPilotInfo ? requireString(req.body, "vehicle", "Auto") : "";
    const club = requiresPilotInfo ? requireString(req.body, "club", "Club") : "";

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
    if (requiresPilotInfo) {
      user.licensePlate = licensePlate;
      user.vehicle = vehicle;
      user.club = club;
    }
    user.namePending = false;
    user.emailVerified = true;
    user.profileStatus = "complete";
    user.profileCompletedAt = user.profileCompletedAt || now;
    user.updatedAt = now;

    const itemById = new Map(items.map((item) => [item.id, item]));
    state.tickets
      .filter((ticket) => ticket.orderId === order.id)
      .forEach((ticket) => {
        const item = itemById.get(ticket.lineItemId) || items.find((candidate) => candidate.ticketTypeId === ticket.ticketTypeId);
        const entryType = normalizeTicketEntryType(ticket.entryType || item?.entryType);
        ticket.holderName = user.name;
        ticket.holderRut = user.rut;
        ticket.entryType = entryType;
        ticket.entryTypeLabel = TICKET_ENTRY_TYPE_LABELS[entryType];
        ticket.holderLicensePlate = entryType === "pilot" ? user.licensePlate : "";
        ticket.holderVehicle = entryType === "pilot" ? user.vehicle : "";
        ticket.holderClub = entryType === "pilot" ? user.club : "";
        ticket.updatedAt = now;
      });

    order.profileRequired = false;
    order.requiresPilotInfo = requiresPilotInfo;
    order.enrollmentCompletedAt = order.enrollmentCompletedAt || now;
    order.enrollmentCompletedBy = access.type;
    order.enrollmentTokenConsumedAt = now;
    order.enrollmentTokenStatus = "consumed";
    order.enrollmentToken = null;
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
      source: access.type,
      createdAt: now
    });
  });

  const state = await readState();
  const order = state.orders.find((candidate) => candidate.id === orderId);
  if (!order || order.status !== "paid") {
    return { order, profileCompleted: true };
  }

  const result = await completeOrderPayment(orderId, {
    provider: paymentForFulfillment?.provider || order.paymentMode || "mercadopago",
    paymentId: paymentForFulfillment?.paymentId || null,
    status: "approved",
    statusDetail: paymentForFulfillment?.statusDetail || null
  });

  return {
    ...result,
    profileCompleted: true
  };
}

app.post("/api/orders/:orderId/profile", async (req, res, next) => {
  try {
    const result = await completeEnrollmentProfile(req, req.params.orderId);
    res.json({
      ok: true,
      order: publicOrder(result.order),
      user: publicUser(result.user),
      tickets: (result.tickets || []).map((ticket) => publicTicket(ticket, req)),
      invoice: result.invoice,
      profileCompleted: true
    });
  } catch (error) {
    next(error);
  }
});

function accountOrdersForUser(state, user, req) {
  return state.orders
    .filter((order) => order.userId === user.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((order) => ({
      ...publicOrder(order),
      tickets: state.tickets
        .filter((ticket) => ticket.orderId === order.id)
        .map((ticket) => publicTicket(ticket, req)),
      invoice: state.invoices.find((invoice) => invoice.orderId === order.id) || null,
      ...(order.profileRequired ? enrollmentLinks(order, req) : {})
    }));
}

function createAccountSessionRecord(user) {
  const now = new Date();
  return {
    id: id("session"),
    token: secureToken("account"),
    type: "account",
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 90).toISOString()
  };
}

app.post("/api/account/access", async (req, res, next) => {
  try {
    const rutInput = requireString(req.body, "rut", "RUT");
    const contact = requireString(req.body, "contact", "Correo o telefono");

    if (!validateRut(rutInput)) {
      const error = new Error("El RUT no es valido");
      error.status = 400;
      throw error;
    }

    const state = await readState();
    const user = findUserByRutContact(state, rutInput, contact);
    if (!user) {
      const error = new Error("No encontramos una cuenta con ese RUT y correo/telefono");
      error.status = 404;
      throw error;
    }

    const session = createAccountSessionRecord(user);
    await updateState((nextState) => {
      nextState.sessions.push(session);
      nextState.audit.push({
        id: id("audit"),
        type: "account_session_started",
        userId: user.id,
        createdAt: session.createdAt
      });
    });

    res.json({
      ok: true,
      user: publicUser(user),
      token: session.token,
      expiresAt: session.expiresAt,
      orders: accountOrdersForUser(state, user, req)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/account/pit-lane", async (req, res, next) => {
  try {
    const state = await readState();
    const user = accountUserFromRequest(req, state);
    if (!user) {
      const error = new Error("Sesion requerida");
      error.status = 401;
      throw error;
    }

    res.json({
      ok: true,
      user: publicUser(user),
      orders: accountOrdersForUser(state, user, req)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/users/purchases", async (req, res, next) => {
  try {
    const email = normalizeEmail(requireString(req.query, "email", "Correo"));
    const rutInput = requireString(req.query, "rut", "RUT");
    const phone = String(req.query.phone || "").trim();

    if (!validateRut(rutInput)) {
      const error = new Error("El RUT no es valido");
      error.status = 400;
      throw error;
    }

    const state = await readState();
    const user = findUserByEmailRut(state, email, rutInput) || (phone ? findUserByRutContact(state, rutInput, phone) : null);
    if (!user) {
      const error = new Error("No encontramos compras para ese correo y RUT");
      error.status = 404;
      throw error;
    }

    res.json({ ok: true, user: publicUser(user), orders: accountOrdersForUser(state, user, req) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/enrollment/login", async (req, res, next) => {
  try {
    const username = String(req.body.username || req.body.user || "").trim();
    const password = requireString(req.body, "password", "Password");
    const expected = enrollmentPortalCredentials();

    if (!expected.password) {
      const error = new Error("Portal privado sin credenciales configuradas");
      error.status = 503;
      throw error;
    }

    if (username !== expected.username || !safeEqualString(password, expected.password)) {
      const error = new Error("Usuario o password incorrecto");
      error.status = 401;
      throw error;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 12).toISOString();
    const session = {
      id: id("enroll_session"),
      token: secureToken("portal"),
      type: "enrollment_portal",
      role: "enrollment_admin",
      createdAt: now.toISOString(),
      expiresAt
    };

    await updateState((state) => {
      if (!state.sessions) state.sessions = [];
      state.sessions = state.sessions.filter((item) => !item.expiresAt || Date.parse(item.expiresAt) > Date.now());
      state.sessions.push(session);
      state.audit.push({
        id: id("audit"),
        type: "enrollment_portal_login",
        createdAt: session.createdAt
      });
    });

    res.json({ ok: true, token: session.token, expiresAt, username: expected.username });
  } catch (error) {
    next(error);
  }
});

app.get("/api/enrollment/portal/orders", async (req, res, next) => {
  try {
    let state = await readState();
    requireEnrollmentPortalSession(req, state);
    let changed = false;

    const orders = state.orders
      .filter((order) => order.status === "paid" && order.profileRequired)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));

    for (const order of orders) {
      if (!order.enrollmentToken) {
        ensureEnrollmentToken(order);
        changed = true;
      }
    }

    if (changed) {
      await writeState(state);
      state = await readState();
    }

    res.json({
      ok: true,
      orders: state.orders
        .filter((order) => order.status === "paid" && order.profileRequired)
        .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)))
        .map((order) => publicEnrollmentOrder({ state, order, req }))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/enrollment/portal/orders/:orderId/send-link", async (req, res, next) => {
  try {
    const state = await readState();
    requireEnrollmentPortalSession(req, state);
    const order = state.orders.find((candidate) => candidate.id === req.params.orderId);
    if (!order || order.status !== "paid" || !order.profileRequired) {
      const error = new Error("Orden pendiente de enrolamiento no encontrada");
      error.status = 404;
      throw error;
    }

    const result = await sendEnrollmentInvitationEmail({ orderId: order.id, req, force: true });
    res.json({ ok: result.ok, message: result.message, ...result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/enrollment/:token/qr.svg", async (req, res, next) => {
  try {
    const state = await readState();
    const order = findOrderByEnrollmentToken(state, req.params.token);
    if (!order) {
      res.status(404).type("text/plain").send("Token de enrolamiento no encontrado");
      return;
    }

    const svg = await QRCode.toString(enrollmentUrlForToken(req, order.enrollmentToken), {
      type: "svg",
      margin: 1,
      width: 220
    });

    res.type("image/svg+xml").send(svg);
  } catch (error) {
    next(error);
  }
});

app.get("/api/enrollment/:token", async (req, res, next) => {
  try {
    const state = await readState();
    const order = findOrderByEnrollmentToken(state, req.params.token);
    if (!order) {
      const error = new Error("Token de enrolamiento invalido");
      error.status = 404;
      throw error;
    }

    res.json({ ok: true, ...publicEnrollmentOrder({ state, order, req }) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/enrollment/orders/:orderId/profile", async (req, res, next) => {
  try {
    const result = await completeEnrollmentProfile(req, req.params.orderId);
    res.json({
      ok: true,
      order: publicOrder(result.order),
      user: publicUser(result.user),
      tickets: (result.tickets || []).map((ticket) => publicTicket(ticket, req)),
      invoice: result.invoice,
      profileCompleted: true
    });
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
      invoice: result.invoice,
      ...(result.order.profileRequired ? enrollmentLinks(result.order, req) : {})
    });
  } catch (error) {
    next(error);
  }
});

function adminAuthorized(req) {
  const submitted = String(req.headers["x-admin-token"] || "");
  const configured = process.env.BACKOFFICE_PASSWORD || process.env.BACKOFFICE_TOKEN || "";
  return submitted === "123hfc" || Boolean(configured && submitted === configured);
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
          licensePlate: "",
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
          entryType: "guest",
          entryTypeLabel: TICKET_ENTRY_TYPE_LABELS.guest,
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
        profileRequired: false,
        requiresPilotInfo: false,
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

app.post("/api/backoffice/orders/reissue-demo-dtes", async (req, res, next) => {
  try {
    requireAdmin(req);
    const state = await readState();
    const candidates = state.orders
      .filter((order) => order.status === "paid")
      .filter((order) => {
        const invoice = state.invoices.find((candidate) => candidate.orderId === order.id);
        return invoiceLooksDemo(invoice);
      })
      .filter((order) => state.tickets.some((ticket) => ticket.orderId === order.id));

    const results = [];
    for (const order of candidates) {
      try {
        const result = await reissueOrderDte({
          orderId: order.id,
          req,
          resendEmail: req.body.resendEmail !== false,
          force: true,
          emailTo: req.body.emailTo || "",
          issueMissingDte: req.body.issueMissingDte === true
        });
        results.push({
          orderId: order.id,
          ok: true,
          skipped: result.skipped,
          folio: result.invoice?.folio || null,
          providerId: result.invoice?.providerId || null,
          pdfUrl: result.invoice?.pdfUrl || null,
          email: result.email
        });
      } catch (error) {
        results.push({ orderId: order.id, ok: false, message: error.message });
      }
    }

    res.json({
      ok: true,
      processed: results.length,
      issued: results.filter((result) => result.ok && !result.skipped).length,
      failed: results.filter((result) => !result.ok).length,
      results
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/backoffice/orders/:orderId/reissue-dte", async (req, res, next) => {
  try {
    requireAdmin(req);
    const result = await reissueOrderDte({
      orderId: req.params.orderId,
      req,
      resendEmail: req.body.resendEmail !== false,
      force: Boolean(req.body.force),
      emailTo: req.body.emailTo || "",
      issueMissingDte: req.body.issueMissingDte === true
    });
    res.json({
      ok: true,
      skipped: result.skipped,
      reason: result.reason,
      order: publicOrder(result.order),
      user: publicUser(result.user),
      tickets: result.tickets.map((ticket) => publicTicket(ticket, req)),
      invoice: result.invoice,
      email: result.email
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
    const result = await resendOrderEmail(req.params.orderId, { emailTo: req.body.emailTo || "" });
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
      const result = await updateOrderPaymentStatus(payment.external_reference, paymentData);
      if (result.order?.status === "payment_failed") {
        await sendPaymentRetryEmail({ orderId: payment.external_reference, req, reason: payment.status });
      }
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

const pageRoutes = {
  "/ticketera": "ticketera.html",
  "/carrito": "carrito.html",
  "/mi-pit-lane": "mi-pit-lane.html",
  "/mis-compras": "mis-compras.html",
  "/terminos-datos-personales": "terminos-datos-personales.html",
  "/validar": "validar.html",
  "/enrolamiento": "enrolamiento.html",
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
