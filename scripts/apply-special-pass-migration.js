const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { Client } = require("pg");

const explicitEnvironmentFile = String(process.env.HFC_ENV_FILE || "").trim();
dotenv.config();
if (explicitEnvironmentFile) {
  dotenv.config({ path: explicitEnvironmentFile, override: true });
} else if (/^(1|true|yes)$/i.test(String(process.env.HFC_ALLOW_LOCAL_MIGRATION_ENV || ""))) {
  dotenv.config({ path: ".env.local", override: false });
}

const REQUIRED_TABLES = [
  "hfc_special_passes",
  "hfc_order_acceptances",
  "hfc_pistons",
  "hfc_special_prizes",
  "hfc_draw_manifests",
  "hfc_draw_entries",
  "hfc_draw_results",
  "hfc_notification_outbox"
];

const REQUIRED_SPECIAL_PASS_COLUMNS = [
  "id",
  "order_id",
  "user_id",
  "code",
  "status",
  "piston_count",
  "payload",
  "campaign_id",
  "event_id",
  "holder_rut",
  "holder_email",
  "holder_phone",
  "entry_validation_status",
  "attendance_status",
  "terms_version",
  "terms_accepted_at",
  "not_entry_accepted_at",
  "created_at",
  "updated_at"
];

const REQUIRED_ORDER_ACCEPTANCE_COLUMNS = [
  "id",
  "order_id",
  "special_pass_id",
  "acceptance_type",
  "document_version",
  "document_hash_sha256",
  "accepted_at",
  "source",
  "payload",
  "created_at"
];

function connectionStringFromEnvironment() {
  const legacySupabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  return String(
    process.env.SUPABASE_DB_URL ||
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URL ||
      (/^postgres(ql)?:\/\//i.test(legacySupabaseUrl) ? legacySupabaseUrl : "")
  ).trim();
}

function supabaseProjectRefFromRestEnvironment() {
  const value = String(
    process.env.SUPABASE_REST_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  ).trim();
  if (!value) return "";
  try {
    const match = new URL(value).hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

function supabaseProjectRefFromConnectionString(connectionString) {
  try {
    const parsed = new URL(connectionString);
    const directHost = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1] || "";
    const poolerUser = decodeURIComponent(parsed.username || "").match(/^postgres\.([a-z0-9]+)$/i)?.[1] || "";
    return directHost || poolerUser;
  } catch {
    return "";
  }
}

function assertMigrationTarget(connectionString) {
  if (process.env.HFC_CONFIRM_SPECIAL_PASS_MIGRATION !== "APPLY_HFC_SPECIAL_PASS_UPGRADE") {
    throw new Error(
      "Falta confirmación HFC_CONFIRM_SPECIAL_PASS_MIGRATION=APPLY_HFC_SPECIAL_PASS_UPGRADE"
    );
  }

  const databaseRef = supabaseProjectRefFromConnectionString(connectionString);
  const restRef = supabaseProjectRefFromRestEnvironment();
  const expectedRef = String(process.env.HFC_EXPECTED_SUPABASE_PROJECT_REF || "").trim();
  if (databaseRef && restRef && databaseRef !== restRef) {
    throw new Error("SUPABASE_DB_URL y NEXT_PUBLIC_SUPABASE_URL apuntan a proyectos distintos");
  }
  if (expectedRef && databaseRef !== expectedRef) {
    throw new Error("SUPABASE_DB_URL no coincide con HFC_EXPECTED_SUPABASE_PROJECT_REF");
  }
  if (expectedRef && restRef && restRef !== expectedRef) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no coincide con HFC_EXPECTED_SUPABASE_PROJECT_REF");
  }
  if (!databaseRef && !expectedRef) {
    throw new Error("No se pudo verificar el proyecto Supabase de destino; define HFC_EXPECTED_SUPABASE_PROJECT_REF");
  }
}

function relevantMigrationFiles() {
  const migrationsDirectory = path.join(process.cwd(), "supabase", "migrations");
  return fs
    .readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+_special_pass.*\.sql$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ name, path: path.join(migrationsDirectory, name) }));
}

