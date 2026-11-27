-- ALENGO ESPETINHOS 1.5.0 — acesso remoto de atendentes
-- Execute no SQL Editor do projeto Supabase exclusivo do ALENGO.

create table if not exists public.remote_operator_links (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  operator_id integer not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.remote_state (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  operator_id integer not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.remote_requests (
  id uuid primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  request_type text not null check (request_type in ('CREATE_ORDER','ITEM_DELIVERY','CANCEL_ORDER')),
  request_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','PROCESSING','CONFIRMED','ERROR')),
  response jsonb,
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  processed_at timestamptz,
  unique(auth_user_id, request_key)
);

create index if not exists remote_requests_pending_idx
  on public.remote_requests(status, created_at)
  where status in ('PENDING','PROCESSING');
create index if not exists remote_requests_user_idx
  on public.remote_requests(auth_user_id, created_at desc);

alter table public.remote_operator_links enable row level security;
alter table public.remote_state enable row level security;
alter table public.remote_requests enable row level security;

-- Os atendentes só podem consultar seu próprio snapshot e suas próprias solicitações.
drop policy if exists remote_operator_links_read_own on public.remote_operator_links;
create policy remote_operator_links_read_own on public.remote_operator_links
  for select to authenticated
  using (auth_user_id = auth.uid() and active = true);

drop policy if exists remote_state_read_own on public.remote_state;
create policy remote_state_read_own on public.remote_state
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    and exists (
      select 1 from public.remote_operator_links l
      where l.auth_user_id = auth.uid() and l.operator_id = remote_state.operator_id and l.active = true
    )
  );

drop policy if exists remote_requests_read_own on public.remote_requests;
create policy remote_requests_read_own on public.remote_requests
  for select to authenticated
  using (
    auth_user_id = auth.uid()
    and exists (select 1 from public.remote_operator_links l where l.auth_user_id = auth.uid() and l.active = true)
  );

drop policy if exists remote_requests_insert_own on public.remote_requests;
create policy remote_requests_insert_own on public.remote_requests
  for insert to authenticated
  with check (
    auth_user_id = auth.uid()
    and status = 'PENDING'
    and response is null
    and processed_at is null
    and locked_at is null
    and exists (select 1 from public.remote_operator_links l where l.auth_user_id = auth.uid() and l.active = true)
  );

grant usage on schema public to authenticated, service_role;
revoke all on public.remote_operator_links from anon, authenticated;
revoke all on public.remote_state from anon, authenticated;
revoke all on public.remote_requests from anon, authenticated;
grant select on public.remote_operator_links to authenticated;
grant select on public.remote_state to authenticated;
grant select, insert on public.remote_requests to authenticated;
grant all on public.remote_operator_links to service_role;
grant all on public.remote_state to service_role;
grant all on public.remote_requests to service_role;

comment on table public.remote_operator_links is 'Vínculo administrado pelo responsável: usuário Supabase Auth para operador local do ALENGO.';
comment on table public.remote_state is 'Snapshot publicado pelo servidor Windows; não é a base transacional oficial.';
comment on table public.remote_requests is 'Fila de comandos remotos. O SQLite Windows permanece como fonte oficial.';
