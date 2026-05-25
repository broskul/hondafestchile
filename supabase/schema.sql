create extension if not exists pgcrypto;

create table if not exists public.hfc_users (
  id text primary key,
  email text unique,
  rut text unique,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hfc_sessions (
  id text primary key,
  user_id text,
  token text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hfc_orders (
  id text primary key,
  user_id text,
  status text,
  total integer not null default 0,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hfc_tickets (
  id text primary key,
  order_id text,
  user_id text,
  code text unique,
  status text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hfc_invoices (
  id text primary key,
  order_id text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hfc_payments (
  id text primary key,
  order_id text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hfc_settings (
  id text primary key,
  type text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hfc_contacts (
  id text primary key,
  email text,
  corrected_email text,
  source text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hfc_email_templates (
  id text primary key,
  type text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hfc_email_logs (
  id text primary key,
  type text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hfc_audit (
  id text primary key,
  type text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hfc_users enable row level security;
alter table public.hfc_sessions enable row level security;
alter table public.hfc_orders enable row level security;
alter table public.hfc_tickets enable row level security;
alter table public.hfc_invoices enable row level security;
alter table public.hfc_payments enable row level security;
alter table public.hfc_settings enable row level security;
alter table public.hfc_contacts enable row level security;
alter table public.hfc_email_templates enable row level security;
alter table public.hfc_email_logs enable row level security;
alter table public.hfc_audit enable row level security;

create index if not exists hfc_orders_user_status_idx on public.hfc_orders(user_id, status);
create index if not exists hfc_tickets_code_idx on public.hfc_tickets(code);
create index if not exists hfc_tickets_order_idx on public.hfc_tickets(order_id);
create index if not exists hfc_settings_type_idx on public.hfc_settings(type);
create index if not exists hfc_contacts_email_idx on public.hfc_contacts(email);
create index if not exists hfc_contacts_corrected_email_idx on public.hfc_contacts(corrected_email);
create index if not exists hfc_email_templates_type_idx on public.hfc_email_templates(type);
