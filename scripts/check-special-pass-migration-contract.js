const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260905120000_special_pass_upgrades.sql"
);
const sql = fs.readFileSync(migrationPath, "utf8");

const requiredTables = [
  "hfc_order_acceptances",
  "hfc_pistons",
  "hfc_special_prizes",
  "hfc_draw_manifests",
  "hfc_draw_entries",
  "hfc_draw_results",
  "hfc_notification_outbox"
];

for (const table of requiredTables) {
  assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, "i"), `${table} no es idempotente`);
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"), `${table} no activa RLS`);
}

for (const column of [
  "campaign_id",
  "event_id",
  "holder_rut",
  "holder_email",
  "holder_phone",
  "entry_validation_status",
  "attendance_status",
  "terms_version"
]) {
  assert.match(
    sql,
    new RegExp(`alter table public\\.hfc_special_passes add column if not exists ${column}\\b`, "i"),
    `Falta proyeccion relacional ${column}`
  );
}

for (const trigger of [
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
]) {
  assert.match(sql, new RegExp(`create trigger ${trigger}\\b`, "i"), `Falta trigger ${trigger}`);
}

assert.match(sql, /create or replace function public\.hfc_normalize_rut\b/i);
const relationalizeFunction = sql.slice(
  sql.indexOf("create or replace function public.hfc_special_pass_relationalize"),
  sql.indexOf("create or replace function public.hfc_sync_special_pass_acceptances")
);
assert.match(relationalizeFunction, /canonical_user_rut := public\.hfc_normalize_rut\(user_rut\)/i);
assert.match(relationalizeFunction, /requested_holder_rut is distinct from canonical_user_rut/i);
assert.match(relationalizeFunction, /RUT del titular del Pase no coincide con el RUT canonico del usuario/i);
assert.match(relationalizeFunction, /new\.holder_rut := coalesce\(canonical_user_rut, requested_holder_rut\)/i);
assert.match(sql, /on conflict \(special_pass_id, ordinal\) do update/i);
assert.match(sql, /revocation_reason = 'piston_count_reduced'/i);
const pistonSyncFunction = sql.slice(
  sql.indexOf("create or replace function public.hfc_sync_special_pass_pistons"),
  sql.indexOf("create or replace function public.hfc_special_pass_sync_pistons_trigger")
);
assert.match(pistonSyncFunction, /piston_issued_at := clock_timestamp\(\)/i);
assert.match(pistonSyncFunction, /'valid',\s*piston_issued_at,[\s\S]*?piston_issued_at,\s*now\(\)/i);
assert.doesNotMatch(pistonSyncFunction, /issued_at\s*=\s*excluded\.issued_at/i);
assert.match(sql, /create or replace function public\.hfc_sync_special_pass_acceptances\b/i);
assert.match(sql, /add column if not exists document_hash_sha256\b/i);
assert.match(sql, /'upgrade_terms'::text,[\s\S]*?rules_at,[\s\S]*?rulesVersion/i);
assert.match(sql, /'not_an_entry'::text,\s*not_entry_at/i);
assert.match(sql, /'presence_conditions'::text,[\s\S]*?presence_at,[\s\S]*?presenceConditionsVersion/i);
assert.match(sql, /'privacy'::text,[\s\S]*?privacy_at,[\s\S]*?privacyTermsVersion/i);
const acceptanceFunction = sql.slice(
  sql.indexOf("create or replace function public.hfc_sync_special_pass_acceptances"),
  sql.indexOf("drop trigger if exists hfc_special_passes_relationalize_trg")
);
assert.doesNotMatch(acceptanceFunction, /payload\s*->>\s*'termsAcceptedAt'/i);
assert.match(
  acceptanceFunction,
  /on conflict \(order_id, special_pass_id, acceptance_type, document_version\) do nothing/i
);
assert.doesNotMatch(acceptanceFunction, /accepted_at\s*=\s*(least|greatest)\(/i);
assert.match(sql, /create or replace function public\.hfc_guard_order_acceptance_immutable\b/i);
assert.match(sql, /aceptaciones registradas son inmutables/i);
assert.match(sql, /misma version de una aceptacion no puede cambiar de hash/i);
assert.match(sql, /not prize_row\.presence_required[\s\S]*?pass\.attendance_status = 'present'/i);
assert.match(sql, /not prize_row\.event_entry_required[\s\S]*?pass\.entry_validation_status = 'valid'/i);
const manifestFunction = sql.slice(
  sql.indexOf("create or replace function public.hfc_create_draw_manifest"),
  sql.indexOf("revoke all on function public.hfc_create_draw_manifest")
);
assert.match(manifestFunction, /prize_row\.status <> 'scheduled'/i);
assert.match(manifestFunction, /payload ->> 'legalStatus'[\s\S]*?<> 'approved'/i);
assert.match(manifestFunction, /prize_rules_version := nullif\(prize_row\.payload ->> 'rulesVersion'/i);
assert.match(manifestFunction, /prize_rules_hash := lower\(nullif\(prize_row\.payload ->> 'rulesHash'/i);
assert.match(manifestFunction, /config_rules_hash is distinct from prize_rules_hash/i);
assert.match(manifestFunction, /join public\.hfc_orders purchase_order on purchase_order\.id = piston\.order_id/i);
assert.match(manifestFunction, /lower\(coalesce\(purchase_order\.status, ''\)\) = 'paid'/i);
assert.match(manifestFunction, /piston\.issued_at <= cutoff_at_value/i);
assert.match(manifestFunction, /payment\.created_at <= cutoff_at_value/i);
assert.match(manifestFunction, /acceptance\.acceptance_type = 'upgrade_terms'/i);
assert.match(manifestFunction, /acceptance\.document_version = prize_rules_version/i);
assert.match(manifestFunction, /acceptance\.document_hash_sha256 = prize_rules_hash/i);
assert.match(manifestFunction, /acceptance\.accepted_at <= cutoff_at_value/i);
assert.match(manifestFunction, /acceptance\.created_at <= cutoff_at_value/i);
assert.match(manifestFunction, /security definer/i);
assert.match(manifestFunction, /sealed_at = clock_timestamp\(\)/i);
assert.match(manifestFunction, /current_date < prize_row\.draw_on/i);
assert.match(manifestFunction, /No se puede crear el manifiesto antes de la fecha programada del premio/i);
const manifestGuard = sql.slice(
  sql.indexOf("create or replace function public.hfc_guard_draw_manifest"),
  sql.indexOf("drop trigger if exists hfc_draw_manifests_guard_trg")
);
assert.match(manifestGuard, /Solo hfc_create_draw_manifest puede sellar un manifiesto/i);
assert.match(manifestGuard, /actual_entries is distinct from new\.entries_count/i);
assert.match(manifestGuard, /actual_digest is distinct from new\.digest_sha256/i);
const drawEntryGuard = sql.slice(
  sql.indexOf("create or replace function public.hfc_guard_draw_entry"),
  sql.indexOf("drop trigger if exists hfc_draw_entries_guard_trg")
);
assert.match(drawEntryGuard, /old\.manifest_id[\s\S]*?status = 'sealed'/i);
assert.match(drawEntryGuard, /new\.manifest_id[\s\S]*?status = 'sealed'/i);
assert.match(drawEntryGuard, /old_manifest_is_sealed or new_manifest_is_sealed/i);
const pistonGuard = sql.slice(
  sql.indexOf("create or replace function public.hfc_guard_piston_identity"),
  sql.indexOf("drop trigger if exists hfc_pistons_identity_guard_trg")
);
for (const protectedField of ["order_id", "user_id", "campaign_id", "event_id", "issued_at", "created_at"]) {
  assert.match(pistonGuard, new RegExp(`new\\.${protectedField} is distinct from old\\.${protectedField}`, "i"));
}
assert.match(sql, /create unique index if not exists hfc_draw_results_active_prize_rank_unique[\s\S]*?\(prize_id, rank\)/i);
const drawResultFunction = sql.slice(
  sql.indexOf("create or replace function public.hfc_prepare_draw_result"),
  sql.indexOf("drop trigger if exists hfc_draw_results_prepare_trg")
);
assert.match(drawResultFunction, /where id = source_entry\.piston_id\s+for update/i);
assert.match(drawResultFunction, /source_prize\.status <> 'scheduled'/i);
assert.match(drawResultFunction, /source_manifest\.payload ->> 'rulesVersion' is distinct from source_prize\.payload ->> 'rulesVersion'/i);
assert.match(drawResultFunction, /current_date < source_prize\.draw_on/i);
assert.match(drawResultFunction, /No se puede registrar un resultado antes de la fecha programada del premio/i);
assert.match(drawResultFunction, /new\.winner_name := source_entry\.holder_name/i);
assert.match(drawResultFunction, /new\.winner_email := lower\(source_entry\.holder_email\)/i);
assert.match(drawResultFunction, /new\.winner_phone := source_entry\.holder_phone/i);
assert.doesNotMatch(drawResultFunction, /coalesce\(new\.winner_(name|email|phone)/i);
const outboxFunction = sql.slice(
  sql.indexOf("create or replace function public.hfc_enqueue_winner_notifications"),
  sql.indexOf("drop trigger if exists hfc_draw_results_notifications_trg")
);
assert.match(outboxFunction, /new\.status in \('rejected', 'expired', 'void'\)/i);
assert.match(outboxFunction, /status = 'cancelled'/i);
assert.match(outboxFunction, /status in \('pending', 'failed', 'blocked'\)/i);
assert.match(sql, /create or replace function public\.hfc_void_results_for_revoked_piston\b/i);
assert.match(sql, /'voidReason', 'piston_revoked'/i);
assert.match(sql, /presence_required,[\s\S]*?event_entry_required,[\s\S]*?false,[\s\S]*?false,[\s\S]*?true,[\s\S]*?date '2026-11-29'/i);
assert.match(sql, /\n\s*'in_person',/i);
assert.match(sql, /'notificationChannels', jsonb_build_array\('email', 'phone'\)/i);
assert.match(sql, /'active', false/i);
assert.match(sql, /'rulesPublished', false/i);
assert.doesNotMatch(sql, /'active'\s*,\s*true/i, "La migracion no debe activar ventas");
assert.doesNotMatch(sql, /'rulesPublished'\s*,\s*true/i, "La migracion no debe publicar bases");
assert.match(sql, /update public\.hfc_settings[\s\S]*?'active', false[\s\S]*?'rulesPublished', false/i);
assert.match(sql, /where not exists \([\s\S]*?id = 'special_pass_config' or type = 'special_pass'/i);
assert.match(sql, /revoke all on function public\.hfc_create_draw_manifest/i);
assert.match(sql, /revoke all on function public\.hfc_sync_special_pass_pistons\(text\) from public/i);
assert.match(sql, /revoke all on function public\.hfc_sync_special_pass_acceptances\(text\) from public/i);
assert.match(sql, /revoke update, delete on table public\.hfc_order_acceptances from service_role/i);

console.log(
  JSON.stringify({
    ok: true,
    migration: path.basename(migrationPath),
    tables: requiredTables.length,
    salesActivated: false
  })
);
