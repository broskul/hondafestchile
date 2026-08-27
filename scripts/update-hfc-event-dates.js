const dotenv = require("dotenv");

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const EVENT_DATES = {
  "hfc-2026-sabado-drag-day": {
    dateLabel: "Sábado 28 de noviembre de 2026",
    eventDate: "2026-11-28T09:00:00-03:00",
    highlight: "Sábado 28 de noviembre"
  },
  "hfc-2026-domingo-track-day": {
    dateLabel: "Domingo 29 de noviembre de 2026",
    eventDate: "2026-11-29T09:00:00-03:00",
    highlight: "Domingo 29 de noviembre"
  }
};

const PREVENTA_ENDS_AT = {
  "hfc-2026-sabado-galeria": "2026-11-28T00:00:00-03:00",
  "hfc-2026-sabado-parque-cerrado": "2026-11-28T00:00:00-03:00",
  "hfc-2026-domingo-galeria": "2026-11-29T00:00:00-03:00",
  "hfc-2026-domingo-parque-cerrado": "2026-11-29T00:00:00-03:00"
};

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Falta ${name}`);
  return value;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.text();
  let payload = null;
  if (body) payload = JSON.parse(body);
  if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
  return payload;
}

async function readSetting(id) {
  const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const serviceRole = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const url = new URL(`${supabaseUrl}/rest/v1/hfc_settings`);
  url.searchParams.set("select", "payload");
  url.searchParams.set("id", `eq.${id}`);
  const rows = await request(url, {
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`
    }
  });
  return rows[0]?.payload || null;
}

function updateTicketing(ticketing) {
  const changes = [];
  const events = (ticketing.events || []).map((event) => {
    const update = EVENT_DATES[event.id];
    if (!update) return event;
    const highlights = Array.isArray(event.highlights)
      ? event.highlights.map((highlight) => (/^(Sábado|Domingo) \d{1,2} de noviembre$/i.test(highlight) ? update.highlight : highlight))
      : event.highlights;
    const next = { ...event, ...update, highlights };
    if (JSON.stringify(next) !== JSON.stringify(event)) changes.push(`event:${event.id}`);
    return next;
  });

  const ticketTypes = (ticketing.ticketTypes || []).map((ticket) => {
    const endsAt = PREVENTA_ENDS_AT[ticket.id];
    if (!endsAt) return ticket;
    const phases = (ticket.phases || []).map((phase) => {
      if (String(phase.id || phase.kind).toLowerCase() !== "preventa") return phase;
      return { ...phase, endsAt };
    });
    const next = { ...ticket, phases };
    if (JSON.stringify(next) !== JSON.stringify(ticket)) changes.push(`ticket:${ticket.id}`);
    return next;
  });

  return { ticketing: { ...ticketing, events, ticketTypes }, changes };
}

async function main() {
  const baseUrl = requiredEnv("PUBLIC_BASE_URL").replace(/\/$/, "");
  const accessToken = String(process.env.BACKOFFICE_TOKEN || process.env.BACKOFFICE_PASSWORD || "").trim();
  if (!accessToken) throw new Error("Falta BACKOFFICE_TOKEN o BACKOFFICE_PASSWORD");
  const apply = process.argv.includes("--apply");

  const ticketing = await readSetting("ticketing_config");
  const updatedTicketing = ticketing ? updateTicketing(ticketing) : { ticketing: null, changes: [] };
  const specialPass = await readSetting("special_pass_config");
  const updatedSpecialPass = specialPass
    ? { ...specialPass, eventDate: "2026-11-28", eventDateLabel: "28 y 29 de noviembre de 2026" }
    : null;

  const summary = {
    dryRun: !apply,
    ticketingSettingFound: Boolean(ticketing),
    ticketingChanges: updatedTicketing.changes,
    specialPassChanged:
      Boolean(updatedSpecialPass) &&
      (updatedSpecialPass.eventDate !== specialPass.eventDate || updatedSpecialPass.eventDateLabel !== specialPass.eventDateLabel)
  };

  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (updatedTicketing.changes.length) {
    await request(`${baseUrl}/api/backoffice/ticketing`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-admin-token": accessToken },
      body: JSON.stringify({ ticketing: updatedTicketing.ticketing })
    });
  }

  if (summary.specialPassChanged) {
    await request(`${baseUrl}/api/backoffice/special-passes/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-admin-token": accessToken },
      body: JSON.stringify({ specialPass: updatedSpecialPass })
    });
  }

  const catalog = await request(`${baseUrl}/api/catalog`);
  const actualDates = Object.fromEntries(catalog.events.map((event) => [event.id, event.eventDate]));
  for (const [eventId, expected] of Object.entries(EVENT_DATES)) {
    if (actualDates[eventId] !== expected.eventDate) throw new Error(`La fecha de ${eventId} no quedo actualizada`);
  }

  console.log(JSON.stringify({ applied: true, ...summary, dryRun: false }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
