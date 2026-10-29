-- Honda Fest Chile - contrato relacional para Upgrades de experiencia y Pistones.
-- Esta migracion es deliberadamente conservadora: crea la infraestructura,
-- mantiene la configuracion comercial desactivada cuando aun no existe y no
-- sobreescribe una configuracion previa.

create extension if not exists pgcrypto;

create or replace function public.hfc_normalize_rut(input_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(input_value, ''), '[^0-9kK]', '', 'g')), '');
$$;

create or replace function public.hfc_try_timestamptz(input_value text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if nullif(btrim(input_value), '') is null then
    return null;
  end if;
  return input_value::timestamptz;
exception
  when others then
    return null;
end;
$$;

-- hfc_special_passes ya existe y sigue aceptando el payload legacy. Estas
-- columnas son una proyeccion consultable de los campos operativos esenciales.
alter table public.hfc_special_passes add column if not exists campaign_id text;
alter table public.hfc_special_passes add column if not exists event_id text;
alter table public.hfc_special_passes add column if not exists line_item_id text;
alter table public.hfc_special_passes add column if not exists level_id text;
alter table public.hfc_special_passes add column if not exists holder_rut text;
alter table public.hfc_special_passes add column if not exists holder_name text;
alter table public.hfc_special_passes add column if not exists holder_email text;
alter table public.hfc_special_passes add column if not exists holder_phone text;
alter table public.hfc_special_passes add column if not exists pickup_status text;
alter table public.hfc_special_passes add column if not exists access_status text;
alter table public.hfc_special_passes add column if not exists entry_validation_status text;
alter table public.hfc_special_passes add column if not exists attendance_status text;
alter table public.hfc_special_passes add column if not exists terms_version text;
alter table public.hfc_special_passes add column if not exists terms_accepted_at timestamptz;
alter table public.hfc_special_passes add column if not exists not_entry_accepted_at timestamptz;
alter table public.hfc_special_passes add column if not exists invalidated_at timestamptz;

create table if not exists public.hfc_order_acceptances (
  id text primary key,
  order_id text not null references public.hfc_orders(id) on delete restrict,
  user_id text references public.hfc_users(id) on delete restrict,
  special_pass_id text references public.hfc_special_passes(id) on delete restrict,
  acceptance_type text not null,
  document_version text not null,
  document_hash_sha256 text,
  accepted_at timestamptz not null default now(),
  source text not null default 'checkout',
  ip_hash text,
  user_agent_hash text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hfc_order_acceptances_type_chk check (
    acceptance_type in ('upgrade_terms', 'not_an_entry', 'privacy', 'presence_conditions', 'other')
  ),
  constraint hfc_order_acceptances_source_chk check (
    source in ('checkout', 'enrollment', 'backoffice', 'migration', 'api')
  ),
  constraint hfc_order_acceptances_document_hash_chk check (
    acceptance_type not in ('upgrade_terms', 'presence_conditions', 'privacy')
    or coalesce(document_hash_sha256, '') ~ '^[0-9a-f]{64}$'
  ),
  constraint hfc_order_acceptances_unique unique (
    order_id, special_pass_id, acceptance_type, document_version
  )
);

-- Compatibilidad con una instalacion parcial anterior de esta misma migracion.
-- Las aceptaciones de bases/condiciones nuevas solo son utilizables si quedan
-- ligadas al hash SHA-256 del documento exacto que se acepto.
alter table public.hfc_order_acceptances
  add column if not exists document_hash_sha256 text;

alter table public.hfc_order_acceptances
  drop constraint if exists hfc_order_acceptances_unique;
alter table public.hfc_order_acceptances
  add constraint hfc_order_acceptances_unique unique (
    order_id, special_pass_id, acceptance_type, document_version
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.hfc_order_acceptances'::regclass
      and conname = 'hfc_order_acceptances_document_hash_chk'
  ) then
    alter table public.hfc_order_acceptances
      add constraint hfc_order_acceptances_document_hash_chk
      check (
        acceptance_type not in ('upgrade_terms', 'presence_conditions', 'privacy')
        or coalesce(document_hash_sha256, '') ~ '^[0-9a-f]{64}$'
      ) not valid;
  end if;
end;
$$;

create table if not exists public.hfc_pistons (
  id text primary key,
  special_pass_id text not null references public.hfc_special_passes(id) on delete restrict,
  order_id text,
  user_id text,
  campaign_id text,
  event_id text,
  ordinal integer not null,
  code text not null,
  holder_rut text not null,
  status text not null default 'valid',
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revocation_reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hfc_pistons_ordinal_chk check (ordinal > 0 and ordinal <= 999),
  constraint hfc_pistons_code_nonempty_chk check (btrim(code) <> ''),
  constraint hfc_pistons_rut_chk check (
    holder_rut = public.hfc_normalize_rut(holder_rut)
    and holder_rut ~ '^[0-9]{6,8}[0-9K]$'
  ),
  constraint hfc_pistons_status_chk check (status in ('valid', 'revoked')),
  constraint hfc_pistons_pass_ordinal_unique unique (special_pass_id, ordinal),
  constraint hfc_pistons_code_unique unique (code)
);

create table if not exists public.hfc_special_prizes (
  id text primary key,
  campaign_id text not null,
  event_id text not null,
  code text not null unique,
  name text not null,
  description text,
  prize_type text not null default 'other',
  draw_mode text not null default 'in_person',
  presence_required boolean not null default true,
  event_entry_required boolean not null default true,
  include_all_valid_pistons boolean not null default true,
  draw_on date,
  status text not null default 'draft',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hfc_special_prizes_type_chk check (prize_type in ('automobile', 'onsite', 'experience', 'other')),
  constraint hfc_special_prizes_draw_mode_chk check (draw_mode in ('in_person', 'audited_manual')),
  constraint hfc_special_prizes_status_chk check (status in ('draft', 'scheduled', 'drawn', 'cancelled'))
);

create table if not exists public.hfc_draw_manifests (
  id text primary key,
  prize_id text not null references public.hfc_special_prizes(id) on delete restrict,
  version integer not null,
  status text not null default 'draft',
  source_cutoff_at timestamptz not null default now(),
  entries_count integer not null default 0,
  digest_sha256 text,
  created_by text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sealed_at timestamptz,
  constraint hfc_draw_manifests_version_chk check (version > 0),
  constraint hfc_draw_manifests_entries_count_chk check (entries_count >= 0),
  constraint hfc_draw_manifests_digest_chk check (
    digest_sha256 is null or digest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint hfc_draw_manifests_status_chk check (status in ('draft', 'sealed', 'cancelled')),
  constraint hfc_draw_manifests_prize_version_unique unique (prize_id, version)
);

create table if not exists public.hfc_draw_entries (
  id text primary key,
  manifest_id text not null references public.hfc_draw_manifests(id) on delete cascade,
  piston_id text not null references public.hfc_pistons(id) on delete restrict,
  entry_position integer not null,
  piston_code text not null,
  holder_rut text not null,
  holder_name text,
  holder_email text,
  holder_phone text,
  eligibility_status text not null default 'eligible',
  ineligibility_reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint hfc_draw_entries_position_chk check (entry_position > 0),
  constraint hfc_draw_entries_rut_chk check (
    holder_rut = public.hfc_normalize_rut(holder_rut)
    and holder_rut ~ '^[0-9]{6,8}[0-9K]$'
  ),
  constraint hfc_draw_entries_eligibility_chk check (eligibility_status in ('eligible', 'ineligible')),
  constraint hfc_draw_entries_manifest_piston_unique unique (manifest_id, piston_id),
  constraint hfc_draw_entries_manifest_position_unique unique (manifest_id, entry_position)
);

create table if not exists public.hfc_draw_results (
  id text primary key,
  manifest_id text not null references public.hfc_draw_manifests(id) on delete restrict,
  prize_id text not null references public.hfc_special_prizes(id) on delete restrict,
  draw_entry_id text not null references public.hfc_draw_entries(id) on delete restrict,
  piston_id text not null references public.hfc_pistons(id) on delete restrict,
  winner_rut text not null,
  winner_name text,
  winner_email text,
  winner_phone text,
  rank integer not null default 1,
  status text not null default 'selected',
  selected_at timestamptz not null default now(),
  confirmed_at timestamptz,
  claim_deadline_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hfc_draw_results_rank_chk check (rank > 0),
  constraint hfc_draw_results_rut_chk check (
    winner_rut = public.hfc_normalize_rut(winner_rut)
    and winner_rut ~ '^[0-9]{6,8}[0-9K]$'
  ),
  constraint hfc_draw_results_status_chk check (
    status in ('selected', 'contacting', 'confirmed', 'accepted', 'rejected', 'expired', 'void')
  ),
  constraint hfc_draw_results_manifest_rank_unique unique (manifest_id, rank),
  constraint hfc_draw_results_manifest_entry_unique unique (manifest_id, draw_entry_id)
);

create table if not exists public.hfc_notification_outbox (
  id text primary key,
  draw_result_id text references public.hfc_draw_results(id) on delete restrict,
  order_id text references public.hfc_orders(id) on delete restrict,
  user_id text references public.hfc_users(id) on delete restrict,
  channel text not null,
  recipient text,
  template_type text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  sent_at timestamptz,
  last_error text,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hfc_notification_outbox_channel_chk check (channel in ('email', 'phone', 'sms', 'whatsapp')),
  constraint hfc_notification_outbox_status_chk check (
    status in ('pending', 'processing', 'sent', 'failed', 'blocked', 'cancelled')
  ),
  constraint hfc_notification_outbox_attempts_chk check (
    attempt_count >= 0 and max_attempts > 0 and attempt_count <= max_attempts
  )
);

alter table public.hfc_order_acceptances enable row level security;
alter table public.hfc_pistons enable row level security;
alter table public.hfc_special_prizes enable row level security;
alter table public.hfc_draw_manifests enable row level security;
alter table public.hfc_draw_entries enable row level security;
alter table public.hfc_draw_results enable row level security;
alter table public.hfc_notification_outbox enable row level security;

create index if not exists hfc_special_passes_holder_rut_idx on public.hfc_special_passes(holder_rut);
create index if not exists hfc_special_passes_campaign_status_idx on public.hfc_special_passes(campaign_id, status);
create index if not exists hfc_payments_order_idx on public.hfc_payments(order_id);
create index if not exists hfc_order_acceptances_order_idx on public.hfc_order_acceptances(order_id, accepted_at desc);
create index if not exists hfc_order_acceptances_pass_idx on public.hfc_order_acceptances(special_pass_id);
create index if not exists hfc_pistons_holder_rut_idx on public.hfc_pistons(holder_rut, status);
create index if not exists hfc_pistons_order_idx on public.hfc_pistons(order_id);
create index if not exists hfc_pistons_user_idx on public.hfc_pistons(user_id);
create index if not exists hfc_pistons_campaign_status_idx on public.hfc_pistons(campaign_id, status);
create index if not exists hfc_special_prizes_campaign_status_idx on public.hfc_special_prizes(campaign_id, status);
create index if not exists hfc_draw_manifests_prize_status_idx on public.hfc_draw_manifests(prize_id, status);
create index if not exists hfc_draw_entries_piston_idx on public.hfc_draw_entries(piston_id);
create index if not exists hfc_draw_entries_manifest_eligibility_idx on public.hfc_draw_entries(manifest_id, eligibility_status);
create index if not exists hfc_draw_results_prize_status_idx on public.hfc_draw_results(prize_id, status);
create unique index if not exists hfc_draw_results_active_prize_rank_unique
  on public.hfc_draw_results(prize_id, rank)
  where status in ('selected', 'contacting', 'confirmed', 'accepted');
create index if not exists hfc_notification_outbox_dispatch_idx
  on public.hfc_notification_outbox(status, available_at, created_at)
  where status in ('pending', 'failed');
create index if not exists hfc_notification_outbox_result_idx on public.hfc_notification_outbox(draw_result_id);

-- Proyecta payload legacy a columnas relacionales sin exigir que el servidor
-- cambie el formato de escritura en la misma liberacion.
create or replace function public.hfc_special_pass_relationalize()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  source_payload jsonb := coalesce(new.payload, '{}'::jsonb);
  user_rut text;
  canonical_user_rut text;
  requested_holder_rut text;
  user_name text;
  user_email text;
  user_phone text;
begin
  if new.user_id is not null then
    select
      coalesce(nullif(u.rut, ''), nullif(u.payload ->> 'rut', '')),
      nullif(u.payload ->> 'name', ''),
      coalesce(nullif(u.email, ''), nullif(u.payload ->> 'email', '')),
      nullif(u.payload ->> 'phone', '')
    into user_rut, user_name, user_email, user_phone
    from public.hfc_users u
    where u.id = new.user_id;
  end if;

  new.campaign_id := coalesce(nullif(source_payload ->> 'campaignId', ''), nullif(new.campaign_id, ''));
  new.event_id := coalesce(nullif(source_payload ->> 'eventId', ''), nullif(new.event_id, ''));
  new.line_item_id := coalesce(nullif(source_payload ->> 'lineItemId', ''), nullif(new.line_item_id, ''));
  new.level_id := coalesce(nullif(source_payload ->> 'levelId', ''), nullif(new.level_id, ''));
  canonical_user_rut := public.hfc_normalize_rut(user_rut);
  requested_holder_rut := public.hfc_normalize_rut(
    coalesce(nullif(source_payload ->> 'holderRut', ''), nullif(new.holder_rut, ''))
  );
  if canonical_user_rut is not null
     and requested_holder_rut is not null
     and requested_holder_rut is distinct from canonical_user_rut then
    raise exception 'El RUT del titular del Pase no coincide con el RUT canonico del usuario';
  end if;
  new.holder_rut := coalesce(canonical_user_rut, requested_holder_rut);
  new.holder_name := coalesce(nullif(source_payload ->> 'holderName', ''), nullif(new.holder_name, ''), user_name);
  new.holder_email := lower(coalesce(
    nullif(source_payload ->> 'holderEmail', ''),
    nullif(new.holder_email, ''),
    user_email
  ));
  new.holder_phone := coalesce(nullif(source_payload ->> 'holderPhone', ''), nullif(new.holder_phone, ''), user_phone);
  new.pickup_status := coalesce(nullif(source_payload ->> 'pickupStatus', ''), nullif(new.pickup_status, ''), 'pending');
  new.access_status := coalesce(nullif(source_payload ->> 'accessStatus', ''), nullif(new.access_status, ''), 'not_checked_in');
  new.entry_validation_status := case lower(coalesce(
    nullif(source_payload ->> 'entryValidationStatus', ''),
    nullif(new.entry_validation_status, ''),
    'not_checked'
  ))
    when 'valid' then 'valid'
    when 'validated' then 'valid'
    when 'invalid' then 'invalid'
    else 'not_checked'
  end;
  new.attendance_status := case lower(coalesce(
    nullif(source_payload ->> 'attendanceStatus', ''),
    nullif(new.attendance_status, ''),
    nullif(source_payload ->> 'accessStatus', ''),
    nullif(new.access_status, ''),
    'not_checked_in'
  ))
    when 'present' then 'present'
    when 'checked_in' then 'present'
    when 'absent' then 'absent'
    else 'not_checked_in'
  end;
  new.terms_version := coalesce(
    nullif(source_payload ->> 'rulesVersion', ''),
    nullif(new.terms_version, '')
  );
  new.terms_accepted_at := coalesce(
    public.hfc_try_timestamptz(source_payload ->> 'rulesAcceptedAt'),
    new.terms_accepted_at
  );
  new.not_entry_accepted_at := coalesce(
    public.hfc_try_timestamptz(source_payload ->> 'notEntryAcceptedAt'),
    new.not_entry_accepted_at
  );

  if lower(coalesce(new.status, '')) in ('invalid', 'revoked', 'cancelled', 'refunded', 'void', 'expired', 'rejected', 'chargeback', 'chargebacked') then
    new.invalidated_at := coalesce(new.invalidated_at, now());
  elsif lower(coalesce(new.status, '')) in ('valid', 'active', 'issued', 'picked_up', 'checked_in') then
    new.invalidated_at := null;
  end if;

  return new;
end;
$$;

-- Convierte aceptaciones explicitas y versionadas del payload a evidencia
-- relacional. termsAcceptedAt es un campo legacy generico y nunca acredita por
-- si solo las bases del Upgrade ni las condiciones de presencia.
create or replace function public.hfc_sync_special_pass_acceptances(pass_id_value text)
returns void
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  pass_row public.hfc_special_passes%rowtype;
  rules_at timestamptz;
  not_entry_at timestamptz;
  presence_at timestamptz;
  privacy_at timestamptz;
  acceptance_type_value text;
  accepted_at_value timestamptz;
  acceptance_version_value text;
  acceptance_hash_value text;
  acceptance_source_value text;
  acceptance_user_id text;
begin
  select * into pass_row
  from public.hfc_special_passes
  where id = pass_id_value;

  if not found
     or pass_row.order_id is null
     or not exists (select 1 from public.hfc_orders where id = pass_row.order_id) then
    return;
  end if;

  acceptance_user_id := case
    when exists (select 1 from public.hfc_users where id = pass_row.user_id) then pass_row.user_id
    else null
  end;

  rules_at := public.hfc_try_timestamptz(pass_row.payload ->> 'rulesAcceptedAt');
  not_entry_at := coalesce(
    pass_row.not_entry_accepted_at,
    public.hfc_try_timestamptz(pass_row.payload ->> 'notEntryAcceptedAt')
  );
  presence_at := public.hfc_try_timestamptz(pass_row.payload ->> 'presenceConditionsAcceptedAt');
  privacy_at := public.hfc_try_timestamptz(pass_row.payload ->> 'privacyAcceptedAt');
  acceptance_source_value := case lower(coalesce(nullif(pass_row.payload ->> 'acceptanceSource', ''), 'checkout'))
    when 'enrollment' then 'enrollment'
    when 'backoffice' then 'backoffice'
    when 'migration' then 'migration'
    when 'api' then 'api'
    else 'checkout'
  end;

  for acceptance_type_value, accepted_at_value, acceptance_version_value, acceptance_hash_value in
    select * from (values
      (
        'upgrade_terms'::text,
        rules_at,
        nullif(pass_row.payload ->> 'rulesVersion', ''),
        lower(coalesce(
          nullif(pass_row.payload ->> 'rulesHash', ''),
          nullif(pass_row.payload ->> 'rulesDocumentHash', '')
        ))
      ),
      (
        'not_an_entry'::text,
        not_entry_at,
        coalesce(
          nullif(pass_row.payload ->> 'notEntryNoticeVersion', ''),
          'not-entry-notice-2026-v1'
        ),
        lower(nullif(pass_row.payload ->> 'notEntryNoticeHash', ''))
      ),
      (
        'presence_conditions'::text,
        presence_at,
        coalesce(
          nullif(pass_row.payload ->> 'presenceConditionsVersion', ''),
          nullif(pass_row.payload ->> 'rulesVersion', '')
        ),
        lower(coalesce(
          nullif(pass_row.payload ->> 'presenceConditionsHash', ''),
          case
            when coalesce(
              nullif(pass_row.payload ->> 'presenceConditionsVersion', ''),
              nullif(pass_row.payload ->> 'rulesVersion', '')
            ) = nullif(pass_row.payload ->> 'rulesVersion', '')
            then coalesce(
              nullif(pass_row.payload ->> 'rulesHash', ''),
              nullif(pass_row.payload ->> 'rulesDocumentHash', '')
            )
          end
        ))
      ),
      (
        'privacy'::text,
        privacy_at,
        nullif(pass_row.payload ->> 'privacyTermsVersion', ''),
        lower(coalesce(
          nullif(pass_row.payload ->> 'privacyTermsHash', ''),
          nullif(pass_row.payload ->> 'privacyHash', '')
        ))
      )
    ) accepted(acceptance_type, accepted_at, document_version, document_hash_sha256)
    where accepted.accepted_at is not null
      and accepted.document_version is not null
      and (
        accepted.acceptance_type = 'not_an_entry'
        or accepted.document_hash_sha256 ~ '^[0-9a-f]{64}$'
      )
  loop
    insert into public.hfc_order_acceptances (
      id,
      order_id,
      user_id,
      special_pass_id,
      acceptance_type,
      document_version,
      document_hash_sha256,
      accepted_at,
      source,
      payload,
      created_at,
      updated_at
    ) values (
      pass_row.id || ':acceptance:' || acceptance_type_value || ':' || left(md5(acceptance_version_value), 12),
      pass_row.order_id,
      acceptance_user_id,
      pass_row.id,
      acceptance_type_value,
      acceptance_version_value,
      acceptance_hash_value,
      accepted_at_value,
      acceptance_source_value,
      jsonb_build_object('source', 'hfc_special_passes_trigger'),
      now(),
      now()
    )
    on conflict (order_id, special_pass_id, acceptance_type, document_version) do nothing;
  end loop;
end;
$$;

-- La evidencia legal es append-only. Una nueva aceptacion usa otra version;
-- ni service_role ni un reintento pueden reescribir o borrar la primera fila.
create or replace function public.hfc_guard_order_acceptance_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  existing_hash text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'Las aceptaciones registradas son inmutables; registre una nueva version';
  end if;

  if new.acceptance_type in ('upgrade_terms', 'presence_conditions', 'privacy')
     and coalesce(new.document_hash_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'La aceptacion versionada requiere el hash SHA-256 del documento';
  end if;

  select acceptance.document_hash_sha256
  into existing_hash
  from public.hfc_order_acceptances acceptance
  where acceptance.order_id = new.order_id
    and acceptance.special_pass_id is not distinct from new.special_pass_id
    and acceptance.acceptance_type = new.acceptance_type
    and acceptance.document_version = new.document_version
  limit 1;

  if found and existing_hash is distinct from new.document_hash_sha256 then
    raise exception 'La misma version de una aceptacion no puede cambiar de hash';
  end if;

  new.document_hash_sha256 := lower(new.document_hash_sha256);
  new.created_at := statement_timestamp();
  new.updated_at := new.created_at;

  return new;
end;
$$;

drop trigger if exists hfc_order_acceptances_immutable_trg on public.hfc_order_acceptances;
create trigger hfc_order_acceptances_immutable_trg
before insert or update or delete on public.hfc_order_acceptances
for each row execute function public.hfc_guard_order_acceptance_immutable();

drop trigger if exists hfc_special_passes_relationalize_trg on public.hfc_special_passes;
create trigger hfc_special_passes_relationalize_trg
before insert or update on public.hfc_special_passes
for each row execute function public.hfc_special_pass_relationalize();

-- Sincronizacion transaccional: una fila por Pistón. Nunca elimina Pistones;
-- si el pase deja de ser valido o reduce su nivel, los excedentes se revocan.
create or replace function public.hfc_sync_special_pass_pistons(pass_id_value text)
returns void
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  pass_row public.hfc_special_passes%rowtype;
  normalized_rut text;
  expected_count integer;
  piston_ordinal integer;
  piston_code text;
  piston_issued_at timestamptz;
  pass_is_valid boolean;
begin
  select *
  into pass_row
  from public.hfc_special_passes
  where id = pass_id_value
  for update;

  if not found then
    return;
  end if;

  normalized_rut := public.hfc_normalize_rut(
    coalesce(nullif(pass_row.holder_rut, ''), nullif(pass_row.payload ->> 'holderRut', ''))
  );
  expected_count := greatest(0, least(999, coalesce(pass_row.piston_count, 0)));
  pass_is_valid := lower(coalesce(pass_row.status, '')) in ('valid', 'active', 'issued', 'picked_up', 'checked_in');

  if not pass_is_valid
     or expected_count = 0
     or normalized_rut is null
     or normalized_rut !~ '^[0-9]{6,8}[0-9K]$' then
    update public.hfc_pistons
    set
      status = 'revoked',
      revoked_at = coalesce(revoked_at, now()),
      revocation_reason = case
        when not pass_is_valid then 'special_pass_not_valid'
        when expected_count = 0 then 'special_pass_without_pistons'
        else 'holder_rut_missing_or_invalid'
      end,
      updated_at = now()
    where special_pass_id = pass_row.id
      and status <> 'revoked';
    return;
  end if;

  for piston_ordinal in 1..expected_count loop
    piston_issued_at := clock_timestamp();
    piston_code := nullif(btrim(pass_row.payload -> 'drawEntryCodes' ->> (piston_ordinal - 1)), '');
    if piston_code is null then
      piston_code := coalesce(nullif(pass_row.code, ''), pass_row.id)
        || '-P' || lpad(piston_ordinal::text, 2, '0');
    end if;

    insert into public.hfc_pistons (
      id,
      special_pass_id,
      order_id,
      user_id,
      campaign_id,
      event_id,
      ordinal,
      code,
      holder_rut,
      status,
      issued_at,
      revoked_at,
      revocation_reason,
      payload,
      created_at,
      updated_at
    ) values (
      pass_row.id || ':piston:' || lpad(piston_ordinal::text, 3, '0'),
      pass_row.id,
      pass_row.order_id,
      pass_row.user_id,
      pass_row.campaign_id,
      pass_row.event_id,
      piston_ordinal,
      piston_code,
      normalized_rut,
      'valid',
      piston_issued_at,
      null,
      null,
      jsonb_build_object('source', 'hfc_special_passes_trigger'),
      piston_issued_at,
      now()
    )
    on conflict (special_pass_id, ordinal) do update
    set
      order_id = excluded.order_id,
      user_id = excluded.user_id,
      campaign_id = excluded.campaign_id,
      event_id = excluded.event_id,
      code = excluded.code,
      holder_rut = excluded.holder_rut,
      status = 'valid',
      revoked_at = null,
      revocation_reason = null,
      updated_at = now();
  end loop;

  update public.hfc_pistons
  set
    status = 'revoked',
    revoked_at = coalesce(revoked_at, now()),
    revocation_reason = 'piston_count_reduced',
    updated_at = now()
  where special_pass_id = pass_row.id
    and ordinal > expected_count
    and status <> 'revoked';
end;
$$;

create or replace function public.hfc_special_pass_sync_pistons_trigger()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  perform public.hfc_sync_special_pass_pistons(new.id);
  perform public.hfc_sync_special_pass_acceptances(new.id);
  return new;
end;
$$;

drop trigger if exists hfc_special_passes_sync_pistons_trg on public.hfc_special_passes;
create trigger hfc_special_passes_sync_pistons_trg
after insert or update of order_id, user_id, code, status, piston_count, payload, campaign_id, event_id, holder_rut,
  terms_version, terms_accepted_at, not_entry_accepted_at
on public.hfc_special_passes
for each row execute function public.hfc_special_pass_sync_pistons_trigger();

-- Protege identidad de Pistones que ya forman parte de un manifiesto sellado.
create or replace function public.hfc_guard_piston_identity()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and (
       new.issued_at is distinct from old.issued_at
       or new.created_at is distinct from old.created_at
     ) then
    raise exception 'Las fechas de emision y creacion de un Piston son inmutables';
  end if;

  if exists (
    select 1
    from public.hfc_draw_entries entry
    join public.hfc_draw_manifests manifest on manifest.id = entry.manifest_id
    where entry.piston_id = old.id
      and manifest.status = 'sealed'
  ) then
    if tg_op = 'DELETE'
       or new.special_pass_id is distinct from old.special_pass_id
       or new.ordinal is distinct from old.ordinal
       or new.code is distinct from old.code
       or new.holder_rut is distinct from old.holder_rut
       or new.order_id is distinct from old.order_id
       or new.user_id is distinct from old.user_id
       or new.campaign_id is distinct from old.campaign_id
       or new.event_id is distinct from old.event_id then
      raise exception 'No se puede alterar la identidad de un Piston incluido en un manifiesto sellado';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists hfc_pistons_identity_guard_trg on public.hfc_pistons;
create trigger hfc_pistons_identity_guard_trg
before update or delete on public.hfc_pistons
for each row execute function public.hfc_guard_piston_identity();

-- Un reembolso/chargeback que revoca el Piston invalida cualquier resultado
-- aun activo en la misma transaccion. El UPDATE del resultado activa a su vez
-- la cancelacion idempotente del outbox.
create or replace function public.hfc_void_results_for_revoked_piston()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.status = 'valid' and new.status = 'revoked' then
    update public.hfc_draw_results
    set
      status = 'void',
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'voidReason', 'piston_revoked',
        'pistonRevocationReason', new.revocation_reason,
        'voidedAt', coalesce(new.revoked_at, now())
      ),
      updated_at = now()
    where piston_id = new.id
      and status in ('selected', 'contacting', 'confirmed', 'accepted');
  end if;
  return new;
end;
$$;

drop trigger if exists hfc_pistons_void_results_trg on public.hfc_pistons;
create trigger hfc_pistons_void_results_trg
after update of status on public.hfc_pistons
for each row execute function public.hfc_void_results_for_revoked_piston();

-- Un manifiesto sellado y sus entradas son inmutables.
create or replace function public.hfc_guard_draw_manifest()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  manifest_function_owner text;
  actual_entries integer;
  actual_digest text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'sealed' then
      raise exception 'Un manifiesto no puede insertarse directamente como sellado';
    end if;
    return new;
  end if;

  if old.status = 'sealed' then
    raise exception 'Un manifiesto sellado es inmutable';
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.prize_id is distinct from old.prize_id
       or new.version is distinct from old.version
       or new.source_cutoff_at is distinct from old.source_cutoff_at
       or new.created_at is distinct from old.created_at then
      raise exception 'La identidad y fecha de corte del manifiesto son inmutables';
    end if;

    if new.status = 'sealed' then
      select pg_get_userbyid(proc.proowner)
      into manifest_function_owner
      from pg_proc proc
      where proc.oid = to_regprocedure('public.hfc_create_draw_manifest(text,text,jsonb)');

      if current_user::text is distinct from manifest_function_owner then
        raise exception 'Solo hfc_create_draw_manifest puede sellar un manifiesto';
      end if;
      if old.status <> 'draft'
         or new.sealed_at is null
         or new.source_cutoff_at > new.sealed_at
         or new.entries_count <= 0
         or coalesce(new.digest_sha256, '') !~ '^[0-9a-f]{64}$'
         or nullif(new.payload ->> 'rulesVersion', '') is null
         or coalesce(new.payload ->> 'rulesHash', '') !~ '^[0-9a-f]{64}$' then
        raise exception 'El manifiesto no tiene corte, bases, conteo y digest coherentes';
      end if;

      select
        count(*)::integer,
        encode(
          digest(
            string_agg(
              entry_position::text || ':' || piston_code || ':' || holder_rut,
              E'\n' order by entry_position
            ),
            'sha256'
          ),
          'hex'
        )
      into actual_entries, actual_digest
      from public.hfc_draw_entries
      where manifest_id = new.id;

      if actual_entries is distinct from new.entries_count
         or actual_digest is distinct from new.digest_sha256 then
        raise exception 'El conteo o digest no coincide con las entradas del manifiesto';
      end if;
    elsif new.entries_count is distinct from old.entries_count
       or new.digest_sha256 is distinct from old.digest_sha256
       or new.sealed_at is distinct from old.sealed_at then
      raise exception 'Conteo, digest y fecha de sellado solo se fijan al sellar';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists hfc_draw_manifests_guard_trg on public.hfc_draw_manifests;
create trigger hfc_draw_manifests_guard_trg
before insert or update or delete on public.hfc_draw_manifests
for each row execute function public.hfc_guard_draw_manifest();

create or replace function public.hfc_guard_draw_entry()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  old_manifest_is_sealed boolean := false;
  new_manifest_is_sealed boolean := false;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select exists (
      select 1 from public.hfc_draw_manifests
      where id = old.manifest_id and status = 'sealed'
    ) into old_manifest_is_sealed;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select exists (
      select 1 from public.hfc_draw_manifests
      where id = new.manifest_id and status = 'sealed'
    ) into new_manifest_is_sealed;
  end if;

  if old_manifest_is_sealed or new_manifest_is_sealed then
    raise exception 'Las entradas de un manifiesto sellado son inmutables';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists hfc_draw_entries_guard_trg on public.hfc_draw_entries;
create trigger hfc_draw_entries_guard_trg
before insert or update or delete on public.hfc_draw_entries
for each row execute function public.hfc_guard_draw_entry();

-- Crea y sella una foto auditable de todos los Pistones validos del premio.
create or replace function public.hfc_create_draw_manifest(
  prize_id_value text,
  created_by_value text default null,
  payload_value jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, extensions, public, pg_temp
as $$
declare
  prize_row public.hfc_special_prizes%rowtype;
  draw_config jsonb;
  manifest_id_value text;
  next_version integer;
  entry_total integer;
  manifest_digest text;
  prize_rules_version text;
  prize_rules_hash text;
  config_rules_version text;
  config_rules_hash text;
  cutoff_at_value timestamptz := statement_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('hfc_draw_manifest:' || prize_id_value, 0));

  select * into prize_row
  from public.hfc_special_prizes
  where id = prize_id_value
  for share;

  if not found then
    raise exception 'Premio inexistente: %', prize_id_value;
  end if;
  prize_rules_version := nullif(prize_row.payload ->> 'rulesVersion', '');
  prize_rules_hash := lower(nullif(prize_row.payload ->> 'rulesHash', ''));
  if prize_row.status <> 'scheduled'
     or coalesce(prize_row.payload ->> 'legalStatus', '') <> 'approved'
     or prize_rules_version is null
     or coalesce(prize_rules_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'El premio no esta programado con bases aprobadas, versionadas y hasheadas';
  end if;
  if prize_row.draw_on is null or current_date < prize_row.draw_on then
    raise exception 'No se puede crear el manifiesto antes de la fecha programada del premio';
  end if;
  if not prize_row.include_all_valid_pistons then
    raise exception 'El premio requiere una seleccion explicita de Pistones';
  end if;

  select settings.payload
  into draw_config
  from public.hfc_settings settings
  where settings.id = 'special_pass_config' or settings.type = 'special_pass'
  order by (settings.id = 'special_pass_config') desc
  limit 1
  for share;

  config_rules_version := nullif(draw_config ->> 'rulesVersion', '');
  config_rules_hash := lower(nullif(draw_config ->> 'rulesHash', ''));
  if draw_config is null
     or coalesce(draw_config ->> 'rulesPublished', 'false') <> 'true'
     or config_rules_version is distinct from prize_rules_version
     or config_rules_hash is distinct from prize_rules_hash then
    raise exception 'Las bases aprobadas del premio no coinciden con la configuracion publicada';
  end if;

  select coalesce(max(version), 0) + 1
  into next_version
  from public.hfc_draw_manifests
  where prize_id = prize_row.id;

  manifest_id_value := 'manifest_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.hfc_draw_manifests (
    id, prize_id, version, status, source_cutoff_at, created_by, payload
  ) values (
    manifest_id_value,
    prize_row.id,
    next_version,
    'draft',
    cutoff_at_value,
    created_by_value,
    coalesce(payload_value, '{}'::jsonb) || jsonb_build_object(
      'rulesVersion', prize_rules_version,
      'rulesHash', prize_rules_hash,
      'prizeStatusAtSeal', prize_row.status
    )
  );

  insert into public.hfc_draw_entries (
    id,
    manifest_id,
    piston_id,
    entry_position,
    piston_code,
    holder_rut,
    holder_name,
    holder_email,
    holder_phone,
    eligibility_status,
    payload
  )
  select
    'entry_' || replace(gen_random_uuid()::text, '-', ''),
    manifest_id_value,
    selected.id,
    selected.entry_position,
    selected.code,
    selected.holder_rut,
    selected.holder_name,
    selected.holder_email,
    selected.holder_phone,
    'eligible',
    jsonb_build_object('specialPassId', selected.special_pass_id)
  from (
    select
      piston.id,
      piston.special_pass_id,
      piston.code,
      piston.holder_rut,
      pass.holder_name,
      pass.holder_email,
      pass.holder_phone,
      row_number() over (order by piston.code, piston.id)::integer as entry_position
    from public.hfc_pistons piston
    join public.hfc_special_passes pass on pass.id = piston.special_pass_id
    join public.hfc_orders purchase_order on purchase_order.id = piston.order_id
    where piston.status = 'valid'
      and piston.issued_at <= cutoff_at_value
      and lower(coalesce(purchase_order.status, '')) = 'paid'
      and piston.campaign_id = prize_row.campaign_id
      and piston.event_id = prize_row.event_id
      and exists (
        select 1
        from public.hfc_payments payment
        where payment.order_id = purchase_order.id
          and lower(coalesce(payment.payload ->> 'status', '')) in ('approved', 'paid')
          and payment.created_at <= cutoff_at_value
          and coalesce(
            public.hfc_try_timestamptz(payment.payload ->> 'paidAt'),
            payment.created_at
          ) <= cutoff_at_value
      )
      and exists (
        select 1
        from public.hfc_order_acceptances acceptance
        where acceptance.order_id = purchase_order.id
          and acceptance.special_pass_id = pass.id
          and acceptance.acceptance_type = 'upgrade_terms'
          and acceptance.document_version = prize_rules_version
          and acceptance.document_hash_sha256 = prize_rules_hash
          and acceptance.accepted_at <= cutoff_at_value
          and acceptance.created_at <= cutoff_at_value
      )
      and (
        not prize_row.presence_required
        or pass.attendance_status = 'present'
        or pass.access_status = 'checked_in'
      )
      and (
        not prize_row.event_entry_required
        or pass.entry_validation_status = 'valid'
      )
  ) selected;

  get diagnostics entry_total = row_count;
  if entry_total = 0 then
    raise exception 'No hay Pistones elegibles para crear el manifiesto';
  end if;

  select encode(
    digest(
      string_agg(
        entry_position::text || ':' || piston_code || ':' || holder_rut,
        E'\n' order by entry_position
      ),
      'sha256'
    ),
    'hex'
  )
  into manifest_digest
  from public.hfc_draw_entries
  where manifest_id = manifest_id_value;

  update public.hfc_draw_manifests
  set
    status = 'sealed',
    entries_count = entry_total,
    digest_sha256 = manifest_digest,
    sealed_at = clock_timestamp()
  where id = manifest_id_value;

  return manifest_id_value;
end;
$$;

-- Los hechos del resultado se copian desde la entrada sellada; el llamador no
-- puede mezclar premio, manifiesto, Pistón o RUT.
create or replace function public.hfc_prepare_draw_result()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  source_entry public.hfc_draw_entries%rowtype;
  source_manifest public.hfc_draw_manifests%rowtype;
  source_prize public.hfc_special_prizes%rowtype;
  current_piston_status text;
begin
  if tg_op = 'UPDATE' then
    if new.manifest_id is distinct from old.manifest_id
       or new.prize_id is distinct from old.prize_id
       or new.draw_entry_id is distinct from old.draw_entry_id
       or new.piston_id is distinct from old.piston_id
       or new.winner_rut is distinct from old.winner_rut
       or new.winner_name is distinct from old.winner_name
       or new.winner_email is distinct from old.winner_email
       or new.winner_phone is distinct from old.winner_phone
       or new.rank is distinct from old.rank
       or new.selected_at is distinct from old.selected_at then
      raise exception 'Los hechos de un resultado de sorteo son inmutables';
    end if;
    if old.status in ('rejected', 'expired', 'void') and new.status is distinct from old.status then
      raise exception 'Un resultado terminal no puede reactivarse';
    end if;
    new.updated_at := now();
    return new;
  end if;

  select * into source_entry
  from public.hfc_draw_entries
  where id = new.draw_entry_id;
  if not found then
    raise exception 'Entrada de sorteo inexistente';
  end if;

  select * into source_manifest
  from public.hfc_draw_manifests
  where id = source_entry.manifest_id;
  if source_manifest.status <> 'sealed' then
    raise exception 'El resultado requiere un manifiesto sellado';
  end if;

  select * into source_prize
  from public.hfc_special_prizes
  where id = source_manifest.prize_id
  for share;
  if not found
     or source_prize.status <> 'scheduled'
     or coalesce(source_prize.payload ->> 'legalStatus', '') <> 'approved'
     or nullif(source_prize.payload ->> 'rulesVersion', '') is null
     or coalesce(source_prize.payload ->> 'rulesHash', '') !~ '^[0-9a-f]{64}$'
     or source_manifest.payload ->> 'rulesVersion' is distinct from source_prize.payload ->> 'rulesVersion'
     or source_manifest.payload ->> 'rulesHash' is distinct from source_prize.payload ->> 'rulesHash' then
    raise exception 'El premio no esta programado con las mismas bases aprobadas del manifiesto';
  end if;
  if source_prize.draw_on is null or current_date < source_prize.draw_on then
    raise exception 'No se puede registrar un resultado antes de la fecha programada del premio';
  end if;
  if source_entry.eligibility_status <> 'eligible' then
    raise exception 'La entrada seleccionada no es elegible';
  end if;

  select status into current_piston_status
  from public.hfc_pistons
  where id = source_entry.piston_id
  for update;
  if current_piston_status <> 'valid' then
    raise exception 'El Piston seleccionado ya no esta vigente';
  end if;

  new.manifest_id := source_entry.manifest_id;
  new.prize_id := source_manifest.prize_id;
  new.piston_id := source_entry.piston_id;
  new.winner_rut := source_entry.holder_rut;
  new.winner_name := source_entry.holder_name;
  new.winner_email := lower(source_entry.holder_email);
  new.winner_phone := source_entry.holder_phone;
  new.updated_at := coalesce(new.updated_at, now());
  return new;
end;
$$;

drop trigger if exists hfc_draw_results_prepare_trg on public.hfc_draw_results;
create trigger hfc_draw_results_prepare_trg
before insert or update on public.hfc_draw_results
for each row execute function public.hfc_prepare_draw_result();

create or replace function public.hfc_prevent_draw_result_delete()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'Los resultados de sorteo no se eliminan; use status void';
end;
$$;

drop trigger if exists hfc_draw_results_no_delete_trg on public.hfc_draw_results;
create trigger hfc_draw_results_no_delete_trg
before delete on public.hfc_draw_results
for each row execute function public.hfc_prevent_draw_result_delete();

-- Cada resultado genera dos tareas idempotentes: correo y contacto telefonico.
-- Si falta un destino, queda bloqueada y visible para resolucion humana.
create or replace function public.hfc_enqueue_winner_notifications()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  target_channel text;
  target_recipient text;
  target_status text;
  target_error text;
  target_key text;
begin
  if new.status in ('rejected', 'expired', 'void') then
    update public.hfc_notification_outbox
    set
      status = 'cancelled',
      last_error = 'Resultado marcado como ' || new.status,
      locked_at = null,
      locked_by = null,
      updated_at = now()
    where draw_result_id = new.id
      and status in ('pending', 'failed', 'blocked');
    return new;
  end if;

  if new.status not in ('selected', 'contacting', 'confirmed', 'accepted') then
    return new;
  end if;

  foreach target_channel in array array['email', 'phone'] loop
    target_recipient := case when target_channel = 'email' then nullif(new.winner_email, '') else nullif(new.winner_phone, '') end;
    target_status := case when target_recipient is null then 'blocked' else 'pending' end;
    target_error := case when target_recipient is null then 'Falta destino de contacto del ganador' else null end;
    target_key := 'draw-result:' || new.id || ':' || target_channel;

    insert into public.hfc_notification_outbox (
      id,
      draw_result_id,
      order_id,
      user_id,
      channel,
      recipient,
      template_type,
      status,
      last_error,
      idempotency_key,
      payload,
      created_at,
      updated_at
    )
    select
      'notify_' || replace(gen_random_uuid()::text, '-', ''),
      new.id,
      piston.order_id,
      piston.user_id,
      target_channel,
      target_recipient,
      'special_prize_winner',
      target_status,
      target_error,
      target_key,
      jsonb_build_object('prizeId', new.prize_id, 'rank', new.rank, 'winnerRut', new.winner_rut),
      now(),
      now()
    from public.hfc_pistons piston
    where piston.id = new.piston_id
    on conflict (idempotency_key) do update
    set
      recipient = excluded.recipient,
      status = case
        when hfc_notification_outbox.status in ('sent', 'processing', 'cancelled') then hfc_notification_outbox.status
        else excluded.status
      end,
      last_error = case
        when hfc_notification_outbox.status in ('sent', 'processing', 'cancelled') then hfc_notification_outbox.last_error
        else excluded.last_error
      end,
      updated_at = now();
  end loop;

  return new;
end;
$$;

drop trigger if exists hfc_draw_results_notifications_trg on public.hfc_draw_results;
create trigger hfc_draw_results_notifications_trg
after insert or update of status, winner_email, winner_phone on public.hfc_draw_results
for each row execute function public.hfc_enqueue_winner_notifications();

-- Reconcilia de forma idempotente una eventual instalacion parcial anterior.
-- Los triggers de resultado cancelan el outbox asociado dentro de esta misma
-- sentencia/transaccion.
update public.hfc_draw_results result
set
  status = 'void',
  payload = coalesce(result.payload, '{}'::jsonb) || jsonb_build_object(
    'voidReason', 'piston_already_revoked_at_migration',
    'voidedAt', now()
  ),
  updated_at = now()
from public.hfc_pistons piston
where result.piston_id = piston.id
  and piston.status = 'revoked'
  and result.status in ('selected', 'contacting', 'confirmed', 'accepted');

-- Proyecta filas existentes y crea/revoca sus Pistones en la misma transaccion.
update public.hfc_special_passes
set payload = payload;

-- Las FK sobre datos legacy se agregan NOT VALID: no rompen por historicos
-- huerfanos, pero se aplican a todas las escrituras futuras.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.hfc_special_passes'::regclass
      and conname = 'hfc_special_passes_order_fk'
  ) then
    alter table public.hfc_special_passes
      add constraint hfc_special_passes_order_fk
      foreign key (order_id) references public.hfc_orders(id) on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.hfc_special_passes'::regclass
      and conname = 'hfc_special_passes_user_fk'
  ) then
    alter table public.hfc_special_passes
      add constraint hfc_special_passes_user_fk
      foreign key (user_id) references public.hfc_users(id) on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.hfc_special_passes'::regclass
      and conname = 'hfc_special_passes_holder_rut_chk'
  ) then
    alter table public.hfc_special_passes
      add constraint hfc_special_passes_holder_rut_chk
      check (
        holder_rut is null
        or (
          holder_rut = public.hfc_normalize_rut(holder_rut)
          and holder_rut ~ '^[0-9]{6,8}[0-9K]$'
        )
      ) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.hfc_special_passes'::regclass
      and conname = 'hfc_special_passes_entry_validation_status_chk'
  ) then
    alter table public.hfc_special_passes
      add constraint hfc_special_passes_entry_validation_status_chk
      check (entry_validation_status is null or entry_validation_status in ('not_checked', 'valid', 'invalid')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.hfc_special_passes'::regclass
      and conname = 'hfc_special_passes_attendance_status_chk'
  ) then
    alter table public.hfc_special_passes
      add constraint hfc_special_passes_attendance_status_chk
      check (attendance_status is null or attendance_status in ('not_checked_in', 'present', 'absent')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.hfc_pistons'::regclass
      and conname = 'hfc_pistons_order_fk'
  ) then
    alter table public.hfc_pistons
      add constraint hfc_pistons_order_fk
      foreign key (order_id) references public.hfc_orders(id) on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.hfc_pistons'::regclass
      and conname = 'hfc_pistons_user_fk'
  ) then
    alter table public.hfc_pistons
      add constraint hfc_pistons_user_fk
      foreign key (user_id) references public.hfc_users(id) on delete restrict not valid;
  end if;
