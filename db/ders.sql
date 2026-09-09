-- Ablam Ders — video destekli kendini sınama sistemi
-- Supabase SQL Editor'da bu dosyanın tamamını çalıştırın.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Videolar — transkript video başına bir kez çekilir, tekrar girilirse yeniden
-- çekilmez. segments: [{ o: başlangıç_ms, d: süre_ms, t: metin }]
-- ---------------------------------------------------------------------------
create table if not exists ders_videos (
  video_id         text primary key,
  url              text not null,
  title            text,
  duration_seconds integer not null default 0,
  lang             text,
  source           text    not null default 'supadata',  -- supadata | manuel
  segments         jsonb   not null default '[]'::jsonb,
  created_at       timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Oturumlar — bir videoyu bir kez sınama denemesi
-- ---------------------------------------------------------------------------
create table if not exists ders_sessions (
  id          uuid primary key default gen_random_uuid(),
  video_id    text not null references ders_videos(video_id) on delete cascade,
  title       text,
  summary     text,
  topics      jsonb not null default '[]'::jsonb,
  status      text  not null default 'hazirlaniyor',  -- hazirlaniyor | hazir | hata
  error       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists ders_sessions_created_idx on ders_sessions (created_at desc);
create index if not exists ders_sessions_video_idx   on ders_sessions (video_id);

-- ---------------------------------------------------------------------------
-- Sorular
-- ---------------------------------------------------------------------------
create table if not exists ders_questions (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references ders_sessions(id) on delete cascade,
  position      integer not null,
  kind          text    not null,                      -- acik | coktan
  question      text    not null,
  answer_key    text,                                  -- açık uçlu için beklenen cevap
  key_points    jsonb   not null default '[]'::jsonb,  -- kilit kavramlar
  choices       jsonb,                                 -- çoktan seçmeli şıkları
  correct_index integer,
  explanation   text,
  topic         text,
  start_seconds integer not null default 0             -- videoda anlatıldığı an
);

create index if not exists ders_questions_session_idx on ders_questions (session_id, position);

-- ---------------------------------------------------------------------------
-- Cevaplar
-- ---------------------------------------------------------------------------
create table if not exists ders_answers (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references ders_sessions(id) on delete cascade,
  question_id uuid not null references ders_questions(id) on delete cascade,
  user_answer text,
  verdict     text,                                  -- dogru | eksik | yanlis | pas
  feedback    text,
  missing     jsonb not null default '[]'::jsonb,    -- eksik kalan kavramlar
  created_at  timestamptz default now(),
  unique (question_id)
);

create index if not exists ders_answers_session_idx on ders_answers (session_id);

-- ---------------------------------------------------------------------------
-- updated_at tetikleyicisi (notes tablosundaki update_updated_at fonksiyonunu
-- yeniden kullanır; yoksa oluşturur)
-- ---------------------------------------------------------------------------
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists ders_sessions_set_updated_at on ders_sessions;
create trigger ders_sessions_set_updated_at
  before update on ders_sessions
  for each row execute function update_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — site zaten giriş kapısının arkasında, notes/sheets ile aynı desen
-- ---------------------------------------------------------------------------
alter table ders_videos    enable row level security;
alter table ders_sessions  enable row level security;
alter table ders_questions enable row level security;
alter table ders_answers   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ders_videos', 'ders_sessions', 'ders_questions', 'ders_answers']
  loop
    execute format('drop policy if exists "%s_public_all" on %I', t, t);
    execute format(
      'create policy "%s_public_all" on %I for all using (true) with check (true)', t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Sonradan eklenen kolonlar — bu dosyayı yeniden çalıştırmak güvenlidir
-- ---------------------------------------------------------------------------

-- Ablamın "bu soru saçma" işareti. Prompt'u gerçek örneklerle iyileştirmek için.
alter table ders_questions add column if not exists flagged boolean not null default false;

-- Denetimin ne yaptığı görünür olsun: elenen ve düzeltilen soru sayısı.
-- Bunlar sunucu loglarında kalırsa kimse bakmaz; oturuma yazılınca ders
-- sonuç ekranında görünür ve bir sorun varsa fark edilir.
alter table ders_sessions add column if not exists denetim jsonb not null
  default '{"duzeltilen": 0, "elenen": 0}'::jsonb;

-- Dersten çıkarılmış çalışma notu. İstek üzerine üretilir (/api/ders/notes) ve
-- burada saklanır; ablam notu silip yeniden kaydederse tekrar üretilmez.
alter table ders_sessions add column if not exists notlar jsonb;

-- Dersin konusu (Tarih, Coğrafya, Vatandaşlık...). Üretim sırasında modelin
-- belirlediği değer yazılır; liste bu alana göre gruplanır ve her grubun
-- "Soru Gönder" düğmesi bu alandan besleniyor.
alter table ders_sessions add column if not exists kategori text;

-- Oturum türü. 'ders' bir videodan üretilmiş normal oturum; 'tekrar' bir
-- kategorideki derslerin sorularından karıştırılarak kurulmuş tekrar oturumu.
-- Tekrar oturumları havuza dahil edilmez, yoksa kopyanın kopyası üretilir.
alter table ders_sessions add column if not exists tur text not null default 'ders';

-- Sorunun KENDİ videosu. Eskiden bir oturum tek videoya bağlıydı ve soru-video
-- ilişkisi ders_sessions.video_id üzerinden kuruluyordu. Tekrar oturumları
-- birden çok videodan soru taşıdığı için bu varsayım çöküyor: "videoda 12:43"
-- bağlantısı yanlış videoya gider, açık uçlu değerlendirici de yanlış dersin
-- transkriptini okurdu. İkisi de hata vermeden yanlış sonuç üretirdi.
alter table ders_questions add column if not exists video_id text
  references ders_videos(video_id) on delete set null;

-- Tekrar oturumundaki kopyanın hangi sorudan türediği. Kopyalama sebebi:
-- ders_answers'ta unique(question_id) var, aynı soru ikinci kez cevaplanamıyor.
-- Kopya yeni bir kimlik alınca ablamın ilk denemedeki cevabı da bozulmadan kalıyor.
alter table ders_questions add column if not exists kaynak_soru_id uuid;

-- Mevcut satırları doldur (bu dosyayı yeniden çalıştırmak güvenlidir)
update ders_questions q
   set video_id = s.video_id
  from ders_sessions s
 where q.session_id = s.id and q.video_id is null;

create index if not exists ders_sessions_kategori_idx
  on ders_sessions (kategori, created_at desc);
