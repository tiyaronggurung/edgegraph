alter table public.pb_settings
  add column if not exists live_enabled boolean not null default false,
  add column if not exists live_user_id uuid null,
  add column if not exists live_max_open_cents integer not null default 1000;

create or replace function public.paper_bot_set_live(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_ops_admin(auth.uid()) then raise exception 'admin only'; end if;
  update pb_settings set
    live_enabled = p_enabled,
    live_user_id = case when p_enabled then auth.uid() else null end,
    updated_at = now()
  where id = 1;
end $$;

revoke all on function public.paper_bot_set_live(boolean) from public, anon;
grant execute on function public.paper_bot_set_live(boolean) to authenticated;