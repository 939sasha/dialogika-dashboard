create table if not exists public.dialogika_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('vk', 'router')),
  external_id text not null,
  name text not null,
  photo text,
  credential_ciphertext text not null,
  latest_analysis jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, external_id)
);

alter table public.dialogika_connections enable row level security;
revoke all on table public.dialogika_connections from anon;
grant select, insert, update, delete on table public.dialogika_connections to authenticated;

create policy "dialogika_select_own" on public.dialogika_connections
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "dialogika_insert_own" on public.dialogika_connections
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "dialogika_update_own" on public.dialogika_connections
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dialogika_delete_own" on public.dialogika_connections
  for delete to authenticated using ((select auth.uid()) = user_id);

create index if not exists dialogika_connections_user_id_idx on public.dialogika_connections(user_id);
