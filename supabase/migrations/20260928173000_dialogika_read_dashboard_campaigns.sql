create policy "campaigns_owner_read_for_dialogika"
on public.campaigns for select to authenticated
using (exists (
  select 1 from public.projects p
  where p.id = campaigns.project_id and p.user_id = (select auth.uid())
));
