alter table public.dialogika_connections
  add column if not exists ad_account_id text;

update public.dialogika_connections
set ad_account_id = '29867480'
where kind = 'vk' and external_id = '109534321' and ad_account_id is null
  and exists (
    select 1 from public.projects p
    where p.user_id = dialogika_connections.user_id
      and p.connection_type = 'api' and p.vk_account_id = '29867480'
  );
