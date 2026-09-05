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
  specialPasses: [],
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
  specialPasses: "hfc_special_passes",
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
let specialPassStorageAvailable = null;

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

function specialPassStorageReady() {
  if (storageMode() === "json") {
    return !process.env.VERCEL && process.env.NODE_ENV !== "production";
  }
  if (storageMode() === "supabase" && (process.env.VERCEL || process.env.NODE_ENV === "production")) {
    // The REST adapter cannot prove that the trigger contract is installed and
    // cannot persist a multi-collection checkout atomically.
    return false;
  }
  // Fail closed until the complete relational Upgrade contract has been
  // observed. The legacy hfc_special_passes table alone is not enough to
  // issue auditable Pistons or build draw manifests safely.
  return specialPassStorageAvailable === true;
}

async function verifyPostgresSpecialPassSchema(client = null) {
  const query = client ? client.query.bind(client) : postgresQuery;
  const result = await query(`
    select
      to_regclass('public.hfc_special_passes') is not null as special_passes_table,
      to_regclass('public.hfc_pistons') is not null as pistons_table,
      to_regclass('public.hfc_order_acceptances') is not null as acceptances_table,
      to_regclass('public.hfc_special_prizes') is not null as prizes_table,
      to_regclass('public.hfc_draw_manifests') is not null as manifests_table,
      to_regclass('public.hfc_draw_entries') is not null as draw_entries_table,
      to_regclass('public.hfc_draw_results') is not null as draw_results_table,
      to_regclass('public.hfc_notification_outbox') is not null as notification_outbox_table,
      not exists (
        select 1
        from (
          values
            ('public.hfc_special_passes', 'hfc_special_passes_relationalize_trg'),
            ('public.hfc_special_passes', 'hfc_special_passes_sync_pistons_trg'),
            ('public.hfc_order_acceptances', 'hfc_order_acceptances_immutable_trg'),
            ('public.hfc_pistons', 'hfc_pistons_identity_guard_trg'),
            ('public.hfc_pistons', 'hfc_pistons_void_results_trg'),
            ('public.hfc_draw_manifests', 'hfc_draw_manifests_guard_trg'),
            ('public.hfc_draw_entries', 'hfc_draw_entries_guard_trg'),
            ('public.hfc_draw_results', 'hfc_draw_results_prepare_trg'),
            ('public.hfc_draw_results', 'hfc_draw_results_no_delete_trg'),
            ('public.hfc_draw_results', 'hfc_draw_results_notifications_trg')
        ) as required(table_name, trigger_name)
        where not exists (
          select 1
          from pg_trigger
          where tgrelid = to_regclass(required.table_name)
            and tgname = required.trigger_name
            and not tgisinternal
            and tgenabled <> 'D'
        )
      ) as critical_triggers
  `);
  const contract = result.rows[0] || {};
  return Object.values(contract).every((value) => value === true);
}

async function readPostgresStateWithClient(client) {
  const entries = [];
  for (const [collection, table] of Object.entries(supabaseCollections)) {
    try {
      const result = await client.query(`select payload from public.${table} order by created_at asc`);
      entries.push([collection, result.rows.map((row) => row.payload).filter(Boolean)]);
    } catch (error) {
      if (collection === "specialPasses" && isMissingSchemaError(error)) {
        specialPassStorageAvailable = false;
        entries.push([collection, []]);
        continue;
      }
      throw error;
    }
  }
  specialPassStorageAvailable = await verifyPostgresSpecialPassSchema(client);
  return {
    ...initialState,
    ...Object.fromEntries(entries)
  };
}

async function readPostgresState() {
  let client = null;
  try {
    client = await getPostgresPool().connect();
    await client.query("begin isolation level repeatable read read only");
    const state = await readPostgresStateWithClient(client);
    await client.query("commit");
    lastSupabaseWarning = null;
    return state;
  } catch (error) {
    if (client) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original storage failure.
      }
    }
    if (canUseLocalReadFallback(error)) {
      lastSupabaseWarning = supabaseFallbackWarning(error);
      console.warn(lastSupabaseWarning);
      return readJsonState();
    }
    throw error;
  } finally {
    client?.release();
  }
}

