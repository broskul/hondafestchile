const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { Pool } = require("pg");

const dataDir =
  process.env.JSON_STORE_DIR ||
  (process.env.VERCEL ? path.join(os.tmpdir(), "hfc-data") : path.join(process.cwd(), "data"));
const dataFile = path.join(dataDir, "app-state.json");

const initialState = {
  users: [],
  sessions: [],
  orders: [],
  tickets: [],
  invoices: [],
  payments: [],
  settings: [],
  contacts: [],
  emailTemplates: [],
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
  settings: "hfc_settings",
  contacts: "hfc_contacts",
  emailTemplates: "hfc_email_templates",
  emailLogs: "hfc_email_logs",
  audit: "hfc_audit"
};

let lastSupabaseWarning = null;
let postgresPool = null;

function supabaseConfigured() {
  return postgresConfigured() || supabaseRestConfigured();
}

function cleanEnv(name) {
  return String(process.env[name] || "").trim();
}

function getPostgresUrl() {
  const explicit = cleanEnv("SUPABASE_DB_URL") || cleanEnv("POSTGRES_URL") || cleanEnv("DATABASE_URL");
  if (explicit) return explicit;

  const legacyValue = cleanEnv("SUPABASE_URL");
  return /^postgres(ql)?:\/\//i.test(legacyValue) ? legacyValue : "";
}

function postgresConfigured() {
  return Boolean(getPostgresUrl());
}

function supabaseRestConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseKey());
}

function getSupabaseUrl() {
  const explicit = cleanEnv("SUPABASE_REST_URL") || cleanEnv("NEXT_PUBLIC_SUPABASE_URL");
  if (explicit) return explicit;

  const value = cleanEnv("SUPABASE_URL");
  return /^https?:\/\//i.test(value) ? value : "";
}

function getSupabaseKey() {
  return cleanEnv("SUPABASE_SERVICE_ROLE_KEY") || cleanEnv("SUPABASE_ANON_KEY") || cleanEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

function storageMode() {
  if (postgresConfigured()) return "postgres";
  return supabaseRestConfigured() ? "supabase" : "json";
}

function storageWarning() {
  if (lastSupabaseWarning) return lastSupabaseWarning;
  if (process.env.VERCEL && !supabaseConfigured()) {
    return "Vercel esta usando JSON temporal. Configura Supabase antes de vender en produccion.";
  }
  return null;
}

function checkoutStorageReady() {
  if (!process.env.VERCEL) return true;
  if (supabaseConfigured()) return !lastSupabaseWarning;
  return /^(1|true|yes|si|sí)$/i.test(String(process.env.ALLOW_VOLATILE_CHECKOUT || "").trim());
}

function getPostgresPool() {
  if (!postgresPool) {
    postgresPool = new Pool({
      connectionString: getPostgresUrl(),
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.POSTGRES_POOL_MAX || 3),
      idleTimeoutMillis: Number(process.env.POSTGRES_IDLE_TIMEOUT_MS || 10000),
      connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || 8000)
    });
  }

  return postgresPool;
}

async function postgresQuery(text, params = []) {
  return getPostgresPool().query(text, params);
}

