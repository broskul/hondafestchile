const fs = require("fs/promises");
const path = require("path");

const dataDir = path.join(process.cwd(), "data");
const dataFile = path.join(dataDir, "app-state.json");

const initialState = {
  users: [],
  sessions: [],
  orders: [],
  tickets: [],
  invoices: [],
  payments: [],
  emailLogs: [],
  audit: []
};

const supabaseCollections = {
  users: "hfc_users",
  sessions: "hfc_sessions",
  orders: "hfc_orders",
  tickets: "hfc_tickets",
  invoices: "hfc_invoices",
  payments: "hfc_payments",
  emailLogs: "hfc_email_logs",
  audit: "hfc_audit"
};

let lastSupabaseWarning = null;

function supabaseConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseKey());
}

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

function storageMode() {
  return supabaseConfigured() ? "supabase" : "json";
}

async function supabaseRequest(table, options = {}) {
  const baseUrl = String(getSupabaseUrl() || "").replace(/\/$/, "");
  const url = new URL(`${baseUrl}/rest/v1/${table}`);

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      apikey: getSupabaseKey(),
      Authorization: `Bearer ${getSupabaseKey()}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const detail = payload?.message || payload?.hint || text || "Error Supabase";
    throw new Error(`Supabase ${table}: ${detail}`);
  }

  return payload;
}

function isMissingSchemaError(error) {
  return /Could not find the table|schema cache|PGRST205/i.test(error.message || "");
}

async function readSupabaseState() {
  let entries;

  try {
    entries = await Promise.all(
      Object.entries(supabaseCollections).map(async ([collection, table]) => {
        const rows = await supabaseRequest(table, {
          query: {
            select: "payload",
            order: "created_at.asc"
          }
        });
        return [collection, rows.map((row) => row.payload).filter(Boolean)];
      })
    );
  } catch (error) {
    if (isMissingSchemaError(error)) {
      lastSupabaseWarning =
        "Supabase esta configurado, pero faltan tablas hfc_*. Ejecuta supabase/schema.sql en el SQL Editor.";
      console.warn(lastSupabaseWarning);
      return readJsonState();
    }
    throw error;
  }

  return {
    ...initialState,
    ...Object.fromEntries(entries)
  };
}

async function readJsonState() {
  await ensureStore();
  const raw = await fs.readFile(dataFile, "utf8");
  const parsed = JSON.parse(raw);
  return {
    ...initialState,
    ...parsed
  };
}

function normalizeItem(collection, item, index) {
  if (item.id) return item;

  return {
    ...item,
    id: `${collection}_${Date.now()}_${index}`
  };
}

function supabaseRow(collection, item) {
  const base = {
    id: item.id,
    payload: item,
    created_at: item.createdAt || item.created_at || new Date().toISOString(),
    updated_at: item.updatedAt || item.updated_at || new Date().toISOString()
  };

  if (collection === "users") {
    return { ...base, email: item.email || null, rut: item.rut || null };
  }

  if (collection === "orders") {
    return {
      ...base,
      user_id: item.userId || null,
      status: item.status || null,
      total: item.total || 0
    };
  }

  if (collection === "tickets") {
    return {
      ...base,
      order_id: item.orderId || null,
      user_id: item.userId || null,
      code: item.code || null,
      status: item.status || null
    };
  }

  if (collection === "invoices" || collection === "payments") {
    return { ...base, order_id: item.orderId || null };
  }

  if (collection === "emailLogs" || collection === "audit") {
    return { ...base, type: item.type || null };
  }

  if (collection === "sessions") {
    return { ...base, user_id: item.userId || null, token: item.token || null };
  }

  return base;
}

async function writeSupabaseState(state) {
  for (const [collection, table] of Object.entries(supabaseCollections)) {
    const items = (state[collection] || []).map((item, index) => normalizeItem(collection, item, index));
    state[collection] = items;

    if (!items.length) continue;

    try {
      await supabaseRequest(table, {
        method: "POST",
        query: {
          on_conflict: "id"
        },
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: items.map((item) => supabaseRow(collection, item))
      });
    } catch (error) {
      if (isMissingSchemaError(error)) {
        lastSupabaseWarning =
          "Supabase esta configurado, pero faltan tablas hfc_*. Se uso JSON local como fallback.";
        console.warn(lastSupabaseWarning);
        await writeJsonState(state);
        return;
      }
      throw error;
    }
  }
}

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(dataFile);
  } catch {
    await fs.writeFile(dataFile, JSON.stringify(initialState, null, 2), "utf8");
  }
}

async function readState() {
  if (supabaseConfigured()) {
    return readSupabaseState();
  }

  return readJsonState();
}

async function writeJsonState(state) {
  await ensureStore();
  await fs.writeFile(dataFile, JSON.stringify(state, null, 2), "utf8");
}

async function writeState(state) {
  if (supabaseConfigured()) {
    await writeSupabaseState(state);
    return;
  }

  await writeJsonState(state);
}

async function updateState(mutator) {
  const state = await readState();
  const result = await mutator(state);
  await writeState(state);
  return result;
}

module.exports = {
  lastSupabaseWarning: () => lastSupabaseWarning,
  readState,
  storageMode,
  supabaseConfigured,
  updateState,
  writeState
};