async function readSupabaseState() {
  let entries;

  try {
    entries = await Promise.all(
      Object.entries(supabaseCollections).map(async ([collection, table]) => {
        try {
          const rows = await supabaseRequest(table, {
            query: {
              select: "payload",
              order: "created_at.asc"
            }
          });
          return [collection, rows.map((row) => row.payload).filter(Boolean)];
        } catch (error) {
          if (collection === "specialPasses" && isMissingSchemaError(error)) {
            specialPassStorageAvailable = false;
            return [collection, []];
          }
          throw error;
        }
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

  // PostgREST cannot inspect trigger state. Requiring the relational tables is
  // still stricter than accepting the legacy pass table on its own; production
  // uses the direct PostgreSQL connection, where triggers are also verified.
  try {
    await Promise.all(
      [
        "hfc_pistons",
        "hfc_order_acceptances",
        "hfc_special_prizes",
        "hfc_draw_manifests",
        "hfc_draw_entries",
        "hfc_draw_results",
        "hfc_notification_outbox"
      ].map(
        (table) => supabaseRequest(table, { query: { select: "id", limit: "1" } })
      )
    );
    specialPassStorageAvailable = true;
  } catch (error) {
    if (isMissingSchemaError(error)) {
      specialPassStorageAvailable = false;
    } else {
      throw error;
    }
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

  if (collection === "specialPasses") {
    return {
      ...base,
      order_id: item.orderId || null,
      user_id: item.userId || null,
      code: item.code || null,
      status: item.status || null,
      piston_count: Number(item.pistonCount || 0)
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
    if (collection === "specialPasses" && !specialPassStorageReady()) continue;
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

async function writePostgresStateWithClient(state, client) {
  for (const [collection, table] of Object.entries(supabaseCollections)) {
    if (collection === "specialPasses" && !specialPassStorageReady()) continue;
    const items = (state[collection] || []).map((item, index) => normalizeItem(collection, item, index));
    state[collection] = items;

    if (!items.length) continue;

    for (const item of items) {
      const row = supabaseRow(collection, item);
      const columns = Object.keys(row);
      const placeholders = columns.map((column, index) =>
        column === "payload" ? `$${index + 1}::jsonb` : `$${index + 1}`
      );
      const updates = columns
        .filter((column) => column !== "id")
        .map((column) => `${column}=excluded.${column}`);
      const values = columns.map((column) => (column === "payload" ? JSON.stringify(row[column]) : row[column]));

      await client.query(
        `insert into public.${table} (${columns.join(",")}) values (${placeholders.join(",")}) on conflict (id) do update set ${updates.join(",")}`,
        values
      );
    }
  }
}

async function writePostgresState(state) {
  let client = null;
  try {
    client = await getPostgresPool().connect();
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended('hfc_state_write', 0))");
    await writePostgresStateWithClient(state, client);
    await client.query("commit");
    lastSupabaseWarning = null;
  } catch (error) {
    if (client) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original storage failure.
      }
    }
    if (canUseLocalWriteFallback(error)) {
      lastSupabaseWarning = supabaseFallbackWarning(error, true);
      console.warn(lastSupabaseWarning);
      await writeJsonState(state);
      return;
    }
    throw error;
  } finally {
    client?.release();
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
  if (postgresConfigured()) {
    let client = null;
    let state = null;
    let result;
    let mutatorCompleted = false;
    try {
      client = await getPostgresPool().connect();
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended('hfc_state_write', 0))");
      state = await readPostgresStateWithClient(client);
      result = await mutator(state);
      mutatorCompleted = true;
      await writePostgresStateWithClient(state, client);
      await client.query("commit");
      lastSupabaseWarning = null;
      return result;
    } catch (error) {
      if (client) {
        try {
          await client.query("rollback");
        } catch {
          // Preserve the original storage failure.
        }
      }
      if (canUseLocalWriteFallback(error)) {
        lastSupabaseWarning = supabaseFallbackWarning(error, true);
        console.warn(lastSupabaseWarning);
        if (!state) state = await readJsonState();
        if (!mutatorCompleted) result = await mutator(state);
        await writeJsonState(state);
        return result;
      }
      throw error;
    } finally {
      client?.release();
    }
  }

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
  specialPassStorageReady,
  storageMode,
  supabaseConfigured,
  updateState,
  verifyCheckoutStorage,
  writeState
};
