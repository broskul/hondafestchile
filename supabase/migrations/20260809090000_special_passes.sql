create table if not exists public.hfc_special_passes (
  id text primary key,
  order_id text unique,
  user_id text,
  code text unique,
  status text,
  piston_count integer not null default 0,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hfc_special_passes enable row level security;

create index if not exists hfc_special_passes_code_idx on public.hfc_special_passes(code);
create index if not exists hfc_special_passes_order_idx on public.hfc_special_passes(order_id);
create index if not exists hfc_special_passes_user_idx on public.hfc_special_passes(user_id);
