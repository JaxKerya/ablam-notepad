-- KPSS preference guide helper (Ablam Kariyer > Tercih Rehberi).
--
-- One row per placement round ("2026/1", "2026/2"). `veri` is the parsed ÖSYM
-- guide for associate-degree graduates (Tablo-2 rows, qualification code
-- dictionaries, program list, the guide's "Başvurma Özel Şartları" sections);
-- the worker writes it. `durum` is what the user told the page: graduated
-- program, gender, yes/no answers per qualification code and the ordered
-- preference list. Reloading a round replaces `veri` only.
--
-- Same access model as the other kariyer_* tables: the site sits behind its own
-- gate and talks to Supabase with the anon key.

create table if not exists kpss_tercih (
  donem       text primary key,
  kaynak_url  text,
  yuklendi    timestamptz not null default now(),
  veri        jsonb not null,
  durum       jsonb not null default '{}'::jsonb
);

alter table kpss_tercih enable row level security;

drop policy if exists "kpss_tercih_public_all" on kpss_tercih;
create policy "kpss_tercih_public_all" on kpss_tercih for all using (true) with check (true);
