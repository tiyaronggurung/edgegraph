
-- =========================================================
-- PROFILES
-- =========================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  bankroll numeric not null default 1000,
  default_unit numeric not null default 25,
  risk_tolerance text not null default 'Medium',
  preferred_sports text[] not null default '{NBA,NFL,NHL,MLB,Tennis,Soccer}',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================
-- PATTERNS (public reference table)
-- =========================================================
create table public.patterns (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null,
  risk_level text not null,
  recommended_action text not null,
  condition_logic text not null,
  example_behavior text not null,
  icon text,
  best_use text
);
alter table public.patterns enable row level security;
create policy "patterns public read" on public.patterns for select using (true);

insert into public.patterns (name, description, risk_level, recommended_action, condition_logic, example_behavior, icon, best_use) values
('Dominant Lock','Market strongly favors one side with high confidence and stability. Graph is flat near 85-95% for extended period.','Low','Hold favorite or avoid low payout','prob >= 90, stable trend','Flat high probability line','🔒','Late game, low volatility'),
('Controlled Stability','Probability climbing steadily — market consensus building with gradual upward slope.','Low','Small position or wait for dip entry','prob >= 75, climbing','Gradual upward slope','📈','Mid-game trend'),
('Breakaway Trend','Sudden directional shift with volume confirmation — market repricing rapidly.','Medium','Follow trend with tight stop','prob shift >15% in short window','Vertical jump after event','🚀','After key game event'),
('Late Momentum Swing','Sudden market reversal in final stretch — game state shifting rapidly.','Medium/High','Wait for second confirmation','late period + prob reversal','Reversal in final period','⚡','Late game only'),
('V-Reversal','Probability reverses sharply after a big drop — often driven by key play or score event.','Medium','Fade or wait for stabilization','drop then sharp recovery','V-shape pattern','↗','After major swing'),
('Fake Spike','Sudden emotional move without follow-through — public overreaction, sharp money fades it.','High','Fade overreaction — wait','spike + rapid collapse','Spike collapsing immediately','⚠','High volatility periods'),
('Chaotic Coin Flip','No stable edge — probability swings rapidly with no sustained direction.','High','No bet — avoid entirely','rapid swings both directions','Sawtooth pattern','🎰','Avoid all'),
('Momentum Exhaustion','Trend has been running too long — sharp money may be repositioning for reversal.','Medium','Reduce position or hedge','extended run, flattening','Long trend flattening','😮‍💨','Late trend periods'),
('Sharp Money Recovery','After public panic, sharp money quietly repositions to original favorite.','Medium','Follow sharp action','dip then gradual recovery','Quiet recovery after dip','💰','Post-overreaction'),
('Volatility Compression','Range tightens before a directional move — market coiling.','Medium','Wait for breakout','tightening range','Tightening oscillation','🪢','Pre-breakout periods'),
('Public Overreaction','Volume spike with unsustained probability move.','High','Wait or fade','volume spike, unsustained','Volume + price spike','📢','News-driven moments'),
('Failed Rally','Underdog spikes fail repeatedly — favorite reasserts.','Low','Hold favorite','repeated failed pushes','Multiple failed spikes','🛡','Trending favorite games'),
('Favorite Confirmation','Repeated failed rallies by underdog confirm favorite.','Low','Increase position','3+ failed pushes against favorite','Step-up favorite probability','✅','Strong favorite trends'),
('Underdog Trap','Suppressed underdog near inflection — trap setup.','High','Hedge','suppressed underdog at key event','Underdog flat near breakpoint','🪤','Pre-key-event scenarios');

-- =========================================================
-- ANALYSES
-- =========================================================
create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sport text not null,
  league text,
  game_name text,
  team_a text,
  team_b text,
  score text,
  time_period text,
  probability_a numeric,
  probability_b numeric,
  odds_a numeric,
  odds_b numeric,
  volume numeric,
  uploaded_image_url text,
  pattern_type text,
  predicted_winner text,
  confidence_score numeric,
  edge_score numeric,
  risk_level text,
  recommended_action text,
  ai_reasoning text,
  edge70_detected boolean default false,
  sport_fields jsonb default '{}'::jsonb,
  notes jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.analyses enable row level security;
create policy "own analyses all" on public.analyses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index analyses_user_created_idx on public.analyses(user_id, created_at desc);

-- =========================================================
-- BETS
-- =========================================================
create table public.bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  analysis_id uuid references public.analyses(id) on delete set null,
  game text,
  date date not null default current_date,
  sport text,
  pick text,
  odds numeric,
  stake numeric,
  pattern_type text,
  confidence_score numeric,
  edge_score numeric,
  result text default 'Pending',
  profit_loss numeric default 0,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.bets enable row level security;
create policy "own bets all" on public.bets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index bets_user_created_idx on public.bets(user_id, created_at desc);

-- =========================================================
-- STRATEGIES
-- =========================================================
create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  rules text,
  pattern_type text,
  minimum_confidence numeric default 70,
  recommended_action text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.strategies enable row level security;
create policy "own strategies all" on public.strategies for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================
-- GRAPH SNAPSHOTS
-- =========================================================
create table public.graph_snapshots (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  timestamp timestamptz not null default now(),
  probability_a numeric,
  probability_b numeric,
  odds_a numeric,
  odds_b numeric,
  volume numeric,
  score_state text,
  event_trigger text
);
alter table public.graph_snapshots enable row level security;
create policy "own snapshots all" on public.graph_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index snapshots_analysis_idx on public.graph_snapshots(analysis_id, timestamp);

-- =========================================================
-- STORAGE BUCKET for uploaded graph images
-- =========================================================
insert into storage.buckets (id, name, public) values ('graph-uploads','graph-uploads', false)
on conflict (id) do nothing;

create policy "graph uploads own read" on storage.objects for select
  using (bucket_id = 'graph-uploads' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "graph uploads own insert" on storage.objects for insert
  with check (bucket_id = 'graph-uploads' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "graph uploads own update" on storage.objects for update
  using (bucket_id = 'graph-uploads' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "graph uploads own delete" on storage.objects for delete
  using (bucket_id = 'graph-uploads' and auth.uid()::text = (storage.foldername(name))[1]);