end;
$$;

-- Premio base: no exige presencia para conservar la opcion de ganar el auto.
-- Queda en draft y la migracion no completa datos legales ni habilita ventas.
insert into public.hfc_special_prizes (
  id,
  campaign_id,
  event_id,
  code,
  name,
  description,
  prize_type,
  draw_mode,
  presence_required,
  event_entry_required,
  include_all_valid_pistons,
  draw_on,
  status,
  payload
)
select
  'hfc-2026-automobile',
  'hfc-2026-special-pass',
  'honda-fest-chile-2026',
  'automobile',
  'Automovil Honda',
  'Premio sujeto a bases oficiales completas y aprobadas por el organizador.',
  'automobile',
  'in_person',
  false,
  false,
  true,
  date '2026-11-29',
  'draft',
  jsonb_build_object(
    'notificationChannels', jsonb_build_array('email', 'phone'),
    'salesActivation', false,
    'legalStatus', 'pending_final_rules'
  )
where not exists (
  select 1 from public.hfc_special_prizes
  where id = 'hfc-2026-automobile' or code = 'automobile'
);

-- Configuracion comercial fail-safe. Preserva todos los campos de negocio
-- existentes, pero fuerza el kill-switch, las bases no publicadas y la fecha
-- acordada. La misma migracion nunca puede habilitar la venta.
do $$
begin
  if to_regclass('public.hfc_settings') is not null then
    execute $statement$
      update public.hfc_settings
      set
        payload = case
          when jsonb_typeof(payload) = 'object' then payload
          else '{}'::jsonb
        end || jsonb_build_object(
          'active', false,
          'rulesPublished', false,
          'eventDate', '2026-11-29',
          'eventDateLabel', '29 de noviembre de 2026'
        ),
        updated_at = now()
      where id = 'special_pass_config' or type = 'special_pass'
    $statement$;

    execute $statement$
      insert into public.hfc_settings (id, type, payload, created_at, updated_at)
      select
        'special_pass_config',
        'special_pass',
        jsonb_build_object(
          'id', 'special_pass_config',
          'active', false,
          'rulesPublished', false,
          'campaignId', 'hfc-2026-special-pass',
          'eventId', 'honda-fest-chile-2026',
          'eventDate', '2026-11-29',
          'eventDateLabel', '29 de noviembre de 2026',
          'migrationSeed', true
        ),
        now(),
        now()
      where not exists (
        select 1 from public.hfc_settings
        where id = 'special_pass_config' or type = 'special_pass'
      )
    $statement$;
  end if;