async function supabaseRequest(table, options = {}) {
  const baseUrl = String(getSupabaseUrl() || "").replace(/\/$/, "");
  const url = new URL(`${baseUrl}/rest/v1/${table}`);

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.SUPABASE_FETCH_TIMEOUT_MS || 8000));

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      apikey: getSupabaseKey(),
      Authorization: `Bearer ${getSupabaseKey()}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text.slice(0, 500) };
    }
  }

  if (!response.ok) {
    const detail = payload?.message || payload?.hint || text || `HTTP ${response.status}`;
    throw new Error(`Supabase ${table}: ${detail}`);
  }

  return payload;
}

function isMissingSchemaError(error) {
  const message = `${error.message || ""} ${error.code || ""}`;
  return /Could not find the table|schema cache|PGRST205|relation .* does not exist|42P01/i.test(message);
}

function isReachabilityError(error) {
  const message = `${error.message || ""} ${error.cause?.code || ""} ${error.cause?.message || ""}`;
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|AbortError|aborted|network|522|Connection timed out|gateway timeout/i.test(message);
}

function supabaseFallbackWarning(error, write = false) {
  if (isMissingSchemaError(error)) {
    return write
      ? "La base persistente esta configurada, pero faltan tablas hfc_*. Se uso JSON local como fallback."
      : "Supabase esta configurado, pero faltan tablas hfc_*. Ejecuta supabase/schema.sql en el SQL Editor.";
  }

  return process.env.NODE_ENV === "production"
    ? "La base persistente no esta alcanzable en produccion. El catalogo usa datos locales, pero checkout queda bloqueado."
    : "La base persistente no esta alcanzable en desarrollo. Se uso JSON local como fallback.";
}

function canUseLocalReadFallback(error) {
  return isMissingSchemaError(error) || isReachabilityError(error);
}

function canUseLocalWriteFallback(error) {
  if (process.env.VERCEL || process.env.NODE_ENV === "production") return false;
  return isMissingSchemaError(error) || isReachabilityError(error);
}

async function readPostgresState() {
  let entries;

  try {
    entries = await Promise.all(
      Object.entries(supabaseCollections).map(async ([collection, table]) => {
        const result = await postgresQuery(`select payload from public.${table} order by created_at asc`);
        return [collection, result.rows.map((row) => row.payload).filter(Boolean)];
      })
    );
  } catch (error) {
    if (canUseLocalReadFallback(error)) {
      lastSupabaseWarning = supabaseFallbackWarning(error);
      console.warn(lastSupabaseWarning);
      return readJsonState();
    }
    throw error;
  }

  lastSupabaseWarning = null;

  return {
    ...initialState,
    ...Object.fromEntries(entries)
  };
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
    if (canUseLocalReadFallback(error)) {
      lastSupabaseWarning = supabaseFallbackWarning(error);
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

  if (collection === "settings") {
    return { ...base, type: item.type || null };
  }

  if (collection === "contacts") {
    return {
      ...base,
      email: item.email || null,
      corrected_email: item.correctedEmail || null,
      source: item.source || null
    };
  }

  if (collection === "emailTemplates") {
    return { ...base, type: item.type || item.id || null };
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
      if (canUseLocalWriteFallback(error)) {
        lastSupabaseWarning = supabaseFallbackWarning(error, true);
        console.warn(lastSupabaseWarning);
        await writeJsonState(state);
        return;
      }
      throw error;
    }
  }
}

async function writePostgresState(state) {
  for (const [collection, table] of Object.entries(supabaseCollections)) {
    const items = (state[collection] || []).map((item, index) => normalizeItem(collection, item, index));
    state[collection] = items;

    if (!items.length) continue;

    for (const item of items) {
      const row = supabaseRow(collection, item);
      const columns = Object.keys(row);
      const placeholders = columns.map((column, index) => (column === "payload" ? `$${index + 1}::jsonb` : `$${index + 1}`));
      const updates = columns
        .filter((column) => column !== "id")
        .map((column) => `${column}=excluded.${column}`);
      const values = columns.map((column) => (column === "payload" ? JSON.stringify(row[column]) : row[column]));

      try {
        await postgresQuery(
          `insert into public.${table} (${columns.join(",")}) values (${placeholders.join(",")}) on conflict (id) do update set ${updates.join(",")}`,
          values
        );
      } catch (error) {
        if (canUseLocalWriteFallback(error)) {
          lastSupabaseWarning = supabaseFallbackWarning(error, true);
          console.warn(lastSupabaseWarning);
          await writeJsonState(state);
          return;
        }
        throw error;
      }
    }
  }

  lastSupabaseWarning = null;
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
  if (postgresConfigured()) {
    return readPostgresState();
  }

  if (supabaseRestConfigured()) {
    return readSupabaseState();
  }

  return readJsonState();
}

async function writeJsonState(state) {
  await ensureStore();
  await fs.writeFile(dataFile, JSON.stringify(state, null, 2), "utf8");
}

async function writeState(state) {
  if (postgresConfigured()) {
    await writePostgresState(state);
    return;
  }

  if (supabaseRestConfigured()) {
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

async function verifyCheckoutStorage() {
  if (!process.env.VERCEL) return;
  if (!supabaseConfigured()) {
    if (checkoutStorageReady()) return;
    const error = new Error("Configura Supabase en Vercel antes de activar ventas con Mercado Pago");
    error.status = 503;
    throw error;
  }

  if (postgresConfigured()) {
    try {
      await postgresQuery("select id from public.hfc_settings limit 1");
      lastSupabaseWarning = null;
      return;
    } catch (error) {
      lastSupabaseWarning = supabaseFallbackWarning(error);
      if (checkoutStorageReady()) return;
      const nextError = new Error(lastSupabaseWarning);
      nextError.status = 503;
      throw nextError;
    }
  }

  try {
    await supabaseRequest("hfc_settings", {
      query: {
        select: "id",
        limit: "1"
      }
    });
    lastSupabaseWarning = null;
  } catch (error) {
    lastSupabaseWarning = supabaseFallbackWarning(error);
    if (checkoutStorageReady()) return;
    const nextError = new Error(lastSupabaseWarning);
    nextError.status = 503;
    throw nextError;
  }
}

module.exports = {
  checkoutStorageReady,
  lastSupabaseWarning: storageWarning,
  readState,
  storageMode,
  supabaseConfigured,
  updateState,
  verifyCheckoutStorage,
  writeState
};
