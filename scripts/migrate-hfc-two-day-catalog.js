const dotenv = require("dotenv");
const { events: dayEvents, ticketTypes: dayTickets } = require("../server/config/catalog");

const activeDayEvents = dayEvents.filter((event) => event.active !== false);
const activeDayTickets = dayTickets.filter((ticket) => ticket.active !== false);

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const CLIENT_FIELDS = new Set([
  "price",
  "netPrice",
  "pricing",
  "salePhaseId",
  "salePhaseName",
  "salePhaseKind",
  "saleRemaining",
  "available",
  "availabilityByEvent"
]);

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Falta ${name}`);
  return value;
}

function withoutClientFields(item = {}) {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !CLIENT_FIELDS.has(key)));
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.text();
  const payload = body ? JSON.parse(body) : null;
  if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
  return payload;
}

async function main() {
  const baseUrl = requiredEnv("PUBLIC_BASE_URL").replace(/\/$/, "");
  const accessToken = requiredEnv("BACKOFFICE_TOKEN");
  const apply = process.argv.includes("--apply");
  const current = await request(`${baseUrl}/api/catalog`);
  const expectedEventIds = activeDayEvents.map((event) => event.id);
  const expectedTicketIds = activeDayTickets.map((ticket) => ticket.id);
  const currentEventIds = current.events.map((event) => event.id);
  const currentTicketIds = current.ticketTypes.map((ticket) => ticket.id);
  if (JSON.stringify(currentEventIds) === JSON.stringify(expectedEventIds) && JSON.stringify(currentTicketIds) === JSON.stringify(expectedTicketIds)) {
    console.log(JSON.stringify({ applied: false, alreadyMigrated: true }, null, 2));
    return;
  }
  const legacyEvents = current.events.map((event) => ({ ...withoutClientFields(event), active: true, visible: false }));
  const legacyTickets = current.ticketTypes.map((ticket) => ({ ...withoutClientFields(ticket), active: true, visible: false }));
  const ticketing = {
    events: [...legacyEvents, ...activeDayEvents],
    ticketTypes: [...legacyTickets, ...activeDayTickets]
  };

  const preview = {
    legacyEvents: legacyEvents.map((event) => event.id),
    publicEvents: activeDayEvents.map((event) => `${event.name} (${event.dateLabel})`),
    publicTickets: activeDayTickets.map((ticket) => ticket.id),
    parqueCerradoQuotaPerDay: 100,
    serviceChargeRate: "8%"
  };

  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, ...preview }, null, 2));
    return;
  }

  await request(`${baseUrl}/api/backoffice/ticketing`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": accessToken
    },
    body: JSON.stringify({ ticketing })
  });

  const verified = await request(`${baseUrl}/api/catalog`);
  const visibleEventIds = verified.events.map((event) => event.id);
  const visibleTicketIds = verified.ticketTypes.map((ticket) => ticket.id);
  if (JSON.stringify(visibleEventIds) !== JSON.stringify(expectedEventIds)) {
    throw new Error("La verificacion del catalogo publico no devolvio las dos jornadas esperadas");
  }
  if (JSON.stringify(visibleTicketIds) !== JSON.stringify(expectedTicketIds)) {
    throw new Error("La verificacion del catalogo publico no devolvio las cuatro entradas esperadas");
  }

  console.log(JSON.stringify({ applied: true, ...preview }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