end;
$$;

-- El backend usa service_role. Anon/authenticated no reciben politicas RLS.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke update, delete on table public.hfc_order_acceptances from service_role';
    execute 'grant select, insert on table public.hfc_order_acceptances to service_role';
    execute 'grant select, insert, update, delete on table public.hfc_pistons to service_role';
    execute 'grant select, insert, update, delete on table public.hfc_special_prizes to service_role';
    execute 'grant select, insert, update, delete on table public.hfc_draw_manifests to service_role';
    execute 'grant select, insert, update, delete on table public.hfc_draw_entries to service_role';
    execute 'grant select, insert, update, delete on table public.hfc_draw_results to service_role';
    execute 'grant select, insert, update, delete on table public.hfc_notification_outbox to service_role';
    execute 'grant execute on function public.hfc_normalize_rut(text) to service_role';
    execute 'grant execute on function public.hfc_try_timestamptz(text) to service_role';
    execute 'grant execute on function public.hfc_sync_special_pass_pistons(text) to service_role';
    execute 'grant execute on function public.hfc_sync_special_pass_acceptances(text) to service_role';
    execute 'grant execute on function public.hfc_create_draw_manifest(text, text, jsonb) to service_role';
    execute 'grant execute on function public.hfc_void_results_for_revoked_piston() to service_role';
  end if;
