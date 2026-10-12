create table if not exists public.pb_settings (
  id int primary key default 1 check (id = 1),
  running boolean not null default false,
  series text[] not null default array['KXBTC15M'],
  start_cash numeric not null default 3000,
  cash numeric not null default 3000,
  open_value numeric not null default 0,
  taker_fee_rate numeric not null default 0.07,
  poll_seconds numeric not null default 2,
  strategy jsonb not null default '{}'::jsonb,
  reset_epoch int not null default 0,
  lock_until timestamptz,
  last_tick_at timestamptz,
  last_equity_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
insert into public.pb_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.pb_markets (
  ticker text primary key,
  event_ticker text not null,
  title text not null default '',
  coin text not null default '',
  strike numeric,
  open_ts timestamptz not null,
  close_ts timestamptz not null,
  yes_ct numeric not null default 0,
  yes_cost numeric not null default 0,
  no_ct numeric not null default 0,
  no_cost numeric not null default 0,
  fees numeric not null default 0,
  fills int not null default 0,
  last_buy_ts timestamptz,
  yes_bid numeric,
  no_bid numeric,
  index_price numeric,
  index_ts timestamptz,
  settled boolean not null default false,
  result text check (result in ('yes','no')),
  payout numeric not null default 0,
  pnl numeric,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pb_markets_open_idx on public.pb_markets (settled, close_ts);

create table if not exists public.pb_fills (
  id bigserial primary key,
  ts timestamptz not null,
  ticker text not null,
  title text not null default '',
  side text not null check (side in ('yes','no')),
  contracts numeric not null,
  price numeric not null,
  fee numeric not null,
  reason text not null default '',
  yes_ct numeric, yes_avg numeric, no_ct numeric, no_avg numeric, pair_cost numeric,
  index_price numeric, strike numeric, gap numeric
);
create index if not exists pb_fills_ts_idx on public.pb_fills (ts desc);

create table if not exists public.pb_equity (
  id bigserial primary key,
  ts timestamptz not null,
  equity numeric not null,
  pnl numeric not null,
  cash numeric not null,
  open_value numeric not null
);
create index if not exists pb_equity_ts_idx on public.pb_equity (ts);

create table if not exists public.pb_index_prices (
  coin text primary key,
  price numeric not null,
  ts timestamptz not null
);

grant select on public.pb_settings, public.pb_markets, public.pb_fills, public.pb_equity, public.pb_index_prices to authenticated;
grant all on public.pb_settings, public.pb_markets, public.pb_fills, public.pb_equity, public.pb_index_prices to service_role;
grant usage, select on sequence public.pb_fills_id_seq, public.pb_equity_id_seq to service_role;

alter table public.pb_settings enable row level security;
alter table public.pb_markets enable row level security;
alter table public.pb_fills enable row level security;
alter table public.pb_equity enable row level security;
alter table public.pb_index_prices enable row level security;

create policy "pb read settings" on public.pb_settings for select to authenticated using (true);
create policy "pb read markets" on public.pb_markets for select to authenticated using (true);
create policy "pb read fills" on public.pb_fills for select to authenticated using (true);
create policy "pb read equity" on public.pb_equity for select to authenticated using (true);
create policy "pb read index" on public.pb_index_prices for select to authenticated using (true);

create or replace view public.pb_v_summary with (security_invoker = true) as
select
  s.start_cash, s.cash, s.open_value as positions_value,
  s.cash + s.open_value as equity,
  s.cash + s.open_value - s.start_cash as total_pnl,
  (select coalesce(sum(contracts * price), 0) from public.pb_fills) as volume,
  (select coalesce(sum(fee), 0) from public.pb_fills) as fees,
  (select count(distinct ticker) from public.pb_fills) as markets_traded,
  (select count(*) from public.pb_markets where settled and fills > 0) as settled_markets,
  (select count(*) from public.pb_markets where settled and fills > 0 and pnl > 0) as winning_markets,
  (select coalesce(max(pnl), 0) from public.pb_markets where settled and fills > 0 and pnl > 0) as biggest_win,
  (select coalesce(min(pnl), 0) from public.pb_markets where settled and fills > 0 and pnl < 0) as biggest_loss,
  (select coalesce(sum(pnl), 0) from public.pb_markets where settled and fills > 0) as realized_pnl,
  s.running, s.series, s.last_tick_at, s.last_error
from public.pb_settings s where s.id = 1;

create or replace view public.pb_v_active_positions with (security_invoker = true) as
select ticker, title, coin, strike, open_ts, close_ts,
  yes_ct, case when yes_ct > 0 then yes_cost / yes_ct end as yes_avg,
  no_ct, case when no_ct > 0 then no_cost / no_ct end as no_avg,
  yes_bid, no_bid, index_price, index_ts,
  index_price - strike as gap,
  yes_cost + no_cost + fees as cost,
  yes_ct * coalesce(yes_bid, 0) + no_ct * coalesce(no_bid, 0) as value,
  yes_ct * coalesce(yes_bid, 0) + no_ct * coalesce(no_bid, 0) - (yes_cost + no_cost + fees) as pnl
from public.pb_markets where not settled and fills > 0
order by close_ts;

create or replace view public.pb_v_closed_positions with (security_invoker = true) as
select ticker, title, coin, strike, close_ts, settled_at, result,
  yes_ct, case when yes_ct > 0 then yes_cost / yes_ct end as yes_avg,
  no_ct, case when no_ct > 0 then no_cost / no_ct end as no_avg,
  yes_cost + no_cost + fees as cost, payout, pnl, fees
from public.pb_markets where settled and fills > 0
order by settled_at desc;

create or replace view public.pb_v_activity with (security_invoker = true) as
select ts, 'buy'::text as type, side, ticker, title, contracts, price,
  contracts * price + fee as amount, null::numeric as pnl, reason, gap
from public.pb_fills
union all
select settled_at, 'settle', result, ticker, title,
  case when result = 'yes' then yes_ct else no_ct end, 1.0,
  payout, pnl, null, index_price - strike
from public.pb_markets where settled and fills > 0
order by ts desc;

grant select on public.pb_v_summary, public.pb_v_active_positions, public.pb_v_closed_positions, public.pb_v_activity to authenticated, service_role;

create or replace function public.paper_bot_acquire_lock(seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update pb_settings set lock_until = now() + make_interval(secs => seconds)
   where id = 1 and (lock_until is null or lock_until < now());
  return found;
end $$;

create or replace function public.paper_bot_release_lock()
returns void language sql security definer set search_path = public as $$
  update pb_settings set lock_until = null where id = 1;
$$;

create or replace function public.paper_bot_equity(range_seconds int default 0)
returns table (ts timestamptz, pnl numeric)
language sql stable security invoker set search_path = public as $$
  with r as (
    select e.ts, e.pnl, row_number() over (order by e.ts) as rn, count(*) over () as n
    from pb_equity e
    where range_seconds = 0 or e.ts >= (select max(ts) from pb_equity) - make_interval(secs => range_seconds)
  )
  select r.ts, r.pnl from r
  where rn % greatest(1, n / 1500) = 0 or rn = n or rn = 1
  order by r.ts;
$$;

create or replace function public.paper_bot_reset(new_budget numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_ops_admin(auth.uid()) then raise exception 'admin only'; end if;
  if new_budget is null or new_budget <= 0 then raise exception 'budget must be positive'; end if;
  delete from pb_fills where id is not null;
  delete from pb_equity where id is not null;
  delete from pb_markets where ticker is not null;
  update pb_settings set start_cash = new_budget, cash = new_budget, open_value = 0,
    reset_epoch = reset_epoch + 1, last_error = null, last_equity_at = null, updated_at = now()
  where id = 1;
end $$;

create or replace function public.paper_bot_update_settings(
  p_running boolean, p_series text[], p_strategy jsonb, p_taker_fee_rate numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_ops_admin(auth.uid()) then raise exception 'admin only'; end if;
  update pb_settings set
    running = coalesce(p_running, running),
    series = coalesce(p_series, series),
    strategy = coalesce(p_strategy, strategy),
    taker_fee_rate = coalesce(p_taker_fee_rate, taker_fee_rate),
    updated_at = now()
  where id = 1;
end $$;

revoke all on function public.paper_bot_acquire_lock(int) from public, anon, authenticated;
revoke all on function public.paper_bot_release_lock() from public, anon, authenticated;
grant execute on function public.paper_bot_acquire_lock(int), public.paper_bot_release_lock() to service_role;
revoke all on function public.paper_bot_reset(numeric) from public, anon;
revoke all on function public.paper_bot_update_settings(boolean, text[], jsonb, numeric) from public, anon;
grant execute on function public.paper_bot_reset(numeric) to authenticated;
grant execute on function public.paper_bot_update_settings(boolean, text[], jsonb, numeric) to authenticated;
grant execute on function public.paper_bot_equity(int) to authenticated;