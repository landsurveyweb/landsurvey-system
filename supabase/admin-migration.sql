alter table public.profiles add column if not exists role text not null default 'member' check (role in ('member','admin'));
alter table public.profiles add column if not exists is_active boolean not null default true;

update public.profiles p set role = 'admin'
from auth.users u where p.id = u.id and u.email = 'surveywebtest@yahoo.com';

create or replace function public.is_active_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and is_active);
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and is_active and role = 'admin');
$$;

create or replace function public.admin_list_members()
returns table(id uuid, display_name text, email text, role text, is_active boolean, created_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select p.id, p.display_name, u.email::text, p.role, p.is_active, p.created_at
  from public.profiles p join auth.users u on u.id = p.id
  where public.is_admin() order by p.created_at;
$$;

create or replace function public.admin_update_member(target_id uuid, new_display_name text, new_role text, new_is_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '僅限管理員操作'; end if;
  if target_id = auth.uid() and (new_role <> 'admin' or not new_is_active) then raise exception '不能停用自己或取消自己的管理員權限'; end if;
  if new_role not in ('member','admin') then raise exception '角色不正確'; end if;
  update public.profiles set display_name = coalesce(nullif(trim(new_display_name),''),'使用者'), role = new_role, is_active = new_is_active where id = target_id;
end;
$$;
grant execute on function public.admin_list_members() to authenticated;
grant execute on function public.admin_update_member(uuid,text,text,boolean) to authenticated;

drop policy if exists "members update own profile" on public.profiles;
drop policy if exists "members read profiles" on public.profiles;
create policy "active members read profiles" on public.profiles for select to authenticated using (public.is_active_member());

drop policy if exists "members share survey points" on public.survey_points;
create policy "active members share survey points" on public.survey_points for all to authenticated using (public.is_active_member()) with check (public.is_active_member());
drop policy if exists "members share notes" on public.map_notes;
create policy "active members share notes" on public.map_notes for all to authenticated using (public.is_active_member()) with check (public.is_active_member());
drop policy if exists "members share photo metadata" on public.point_photos;
create policy "active members share photo metadata" on public.point_photos for all to authenticated using (public.is_active_member()) with check (public.is_active_member());
drop policy if exists "members read audit logs" on public.point_audit_logs;
create policy "active members read audit logs" on public.point_audit_logs for select to authenticated using (public.is_active_member());

drop policy if exists "members read point photos" on storage.objects;
create policy "active members read point photos" on storage.objects for select to authenticated using (bucket_id='point-photos' and public.is_active_member());
drop policy if exists "members upload point photos" on storage.objects;
create policy "active members upload point photos" on storage.objects for insert to authenticated with check (bucket_id='point-photos' and public.is_active_member());
drop policy if exists "members delete point photos" on storage.objects;
create policy "active members delete point photos" on storage.objects for delete to authenticated using (bucket_id='point-photos' and public.is_active_member());