async function verifyContract(client) {
  const tablesResult = await client.query(
    `
      select c.relname as table_name, c.relrowsecurity as rls_enabled
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relname = any($1::text[])
    `,
    [REQUIRED_TABLES]
  );
  const tableMap = new Map(tablesResult.rows.map((row) => [row.table_name, row]));
  const missingTables = REQUIRED_TABLES.filter((table) => !tableMap.has(table));
  if (missingTables.length) throw new Error(`Faltan tablas: ${missingTables.join(", ")}`);

  const withoutRls = REQUIRED_TABLES.filter((table) => !tableMap.get(table).rls_enabled);
  if (withoutRls.length) throw new Error(`RLS no esta activo en: ${withoutRls.join(", ")}`);

  const columnsResult = await client.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'hfc_special_passes'
  `);
  const columnNames = new Set(columnsResult.rows.map((row) => row.column_name));
  const missingColumns = REQUIRED_SPECIAL_PASS_COLUMNS.filter((column) => !columnNames.has(column));
  if (missingColumns.length) throw new Error(`Faltan columnas en hfc_special_passes: ${missingColumns.join(", ")}`);

  const acceptanceColumnsResult = await client.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'hfc_order_acceptances'
  `);
  const acceptanceColumnNames = new Set(acceptanceColumnsResult.rows.map((row) => row.column_name));
  const missingAcceptanceColumns = REQUIRED_ORDER_ACCEPTANCE_COLUMNS.filter(
    (column) => !acceptanceColumnNames.has(column)
  );
  if (missingAcceptanceColumns.length) {
    throw new Error(`Faltan columnas en hfc_order_acceptances: ${missingAcceptanceColumns.join(", ")}`);
  }

  const triggersResult = await client.query(`
    select tgname
    from pg_trigger
    where tgrelid in (
      'public.hfc_special_passes'::regclass,
      'public.hfc_order_acceptances'::regclass,
      'public.hfc_pistons'::regclass,
      'public.hfc_draw_manifests'::regclass,
      'public.hfc_draw_entries'::regclass,
      'public.hfc_draw_results'::regclass
    )
      and not tgisinternal
      and tgenabled <> 'D'
  `);
  const triggerNames = new Set(triggersResult.rows.map((row) => row.tgname));
  const requiredTriggers = [
    "hfc_special_passes_relationalize_trg",
    "hfc_special_passes_sync_pistons_trg",
    "hfc_order_acceptances_immutable_trg",
    "hfc_pistons_identity_guard_trg",
    "hfc_pistons_void_results_trg",
    "hfc_draw_manifests_guard_trg",
    "hfc_draw_entries_guard_trg",
    "hfc_draw_results_prepare_trg",
    "hfc_draw_results_no_delete_trg",
    "hfc_draw_results_notifications_trg"
  ];
  const missingTriggers = requiredTriggers.filter((trigger) => !triggerNames.has(trigger));
  if (missingTriggers.length) throw new Error(`Faltan triggers: ${missingTriggers.join(", ")}`);

  const manifestFunctionResult = await client.query(`
    select
      proc.prosecdef as security_definer,
      exists (
        select 1
        from aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ) as public_can_execute
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = 'hfc_create_draw_manifest'
      and pg_get_function_identity_arguments(proc.oid) = 'prize_id_value text, created_by_value text, payload_value jsonb'
  `);
  if (manifestFunctionResult.rowCount !== 1 || !manifestFunctionResult.rows[0].security_definer) {
    throw new Error("hfc_create_draw_manifest no quedo instalada como SECURITY DEFINER");
  }
  if (manifestFunctionResult.rows[0].public_can_execute) {
    throw new Error("PUBLIC conserva EXECUTE sobre hfc_create_draw_manifest");
  }

  const serviceRoleResult = await client.query(`select exists(select 1 from pg_roles where rolname = 'service_role') as exists`);
  if (serviceRoleResult.rows[0].exists) {
    const acceptancePrivileges = await client.query(`
      select
        has_table_privilege('service_role', 'public.hfc_order_acceptances', 'UPDATE') as can_update,
        has_table_privilege('service_role', 'public.hfc_order_acceptances', 'DELETE') as can_delete
    `);
    if (acceptancePrivileges.rows[0].can_update || acceptancePrivileges.rows[0].can_delete) {
      throw new Error("service_role conserva UPDATE/DELETE directo sobre aceptaciones inmutables");
    }
  }

  const prizeResult = await client.query(`
    select id, presence_required, event_entry_required, draw_mode, draw_on, status
    from public.hfc_special_prizes
    where id = 'hfc-2026-automobile' or code = 'automobile'
    order by (id = 'hfc-2026-automobile') desc
    limit 1
  `);
  if (prizeResult.rowCount !== 1) throw new Error("Falta el premio base del automovil");
  const automobile = prizeResult.rows[0];
  if (automobile.presence_required || automobile.event_entry_required) {
    throw new Error("El premio del automovil quedo configurado con requisito de presencia o entrada");
  }
  if (automobile.draw_mode !== "in_person") {
    throw new Error("El premio del automovil no quedo configurado como sorteo presencial");
  }

  const invalidPistonsResult = await client.query(`
    select count(*)::integer as invalid_count
    from public.hfc_pistons
    where holder_rut is null
       or holder_rut <> public.hfc_normalize_rut(holder_rut)
       or holder_rut !~ '^[0-9]{6,8}[0-9K]$'
       or ordinal <= 0
  `);
  if (invalidPistonsResult.rows[0].invalid_count !== 0) {
    throw new Error("Existen Pistones sin RUT normalizado u ordinal valido");
  }

  const duplicatePistonsResult = await client.query(`
    select count(*)::integer as duplicate_count
    from (
      select special_pass_id, ordinal
      from public.hfc_pistons
      group by special_pass_id, ordinal
      having count(*) > 1
    ) duplicates
  `);
  if (duplicatePistonsResult.rows[0].duplicate_count !== 0) {
    throw new Error("Existen Pistones duplicados por Pase y ordinal");
  }

  let configState = null;
  const settingsExistsResult = await client.query(`select to_regclass('public.hfc_settings') is not null as exists`);
  if (!settingsExistsResult.rows[0].exists) {
    throw new Error("Falta public.hfc_settings para persistir el kill-switch del Upgrade");
  } else {
    const configResult = await client.query(`
      select
        payload -> 'active' as active,
        payload -> 'rulesPublished' as rules_published,
        payload ->> 'eventDate' as event_date
      from public.hfc_settings
      where id = 'special_pass_config' or type = 'special_pass'
      order by (id = 'special_pass_config') desc
      limit 1
    `);
    configState = configResult.rowCount ? configResult.rows[0] : null;
    if (!configState) throw new Error("Falta la configuracion persistida del Upgrade");
    if (configState.active !== false || configState.rules_published !== false) {
      throw new Error("El kill-switch o rulesPublished no quedaron desactivados");
    }
    if (configState.event_date !== "2026-11-29") {
      throw new Error("La fecha persistida del Upgrade no quedo en 2026-11-29");
    }
  }

  const pistonStatsResult = await client.query(`
    select
      count(*)::integer as total,
      count(*) filter (where status = 'valid')::integer as valid,
      count(*) filter (where status = 'revoked')::integer as revoked
    from public.hfc_pistons
  `);

  return {
    tables: REQUIRED_TABLES.length,
    rls: true,
    triggers: requiredTriggers.length,
    automobile: {
      id: automobile.id,
      presenceRequired: automobile.presence_required,
      eventEntryRequired: automobile.event_entry_required,
      drawMode: automobile.draw_mode,
      drawOn: automobile.draw_on,
      status: automobile.status
    },
    config: {
      active: configState?.active ?? null,
      rulesPublished: configState?.rules_published ?? null,
      eventDate: configState?.event_date ?? null
    },
    pistons: pistonStatsResult.rows[0]
  };
}

async function main() {
  const connectionString = connectionStringFromEnvironment();
  if (!connectionString) throw new Error("Falta SUPABASE_DB_URL para aplicar DDL");
  assertMigrationTarget(connectionString);

  const migrations = relevantMigrationFiles();
  if (!migrations.length) throw new Error("No se encontraron migraciones de Pases especiales");

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '15s'");
    await client.query("set local statement_timeout = '180s'");
    await client.query("select pg_advisory_xact_lock(hashtextextended('hfc_special_pass_migrations', 0))");

    for (const migration of migrations) {
      const sql = fs.readFileSync(migration.path, "utf8");
      await client.query(sql);
    }

    const verification = await verifyContract(client);
    await client.query("commit");
    console.log(
      JSON.stringify({
        ok: true,
        migrations: migrations.map((migration) => migration.name),
        verification
      })
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
