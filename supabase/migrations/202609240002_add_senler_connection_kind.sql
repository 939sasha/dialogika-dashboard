alter table public.dialogika_connections
  drop constraint if exists dialogika_connections_kind_check;

alter table public.dialogika_connections
  add constraint dialogika_connections_kind_check
  check (kind in ('vk', 'router', 'senler'));
