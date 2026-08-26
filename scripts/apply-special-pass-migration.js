const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { Client } = require("pg");

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

async function main() {
  const legacySupabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  const connectionString = String(
    process.env.SUPABASE_DB_URL ||
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URL ||
      (/^postgres(ql)?:\/\//i.test(legacySupabaseUrl) ? legacySupabaseUrl : "")
  ).trim();
  if (!connectionString) throw new Error("Falta SUPABASE_DB_URL para aplicar DDL");
  const migrationPath = path.join(process.cwd(), "supabase", "migrations", "20260809090000_special_passes.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(sql);
    const verification = await client.query(`
      select
        c.relrowsecurity as rls_enabled,
        array_agg(a.attname order by a.attnum) filter (where a.attnum > 0 and not a.attisdropped) as columns
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attribute a on a.attrelid = c.oid
      where n.nspname = 'public' and c.relname = 'hfc_special_passes'
      group by c.relrowsecurity
    `);
    if (verification.rowCount !== 1) throw new Error("La tabla hfc_special_passes no quedó disponible");
    const row = verification.rows[0];
    const required = ["id", "order_id", "user_id", "code", "status", "piston_count", "payload", "created_at", "updated_at"];
    const missing = required.filter((column) => !row.columns.includes(column));
    if (missing.length) throw new Error(`Faltan columnas: ${missing.join(", ")}`);
    if (!row.rls_enabled) throw new Error("RLS no quedó activado en hfc_special_passes");
    await client.query("commit");
    console.log(JSON.stringify({ ok: true, table: "public.hfc_special_passes", rls: true, columns: required.length }));
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
