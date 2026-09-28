alter table public.dialogika_connections
  drop constraint if exists dialogika_connections_kind_check;

alter table public.dialogika_connections
  add constraint dialogika_connections_kind_check
  check (kind in ('vk', 'router', 'senler', 'vk_ads'));

create or replace function dialogika_private.save_credential(
  p_kind text, p_external_id text, p_name text, p_photo text, p_credential text
) returns void
language plpgsql security definer set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_existing text;
  v_secret_id uuid;
  v_secret_name text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_kind not in ('vk', 'router', 'senler', 'vk_ads')
    or coalesce(p_external_id, '') = '' or coalesce(p_credential, '') = '' then
    raise exception 'Invalid connection data';
  end if;
  if p_kind = 'vk_ads' and p_external_id <> '29867480' then
    raise exception 'Unexpected VK Ads account';
  end if;

  select credential_ciphertext into v_existing
  from public.dialogika_connections
  where user_id = v_user_id and kind = p_kind and external_id = p_external_id;

  if v_existing like 'vault.%' then
    v_secret_id := substring(v_existing from 7)::uuid;
    perform vault.update_secret(v_secret_id, p_credential);
  else
    v_secret_name := 'dialogika:' || v_user_id::text || ':' || p_kind || ':' || p_external_id;
    select id into v_secret_id from vault.secrets where name = v_secret_name limit 1;
    if v_secret_id is null then
      v_secret_id := vault.create_secret(p_credential, v_secret_name, 'Dialogika connection credential');
    else
      perform vault.update_secret(v_secret_id, p_credential);
    end if;
  end if;

  insert into public.dialogika_connections (
    user_id, kind, external_id, name, photo, credential_ciphertext, updated_at
  ) values (
    v_user_id, p_kind, p_external_id,
    coalesce(nullif(p_name, ''), case when p_kind = 'router' then 'Router Cheap' when p_kind = 'senler' then 'Senler' when p_kind = 'vk_ads' then 'VK Ads Эмалис' else 'Сообщество VK' end),
    nullif(p_photo, ''),
    'vault.' || v_secret_id::text,
    now()
  )
  on conflict (user_id, kind, external_id) do update set
    name = excluded.name,
    photo = excluded.photo,
    credential_ciphertext = excluded.credential_ciphertext,
    updated_at = excluded.updated_at;
end;
$function$;
