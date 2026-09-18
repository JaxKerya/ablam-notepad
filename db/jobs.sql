-- Ablam İş Fırsatları — Supabase SQL Editor'da bir kez çalıştırın.
-- Hiçbir tablo anon/authenticated rollerine açılmaz. Yalnızca sunucu service_role.
begin;
create extension if not exists pgcrypto;

create table if not exists public.job_profile (
  id integer primary key default 1 check (id = 1),
  profile jsonb not null,
  version integer not null default 1,
  queries jsonb not null default '[]',
  queries_version integer not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.job_sources (
  id text primary key,
  kind text not null check (kind in ('jooble','google','greenhouse','lever')),
  board text not null default '',
  query_index integer not null default 0,
  page integer not null default 1,
  page_token text,
  next_run timestamptz not null default now(),
  last_attempt timestamptz,
  last_success timestamptz,
  last_error text,
  last_query text,
  last_count integer not null default 0
);
create table if not exists public.job_listings (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  title text not null,
  company text not null,
  location text not null default '',
  description text not null default '',
  url text not null check (url ~ '^https?://'),
  source text not null,
  source_id text not null,
  published_at timestamptz,
  first_seen timestamptz not null default now(),
  status text not null default 'new' check (status in ('new','saved','applied','dismissed')),
  assessment jsonb,
  score integer check (score between 0 and 100),
  eligible boolean not null default false,
  profile_version integer,
  evaluated_at timestamptz,
  attempts integer not null default 0,
  next_attempt timestamptz not null default now(),
  last_error text
);
create index if not exists job_listings_queue on public.job_listings (profile_version, next_attempt, first_seen);
create index if not exists job_listings_score on public.job_listings (score desc, first_seen desc);

create table if not exists public.job_notifications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid unique references public.job_listings(id) on delete cascade,
  recipient text not null,
  subject text not null,
  body text not null,
  sender text not null,
  status text not null default 'pending' check (status in ('pending','sent','cancelled')),
  attempts integer not null default 0,
  next_attempt timestamptz not null default now(),
  last_error text,
  provider_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists job_notifications_queue on public.job_notifications (status, next_attempt);
create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  trigger text not null,
  found integer not null default 0,
  evaluated integer not null default 0,
  sent integer not null default 0,
  errors jsonb not null default '[]'
);
create table if not exists public.job_locks (
  id text primary key,
  owner uuid not null,
  expires_at timestamptz not null
);
create table if not exists public.job_usage (
  day date primary key default current_date,
  ai integer not null default 0,
  searches integer not null default 0
);
create table if not exists public.job_auth_attempts (
  bucket text primary key,
  attempts integer not null default 0,
  expires_at timestamptz not null
);

create or replace function public.job_claim_lock(lock_name text, lock_owner uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed integer;
begin
  insert into job_locks (id, owner, expires_at) values (lock_name, lock_owner, now() + interval '5 minutes')
  on conflict (id) do update set owner = excluded.owner, expires_at = excluded.expires_at
  where job_locks.expires_at < now();
  get diagnostics claimed = row_count;
  return claimed = 1;
end;
$$;
create or replace function public.job_take_budget(budget_kind text, budget_limit integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed integer;
begin
  insert into job_usage(day) values ((now() at time zone 'UTC')::date) on conflict do nothing;
  if budget_kind = 'ai' then
    update job_usage set ai = ai + 1 where day = (now() at time zone 'UTC')::date and ai < budget_limit;
  elsif budget_kind = 'searches' then
    update job_usage set searches = searches + 1 where day = (now() at time zone 'UTC')::date and searches < budget_limit;
  else raise exception 'Unknown budget';
  end if;
  get diagnostics claimed = row_count;
  return claimed = 1;
end;
$$;
create or replace function public.job_save_profile(new_profile jsonb, expected_version integer, matching_changed boolean)
returns integer language plpgsql security definer set search_path = public as $$
declare old_profile job_profile%rowtype; next_version integer;
begin
  select * into old_profile from job_profile where id = 1 for update;
  if old_profile.id is not null and old_profile.version <> expected_version then
    raise exception 'Profile version conflict';
  end if;
  next_version := coalesce(old_profile.version, 0) + 1;
  if old_profile.id is not null and not matching_changed then
    update job_listings set profile_version = next_version where profile_version = old_profile.version;
  end if;
  insert into job_profile(id, profile, version, queries, queries_version)
  values (1, new_profile, next_version,
    case when matching_changed then '[]'::jsonb else coalesce(old_profile.queries, '[]') end,
    case when not matching_changed and old_profile.queries_version = old_profile.version then next_version else 0 end)
  on conflict (id) do update set profile = excluded.profile, version = excluded.version,
    queries = excluded.queries, queries_version = excluded.queries_version, updated_at = now();
  if matching_changed then
    update job_listings set next_attempt = now(), attempts = 0 where status not in ('applied','dismissed');
  end if;
  if matching_changed or old_profile.profile->'intervalMinutes' is distinct from new_profile->'intervalMinutes' then
    update job_sources set query_index = 0, page = 1, page_token = null, next_run = now();
  end if;
  -- Never mutate a payload already attempted: the provider may have accepted it.
  if matching_changed or old_profile.profile->'email' is distinct from new_profile->'email' then
    delete from job_notifications where status in ('pending','cancelled') and attempts = 0 and job_id is not null;
    update job_notifications set status = 'cancelled', last_error = 'Profil veya alıcı değişti; önceki gönderim sonucu belirsiz olabilir.'
      where status = 'pending' and attempts > 0;
  else
    delete from job_notifications where status = 'cancelled' and attempts = 0 and job_id is not null;
  end if;
  return next_version;
end;
$$;
create or replace function public.job_auth_allow(attempt_bucket text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from job_auth_attempts where expires_at < now();
  insert into job_auth_attempts(bucket, attempts, expires_at) values (attempt_bucket, 1, now() + interval '15 minutes')
  on conflict (bucket) do update set attempts = job_auth_attempts.attempts + 1
  returning attempts into n;
  return n <= 10;
end;
$$;

-- RLS kapalı politika: anahtar tarayıcıya asla gönderilmez.
alter table public.job_profile enable row level security;
alter table public.job_sources enable row level security;
alter table public.job_listings enable row level security;
alter table public.job_notifications enable row level security;
alter table public.job_runs enable row level security;
alter table public.job_locks enable row level security;
alter table public.job_usage enable row level security;
alter table public.job_auth_attempts enable row level security;
revoke all on public.job_profile, public.job_sources, public.job_listings, public.job_notifications, public.job_runs, public.job_locks, public.job_usage, public.job_auth_attempts from anon, authenticated;
grant all on public.job_profile, public.job_sources, public.job_listings, public.job_notifications, public.job_runs, public.job_locks, public.job_usage, public.job_auth_attempts to service_role;
revoke all on function public.job_claim_lock(text,uuid), public.job_take_budget(text,integer), public.job_auth_allow(text), public.job_save_profile(jsonb,integer,boolean) from public, anon, authenticated;
grant execute on function public.job_claim_lock(text,uuid), public.job_take_budget(text,integer), public.job_auth_allow(text), public.job_save_profile(jsonb,integer,boolean) to service_role;
commit;