end;
$$;

revoke all on function public.hfc_create_draw_manifest(text, text, jsonb) from public;
revoke all on function public.hfc_sync_special_pass_pistons(text) from public;
revoke all on function public.hfc_sync_special_pass_acceptances(text) from public;
revoke all on function public.hfc_guard_order_acceptance_immutable() from public;
revoke all on function public.hfc_special_pass_relationalize() from public;
revoke all on function public.hfc_special_pass_sync_pistons_trigger() from public;
revoke all on function public.hfc_guard_piston_identity() from public;
revoke all on function public.hfc_void_results_for_revoked_piston() from public;
revoke all on function public.hfc_guard_draw_manifest() from public;
revoke all on function public.hfc_guard_draw_entry() from public;
revoke all on function public.hfc_prepare_draw_result() from public;
revoke all on function public.hfc_prevent_draw_result_delete() from public;
revoke all on function public.hfc_enqueue_winner_notifications() from public;
revoke all on function public.hfc_try_timestamptz(text) from public;
revoke all on function public.hfc_normalize_rut(text) from public;

comment on table public.hfc_pistons is 'Una fila auditable por Piston asociada al RUT normalizado del titular del Upgrade.';
comment on table public.hfc_draw_manifests is 'Snapshot versionado y sellado de Pistones elegibles para un premio.';
comment on table public.hfc_notification_outbox is 'Cola idempotente; almacenar una tarea no prueba que el contacto fue enviado.';
